import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient

from apps.accounts.tokens import password_reset_token_generator
from apps.notifications.models import Notification
from apps.payments.models import PaymentTransaction
from apps.payments.services import reverse_transaction

User = get_user_model()
PAYMENTS = "/api/v1/payments/"
AUTH = "/api/v1/auth/"


def make_user(email="events@example.test", full_name="Event User"):
    return User.objects.create_user(
        email=email,
        password="OnePay!SecurePass2026",
        full_name=full_name,
    )


def client_for(user=None):
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


def post_headers(key):
    return {"HTTP_IDEMPOTENCY_KEY": key}


@pytest.mark.django_db
def test_payment_failure_success_and_wallet_topup_events_are_persisted_once():
    user = make_user()
    client = client_for(user)

    successful = client.post(
        f"{PAYMENTS}transactions/",
        {"kind": "transfer", "upi_id": "friend@onepay", "amount_minor": 2_000},
        format="json",
        **post_headers("notification-success-key-01"),
    )
    replay = client.post(
        f"{PAYMENTS}transactions/",
        {"kind": "transfer", "upi_id": "friend@onepay", "amount_minor": 2_000},
        format="json",
        **post_headers("notification-success-key-01"),
    )
    failed = client.post(
        f"{PAYMENTS}transactions/",
        {"kind": "transfer", "upi_id": "fail@onepay", "amount_minor": 2_500},
        format="json",
        **post_headers("notification-failure-key-01"),
    )
    topup = client.post(
        f"{PAYMENTS}wallet/topups/",
        {"amount_minor": 10_000},
        format="json",
        **post_headers("notification-topup-key-01"),
    )
    topup_replay = client.post(
        f"{PAYMENTS}wallet/topups/",
        {"amount_minor": 10_000},
        format="json",
        **post_headers("notification-topup-key-01"),
    )

    assert successful.status_code == replay.status_code == failed.status_code == topup.status_code == topup_replay.status_code == 200
    assert successful.data["status"] == "successful"
    assert replay.data["reference"] == successful.data["reference"]
    assert failed.data["status"] == "failed"
    assert topup.data["reference"] == topup_replay.data["reference"]
    assert Notification.objects.filter(recipient=user, event_type=Notification.EventType.PAYMENT_SUCCESSFUL).count() == 1
    assert Notification.objects.filter(recipient=user, event_type=Notification.EventType.PAYMENT_FAILED).count() == 1
    assert Notification.objects.filter(recipient=user, event_type=Notification.EventType.WALLET_TOPUP_SUCCESSFUL).count() == 1
    assert Notification.objects.filter(recipient=user).count() == 3


@pytest.mark.django_db
def test_pending_event_is_not_reported_as_success_and_later_transition_notifies_once(monkeypatch):
    from apps.payments import services

    user = make_user()
    client = client_for(user)
    payload = {"kind": "transfer", "upi_id": "pending@onepay", "amount_minor": 3_000}

    def pending(_transaction):
        raise services.PaymentNetworkError("local demo timeout")

    monkeypatch.setattr(services, "simulate_payment", pending)
    first = client.post(
        f"{PAYMENTS}transactions/",
        payload,
        format="json",
        **post_headers("notification-pending-key-01"),
    )
    repeated_pending = client.post(
        f"{PAYMENTS}transactions/",
        payload,
        format="json",
        **post_headers("notification-pending-key-01"),
    )
    assert first.status_code == repeated_pending.status_code == 200
    assert first.data["status"] == repeated_pending.data["status"] == "pending"
    assert Notification.objects.filter(recipient=user, event_type=Notification.EventType.PAYMENT_PENDING).count() == 1
    assert not Notification.objects.filter(recipient=user, event_type=Notification.EventType.PAYMENT_SUCCESSFUL).exists()

    monkeypatch.setattr(services, "simulate_payment", lambda _transaction: PaymentTransaction.Status.SUCCESSFUL)
    settled = client.post(
        f"{PAYMENTS}transactions/",
        payload,
        format="json",
        **post_headers("notification-pending-key-01"),
    )
    replay = client.post(
        f"{PAYMENTS}transactions/",
        payload,
        format="json",
        **post_headers("notification-pending-key-01"),
    )

    assert settled.status_code == replay.status_code == 200
    assert settled.data["status"] == "successful"
    assert replay.data["reference"] == first.data["reference"]
    assert Notification.objects.filter(recipient=user, event_type=Notification.EventType.PAYMENT_PENDING).count() == 1
    assert Notification.objects.filter(recipient=user, event_type=Notification.EventType.PAYMENT_SUCCESSFUL).count() == 1
    assert Notification.objects.filter(recipient=user).count() == 2


@pytest.mark.django_db
def test_bill_and_recharge_notifications_follow_the_final_simulated_outcome():
    user = make_user()
    client = client_for(user)
    bill = client.post(
        f"{PAYMENTS}transactions/",
        {
            "kind": "bill",
            "service": "electricity",
            "provider": "OnePay Mock Electricity",
            "amount_minor": 5_000,
            "recipient_reference": "EB-483920",
        },
        format="json",
        **post_headers("notification-bill-success-key-01"),
    )
    failed_bill = client.post(
        f"{PAYMENTS}transactions/",
        {
            "kind": "bill",
            "service": "water",
            "provider": "OnePay Mock Water",
            "amount_minor": 2_000,
            "recipient_reference": "WTR-0000",
        },
        format="json",
        **post_headers("notification-bill-failed-key-01"),
    )
    recharge = client.post(
        f"{PAYMENTS}transactions/",
        {
            "kind": "recharge",
            "service": "mobile",
            "provider": "OnePay Mock Mobile Alpha",
            "amount_minor": 19_900,
            "recipient_reference": "9876543210",
        },
        format="json",
        **post_headers("notification-recharge-success-01"),
    )

    assert bill.data["status"] == "successful"
    assert failed_bill.data["status"] == "failed"
    assert recharge.data["status"] == "successful"
    assert Notification.objects.filter(recipient=user, event_type=Notification.EventType.BILL_SUCCESSFUL).count() == 1
    assert Notification.objects.filter(recipient=user, event_type=Notification.EventType.BILL_FAILED).count() == 1
    assert Notification.objects.filter(recipient=user, event_type=Notification.EventType.RECHARGE_SUCCESSFUL).count() == 1


@pytest.mark.django_db
def test_internal_reversal_and_recipient_changes_generate_notifications_only_for_real_events():
    user = make_user()
    client = client_for(user)
    payment = client.post(
        f"{PAYMENTS}transactions/",
        {"kind": "transfer", "upi_id": "friend@onepay", "amount_minor": 1_000},
        format="json",
        **post_headers("notification-reversal-payment-01"),
    )
    transaction_obj = PaymentTransaction.objects.get(reference=payment.data["reference"])
    reverse_transaction(user, transaction_obj.reference, "notification-reversal-key-01")
    reverse_transaction(user, transaction_obj.reference, "notification-reversal-key-01")

    created = client.post(
        f"{PAYMENTS}recipients/",
        {"display_name": "Lee Morgan", "upi_id": "lee@onepay"},
        format="json",
    )
    recipient_id = created.data["id"]
    updated = client.patch(
        f"{PAYMENTS}recipients/{recipient_id}/",
        {"display_name": "Lee M."},
        format="json",
    )
    repeated_update = client.patch(
        f"{PAYMENTS}recipients/{recipient_id}/",
        {"display_name": "Lee M."},
        format="json",
    )
    removed = client.delete(f"{PAYMENTS}recipients/{recipient_id}/")

    assert payment.status_code == 200
    assert created.status_code == 201
    assert updated.status_code == repeated_update.status_code == 200
    assert removed.status_code == 204
    assert Notification.objects.filter(recipient=user, event_type=Notification.EventType.PAYMENT_REVERSED).count() == 1
    assert Notification.objects.filter(recipient=user, event_type=Notification.EventType.RECIPIENT_CREATED).count() == 1
    assert Notification.objects.filter(recipient=user, event_type=Notification.EventType.RECIPIENT_UPDATED).count() == 1
    assert Notification.objects.filter(recipient=user, event_type=Notification.EventType.RECIPIENT_REMOVED).count() == 1


@pytest.mark.django_db
def test_login_profile_update_and_password_reset_generate_account_security_events():
    user = make_user("account-events@example.test")
    client = APIClient()
    cache.clear()

    login_response = client.post(
        f"{AUTH}login/",
        {"email": user.email, "password": "OnePay!SecurePass2026"},
        format="json",
    )
    profile = client.patch(f"{AUTH}profile/", {"full_name": "Updated Event User"}, format="json")
    repeated_profile = client.patch(f"{AUTH}profile/", {"full_name": "Updated Event User"}, format="json")
    user.refresh_from_db()
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    reset = client.post(
        f"{AUTH}password-reset/confirm/",
        {
            "uid": uid,
            "token": password_reset_token_generator.make_token(user),
            "new_password": "OnePay!ChangedPassword2026",
            "confirm_password": "OnePay!ChangedPassword2026",
        },
        format="json",
    )

    assert login_response.status_code == 200
    assert profile.status_code == repeated_profile.status_code == reset.status_code == 200
    assert Notification.objects.filter(recipient=user, event_type=Notification.EventType.SECURITY_LOGIN_SUCCESSFUL).count() == 1
    assert Notification.objects.filter(recipient=user, event_type=Notification.EventType.ACCOUNT_PROFILE_UPDATED).count() == 1
    assert Notification.objects.filter(recipient=user, event_type=Notification.EventType.SECURITY_PASSWORD_CHANGED).count() == 1
    assert "ChangedPassword" not in str(Notification.objects.filter(recipient=user).values_list("message", flat=True))


@pytest.mark.django_db
def test_qr_generation_and_verification_do_not_create_payment_notifications():
    user = make_user()
    client = client_for(user)
    generated = client.post(f"{PAYMENTS}qr/generate/", {}, format="json")
    resolved = client.post(
        f"{PAYMENTS}qr/resolve/",
        {"qr_content": generated.data["qr_content"]},
        format="json",
    )

    assert generated.status_code == resolved.status_code == 200
    assert Notification.objects.filter(recipient=user).count() == 0


@pytest.mark.django_db
def test_notification_storage_failure_does_not_fail_a_completed_payment(monkeypatch):
    from apps.notifications import services as notification_services

    def fail_to_persist(**_kwargs):
        raise RuntimeError("simulated optional notification storage failure")

    monkeypatch.setattr(notification_services, "create_notification", fail_to_persist)
    user = make_user("notification-failure@example.test")
    response = client_for(user).post(
        f"{PAYMENTS}transactions/",
        {"kind": "transfer", "upi_id": "friend@onepay", "amount_minor": 2_000},
        format="json",
        **post_headers("notification-storage-failure-01"),
    )

    assert response.status_code == 200
    assert response.data["status"] == "successful"
    assert Notification.objects.filter(recipient=user).count() == 0
