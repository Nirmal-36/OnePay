import json
import logging
import os
import subprocess
import sys
from pathlib import Path

import pytest
from django.contrib.admin.sites import AdminSite
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import Client, RequestFactory, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.admin import UserAdmin
from apps.payments.admin import PaymentTransactionAdmin
from apps.payments.models import (
    AuditEvent,
    PaymentTransaction,
    TransactionStatusHistory,
    Wallet,
    WalletLedgerEntry,
)
from config.observability import JsonLogFormatter, RequestIdAndErrorMiddleware

User = get_user_model()


def make_user(email="phase6@example.test", *, is_staff=False, is_superuser=False):
    return User.objects.create_user(
        email=email,
        password="OnePay!SecurePass2026",
        full_name="Phase Six User",
        is_staff=is_staff,
        is_superuser=is_superuser,
    )


def make_transaction(user, *, status=PaymentTransaction.Status.PENDING):
    transaction_obj = PaymentTransaction.objects.create(
        sender=user,
        sender_name=user.full_name,
        recipient_name="Demo recipient",
        recipient_identifier="private-recipient@mock",
        kind=PaymentTransaction.Kind.TRANSFER,
        amount_minor=12_345,
        currency="INR",
        idempotency_key="phase6-security-key-01",
        request_fingerprint="c" * 64,
    )
    if status != PaymentTransaction.Status.PENDING:
        TransactionStatusHistory.objects.create(
            transaction=transaction_obj,
            from_status=None,
            to_status=PaymentTransaction.Status.PENDING,
            actor=user,
            reason="Payment accepted for local demo processing.",
        )
        transaction_obj.record_status_transition(status, actor=user, reason="Completed by the local simulator.")
    return transaction_obj


@pytest.mark.django_db
def test_health_and_api_schema_are_available_without_disclosing_secrets():
    client = Client()
    live = client.get("/health/live/", HTTP_HOST="localhost")
    ready = client.get("/health/ready/", HTTP_HOST="localhost")
    schema = client.get("/api/schema/", HTTP_HOST="localhost")

    assert live.status_code == ready.status_code == schema.status_code == 200
    assert live.json() == {"status": "ok"}
    assert ready.json() == {"status": "ok"}
    assert live["X-Request-ID"]
    schema_data = json.loads(schema.content)
    assert schema_data["openapi"].startswith("3.")
    assert "/api/v1/payments/transactions/" in schema_data["paths"]
    assert "DJANGO_SECRET_KEY" not in schema.content.decode()


@pytest.mark.django_db
def test_api_error_envelopes_include_request_ids_and_cors_is_exact():
    client = APIClient()
    unauthorized = client.get("/api/v1/payments/wallet/", HTTP_HOST="localhost")
    assert unauthorized.status_code in {401, 403}
    assert unauthorized["X-Request-ID"]
    assert unauthorized.data["error"]["request_id"] == unauthorized["X-Request-ID"]

    with override_settings(CORS_ALLOWED_ORIGINS=["https://app.onepay.example"]):
        allowed = Client().get(
            "/api/v1/auth/csrf/",
            HTTP_HOST="localhost",
            HTTP_ORIGIN="https://app.onepay.example",
        )
        denied = Client().get(
            "/api/v1/auth/csrf/",
            HTTP_HOST="localhost",
            HTTP_ORIGIN="https://untrusted.example",
        )

    assert allowed.status_code == denied.status_code == 200
    assert allowed["Access-Control-Allow-Origin"] == "https://app.onepay.example"
    assert allowed["Access-Control-Allow-Credentials"] == "true"
    assert "Access-Control-Allow-Origin" not in denied


@pytest.mark.django_db
def test_unhandled_api_errors_are_structured_redacted_and_auditable(caplog):
    secret = "NEVER-LOG-this-password-or-token"
    request = RequestFactory().post(
        "/api/v1/private-operation/",
        data=json.dumps({"password": secret, "token": secret}),
        content_type="application/json",
    )

    def fail(_request):
        raise RuntimeError(f"private diagnostic {secret}")

    caplog.set_level(logging.ERROR, logger="onepay")
    response = RequestIdAndErrorMiddleware(fail)(request)
    payload = json.loads(response.content)
    event = AuditEvent.objects.get(action="system.api_error")

    assert response.status_code == 500
    assert response["X-Request-ID"] == payload["error"]["request_id"]
    assert payload["error"]["message"] == "An unexpected error occurred. Contact support with the request ID."
    assert payload["error"]["details"] is None
    assert secret not in response.content.decode()
    assert secret not in caplog.text
    assert secret not in json.dumps(event.metadata)
    assert event.metadata["error_type"] == "RuntimeError"
    assert event.metadata["status_code"] == 500
    assert set(event.metadata) == {"request_id", "method", "route", "status_code", "error_type"}


@pytest.mark.django_db
@override_settings(ROOT_URLCONF="config.tests.urls")
def test_actual_api_view_exception_returns_redacted_json_and_records_request():
    response = Client().get("/api/v1/test-failure/", HTTP_HOST="localhost")
    payload = json.loads(response.content)
    event = AuditEvent.objects.get(action="system.api_error")

    assert response.status_code == 500
    assert response["Content-Type"].startswith("application/json")
    assert payload["error"]["status"] == 500
    assert payload["error"]["request_id"] == response["X-Request-ID"]
    assert b"sensitive failure diagnostic" not in response.content
    assert event.metadata["error_type"] == "RuntimeError"


def test_structured_log_formatter_omits_arbitrary_messages_and_exception_text():
    record = logging.LogRecord(
        "onepay.security",
        logging.ERROR,
        "test.py",
        10,
        "credential=%s",
        ("PRIVATE-LOG-SECRET",),
        (RuntimeError, RuntimeError("PRIVATE-LOG-SECRET"), None),
    )
    record.event = "security.test"
    rendered = JsonLogFormatter().format(record)
    payload = json.loads(rendered)

    assert payload["event"] == "security.test"
    assert "PRIVATE-LOG-SECRET" not in rendered
    assert "message" not in payload


def test_django_framework_loggers_use_only_structured_redacted_handlers():
    from django.conf import settings

    assert settings.LOGGING["formatters"]["structured"]["()"] == "config.observability.JsonLogFormatter"
    assert settings.LOGGING["loggers"]["django"]["handlers"] == ["console"]
    assert settings.LOGGING["loggers"]["django.server"]["handlers"] == ["console"]
    assert "mail_admins" not in settings.LOGGING["loggers"]["django"]["handlers"]


@pytest.mark.django_db
def test_transaction_status_can_only_change_through_audited_transitions():
    user = make_user()
    transaction_obj = make_transaction(user)

    transaction_obj.status = PaymentTransaction.Status.SUCCESSFUL
    with pytest.raises(ValidationError):
        transaction_obj.save(update_fields=("status", "updated_at"))
    with pytest.raises(ValidationError):
        PaymentTransaction.objects.filter(pk=transaction_obj.pk).update(status=PaymentTransaction.Status.SUCCESSFUL)
    with pytest.raises(ValidationError):
        PaymentTransaction.objects.create(
            sender=user,
            sender_name=user.full_name,
            recipient_name="Fabricated success",
            kind=PaymentTransaction.Kind.TRANSFER,
            amount_minor=100,
            status=PaymentTransaction.Status.SUCCESSFUL,
            idempotency_key="phase6-forged-success",
            request_fingerprint="d" * 64,
        )

    transaction_obj.refresh_from_db()
    transaction_obj.record_status_transition(
        PaymentTransaction.Status.SUCCESSFUL,
        actor=user,
        reason="Audited test settlement.",
    )
    transaction_obj.refresh_from_db()
    history = list(transaction_obj.status_history.values_list("from_status", "to_status"))

    assert transaction_obj.status == PaymentTransaction.Status.SUCCESSFUL
    assert history == [(PaymentTransaction.Status.PENDING, PaymentTransaction.Status.SUCCESSFUL)]
    history_row = transaction_obj.status_history.first()
    with pytest.raises(ValidationError):
        history_row.reason = "silently changed"
        history_row.save()
    with pytest.raises(ValidationError):
        transaction_obj.status_history.all().delete()
    with pytest.raises(ValidationError):
        transaction_obj.record_status_transition(PaymentTransaction.Status.FAILED, actor=user)


@pytest.mark.django_db
def test_database_constraints_reject_invalid_status_history_and_ledger_currency():
    user = make_user("phase6-constraints@example.test")
    transaction_obj = make_transaction(user)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            TransactionStatusHistory.objects.create(
                transaction=transaction_obj,
                from_status=PaymentTransaction.Status.FAILED,
                to_status=PaymentTransaction.Status.SUCCESSFUL,
                actor=user,
            )

    wallet = Wallet.objects.create(user=user, balance_minor=100)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            WalletLedgerEntry.objects.create(
                wallet=wallet,
                entry_type=WalletLedgerEntry.EntryType.TOPUP_CREDIT,
                amount_minor=100,
                balance_after_minor=100,
                currency="USD",
            )


@pytest.mark.django_db
def test_admin_dashboard_is_permission_gated_read_only_and_audits_investigations():
    owner = make_user("phase6-owner@example.test")
    transaction_obj = make_transaction(owner, status=PaymentTransaction.Status.SUCCESSFUL)
    administrator = make_user("phase6-admin@example.test", is_staff=True, is_superuser=True)
    client = Client()
    client.force_login(administrator)

    admin_home = client.get("/admin/")
    dashboard = client.get("/admin/dashboard/")
    investigation = client.get("/admin/dashboard/", {"reference": transaction_obj.reference})
    audit_review = client.get("/admin/audit/")
    transaction_list = client.get(reverse("admin:payments_paymenttransaction_changelist"))

    assert admin_home.status_code == dashboard.status_code == investigation.status_code == audit_review.status_code == 200
    assert transaction_list.status_code == 200
    assert b"Operations dashboard" in admin_home.content
    assert b"Successful outgoing volume" in dashboard.content
    assert str(12_345).encode() in dashboard.content
    assert transaction_obj.reference.encode() in investigation.content
    assert b"private-recipient@mock" not in investigation.content
    assert AuditEvent.objects.filter(action="admin.dashboard.viewed", actor=administrator).exists()
    assert AuditEvent.objects.filter(
        action="admin.transaction.investigated", actor=administrator, transaction=transaction_obj
    ).exists()
    assert AuditEvent.objects.filter(action="admin.audit_log.reviewed", actor=administrator).exists()
    assert AuditEvent.objects.filter(action="admin.paymenttransaction.list_viewed", actor=administrator).exists()
    assert client.post("/admin/dashboard/").status_code == 405

    admin_model = PaymentTransactionAdmin(PaymentTransaction, AdminSite())
    request = RequestFactory().get("/admin/apps/payments/paymenttransaction/")
    request.user = administrator
    assert admin_model.has_add_permission(request) is False
    assert admin_model.has_change_permission(request, transaction_obj) is False
    assert admin_model.has_delete_permission(request, transaction_obj) is False


@pytest.mark.django_db
def test_operations_dashboard_requires_explicit_staff_permissions_and_redacts_audit_metadata():
    staff = make_user("phase6-limited-staff@example.test", is_staff=True)
    client = Client()
    client.force_login(staff)
    assert client.get("/admin/dashboard/").status_code == 403

    permissions = Permission.objects.filter(
        content_type__app_label__in=("accounts", "payments"),
        codename__in=(
            "view_user",
            "view_paymenttransaction",
            "view_auditevent",
            "view_transactionstatushistory",
            "view_walletledgerentry",
        ),
    )
    staff.user_permissions.add(*permissions)
    assert client.get("/admin/dashboard/").status_code == 200

    audit_event = AuditEvent.objects.create(
        actor=staff,
        action="test.sensitive_metadata",
        metadata={"password": "DO-NOT-RENDER", "token": "DO-NOT-RENDER", "status": "safe"},
    )
    with pytest.raises(ValidationError):
        AuditEvent.objects.filter(pk=audit_event.pk).update(action="test.changed")
    with pytest.raises(ValidationError):
        audit_event.delete()
    review = client.get("/admin/audit/")
    assert review.status_code == 200
    assert b"DO-NOT-RENDER" not in review.content
    assert b"safe" in review.content


@pytest.mark.django_db
def test_non_superuser_user_admin_cannot_assign_privileges_and_admin_changes_are_audited():
    staff = make_user("phase6-user-admin@example.test", is_staff=True)
    request = RequestFactory().get("/admin/accounts/user/")
    request.user = staff
    model_admin = UserAdmin(User, AdminSite())
    field_names = {field for _, options in model_admin.get_fieldsets(request) for field in options["fields"]}
    assert not {"is_active", "is_staff", "is_superuser", "groups", "user_permissions"} & field_names

    add_permission = Permission.objects.get(content_type__app_label="accounts", codename="add_user")
    change_permission = Permission.objects.get(content_type__app_label="accounts", codename="change_user")
    staff.user_permissions.add(add_permission, change_permission)
    client = Client()
    client.force_login(staff)
    add_page = client.get("/admin/accounts/user/add/")
    assert add_page.status_code == 200
    assert b'name="is_staff"' not in add_page.content
    created = client.post("/admin/accounts/user/add/", {
        "email": "phase6-forged-staff@example.test",
        "full_name": "Forged Staff",
        "password1": "OnePay!NewAccount2026",
        "password2": "OnePay!NewAccount2026",
        "is_active": "on",
        "is_staff": "on",
        "is_superuser": "on",
        "_save": "Save",
    })
    created_user = User.objects.get(email="phase6-forged-staff@example.test")
    assert created.status_code == 302
    assert created_user.is_active is True
    assert created_user.is_staff is False
    assert created_user.is_superuser is False

    administrator = make_user("phase6-superuser@example.test", is_staff=True, is_superuser=True)
    target = make_user("phase6-target@example.test")
    target.is_staff = True
    save_request = RequestFactory().post("/admin/accounts/user/")
    save_request.user = administrator
    model_admin.save_model(save_request, target, form=None, change=True)

    event = AuditEvent.objects.get(action="admin.user.permissions_changed", actor=administrator)
    assert event.metadata == {"target_user_id": target.pk, "changed_fields": ["is_staff"]}


def test_production_settings_fail_closed_without_an_explicit_secret():
    backend_dir = Path(__file__).resolve().parents[2]
    environment = os.environ.copy()
    environment.update({"DJANGO_SETTINGS_MODULE": "config.settings", "DJANGO_DEBUG": "false", "DJANGO_SECRET_KEY": ""})
    result = subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        cwd=backend_dir,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert "DJANGO_SECRET_KEY must be set" in result.stderr
