from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from urllib.parse import parse_qsl, urlsplit

import pytest
from django.contrib.auth import get_user_model
from django.db import close_old_connections
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from apps.payments.models import (
    AuditEvent,
    PaymentTransaction,
    Recipient,
    TransactionStatusHistory,
    Wallet,
    WalletLedgerEntry,
)
from apps.payments.services import (
    create_demo_payment_qr,
    get_or_create_wallet,
    initiate_payment,
    list_recipients,
)

User = get_user_model()
BASE = "/api/v1/payments/"


def make_user(email="ananya@example.test", full_name="Ananya Sharma"):
    return User.objects.create_user(
        email=email, password="OnePay!SecurePass2026", full_name=full_name
    )


def make_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def payment_payload(**overrides):
    return {
        "kind": "transfer",
        "recipient_id": 1,
        "amount_minor": 12_400,
        "note": "Lunch",
        **overrides,
    }


def headers(key="onepay-test-key-0001"):
    return {"HTTP_IDEMPOTENCY_KEY": key}


@pytest.mark.django_db
def test_wallet_is_server_initialized_and_recipient_list_is_user_scoped():
    user = make_user()
    client = make_client(user)

    wallet_response = client.get(f"{BASE}wallet/")
    recipients_response = client.get(f"{BASE}recipients/")

    assert wallet_response.status_code == 200
    assert wallet_response.data == {
        "balance_minor": 2_458_000,
        "currency": "INR",
        "updated_at": wallet_response.data["updated_at"],
    }
    assert len(recipients_response.data) == 5
    assert {item["upi_id"] for item in recipients_response.data} == {
        "rohan@okaxis",
        "kavya@okhdfcbank",
        "arjun@okicici",
        "meera@oksbi",
        "dev@okaxis",
    }
    assert (
        WalletLedgerEntry.objects.filter(
            wallet__user=user, entry_type="opening"
        ).count()
        == 1
    )

    other = make_user(email="other@example.test", full_name="Other User")
    other_recipients = make_client(other).get(f"{BASE}recipients/")
    assert len(other_recipients.data) == 5
    assert (
        not Recipient.objects.filter(user=user)
        .filter(pk__in=[item["id"] for item in other_recipients.data])
        .exists()
    )


@pytest.mark.django_db
def test_recipient_lookup_add_edit_and_soft_delete_only_affect_current_user():
    user = make_user()
    client = make_client(user)
    created = client.post(
        f"{BASE}recipients/",
        {"display_name": "Lee Morgan", "upi_id": "lee.morgan@onepay"},
        format="json",
    )
    assert created.status_code == 201
    recipient_id = created.data["id"]
    duplicate = client.post(
        f"{BASE}recipients/",
        {"display_name": "Duplicate Rohan", "upi_id": "rohan@okaxis"},
        format="json",
    )
    assert duplicate.status_code == 400

    lookup = client.get(f"{BASE}recipients/lookup/?identifier=lee.morgan%40onepay")
    assert lookup.status_code == 200
    assert lookup.data["id"] == recipient_id

    edited = client.patch(
        f"{BASE}recipients/{recipient_id}/",
        {"display_name": "Lee M."},
        format="json",
    )
    assert edited.status_code == 200
    assert edited.data["display_name"] == "Lee M."

    deleted = client.delete(f"{BASE}recipients/{recipient_id}/")
    assert deleted.status_code == 204
    assert client.get(f"{BASE}recipients/{recipient_id}/").status_code == 404
    assert Recipient.objects.get(pk=recipient_id).is_active is False
    assert client.get(
        f"{BASE}recipients/lookup/?identifier=lee.morgan%40onepay"
    ).status_code == 404
    removed_payment = client.post(
        f"{BASE}transactions/",
        {"kind": "transfer", "upi_id": "lee.morgan@onepay", "amount_minor": 1_000},
        format="json",
        **headers("removed-recipient-payment-01"),
    )
    assert removed_payment.status_code == 400

    stranger = make_client(
        make_user(email="stranger@example.test", full_name="Stranger")
    )
    assert stranger.get(f"{BASE}recipients/{recipient_id}/").status_code == 404


@pytest.mark.django_db
def test_signed_demo_qr_is_resolved_by_backend_and_used_for_simulated_transfer():
    user = make_user()
    client = make_client(user)
    generated = client.post(f"{BASE}qr/generate/", {}, format="json")

    assert generated.status_code == 200
    qr_content = generated.data["qr_content"]
    profile_identifier = f"user{user.pk}@onepay"
    assert qr_content.startswith("onepay://pay?")
    assert f"user{user.pk}%40onepay" in qr_content
    assert set(dict(parse_qsl(urlsplit(qr_content).query))) == {
        "v", "upi", "currency", "mode", "sig"
    }
    assert user.full_name not in qr_content
    assert generated.data["display_name"] == user.full_name
    assert generated.data["upi_id"] == profile_identifier
    assert generated.data["mode"] == "demo"
    assert generated.data["currency"] == "INR"

    caller_supplied_profile = client.post(
        f"{BASE}qr/generate/",
        {"upi_id": "user999999@onepay", "display_name": "Unverified name"},
        format="json",
    )
    assert caller_supplied_profile.status_code == 200
    assert caller_supplied_profile.data["upi_id"] == profile_identifier
    assert caller_supplied_profile.data["display_name"] == user.full_name

    resolution = client.post(
        f"{BASE}qr/resolve/",
        {"qr_content": qr_content},
        format="json",
    )
    assert resolution.status_code == 200
    assert resolution.data == {
        "recipient_id": None,
        "display_name": user.full_name,
        "upi_id": profile_identifier,
        "currency": "INR",
        "mode": "demo",
        "verified": True,
    }

    response = client.post(
        f"{BASE}transactions/",
        {"kind": "transfer", "qr_content": qr_content, "amount_minor": 12_400},
        format="json",
        **headers("signed-demo-qr-payment-01"),
    )
    assert response.status_code == 200
    assert response.data["status"] == "successful"
    assert response.data["recipient_name"] == user.full_name
    assert response.data["recipient_identifier"] == profile_identifier
    assert PaymentTransaction.objects.filter(sender=user).count() == 1


@pytest.mark.django_db
def test_demo_qr_rejects_tampering_malformed_content_and_unsupported_recipients():
    user = make_user()
    client = make_client(user)
    valid_qr = create_demo_payment_qr(user)
    tampered_qr = valid_qr.replace(
        f"user{user.pk}%40onepay", "user999999%40onepay"
    )
    unsupported_qr = "https://example.test/pay?upi=attacker%40bank"
    before = client.get(f"{BASE}wallet/").data["balance_minor"]

    tampered_resolution = client.post(
        f"{BASE}qr/resolve/", {"qr_content": tampered_qr}, format="json"
    )
    malformed_resolution = client.post(
        f"{BASE}qr/resolve/", {"qr_content": "onepay://pay?v=1"}, format="json"
    )
    unsupported_resolution = client.post(
        f"{BASE}qr/resolve/", {"qr_content": unsupported_qr}, format="json"
    )
    tampered_payment = client.post(
        f"{BASE}transactions/",
        {"kind": "transfer", "qr_content": tampered_qr, "amount_minor": 12_400},
        format="json",
        **headers("tampered-demo-qr-payment-01"),
    )
    unknown_profile = client.get(
        f"{BASE}recipients/lookup/?identifier=user999999%40onepay"
    )
    unknown_profile_payment = client.post(
        f"{BASE}transactions/",
        {"kind": "transfer", "upi_id": "user999999@onepay", "amount_minor": 12_400},
        format="json",
        **headers("unknown-profile-payment-01"),
    )

    assert tampered_resolution.status_code == 400
    assert malformed_resolution.status_code == 400
    assert unsupported_resolution.status_code == 400
    assert tampered_payment.status_code == 400
    assert unknown_profile.status_code == 404
    assert unknown_profile_payment.status_code == 404
    assert PaymentTransaction.objects.filter(sender=user).count() == 0
    assert Wallet.objects.get(user=user).balance_minor == before


@pytest.mark.django_db
def test_payment_validates_mock_recipient_amount_and_does_not_trust_submitted_balance():
    user = make_user()
    client = make_client(user)
    list_recipients(user)

    invalid = client.post(
        f"{BASE}transactions/",
        {"kind": "transfer", "upi_id": "unlisted@realbank", "amount_minor": 12_400},
        format="json",
        **headers("invalid-recipient-key-0001"),
    )
    assert invalid.status_code == 400

    missing_recipient = client.post(
        f"{BASE}transactions/",
        payment_payload(recipient_id=99999),
        format="json",
        **headers("missing-recipient-key-0001"),
    )
    assert missing_recipient.status_code == 400

    too_much = client.post(
        f"{BASE}transactions/",
        payment_payload(amount_minor=2_458_001),
        format="json",
        **headers("too-much-key-000001"),
    )
    assert too_much.status_code == 400

    accepted = client.post(
        f"{BASE}transactions/",
        payment_payload(balance_minor=99_999_999),
        format="json",
        **headers("trusted-balance-key-01"),
    )
    assert accepted.status_code == 200
    assert accepted.data["status"] == "successful"
    assert Wallet.objects.get(user=user).balance_minor == 2_445_600
    assert "balance_minor" not in accepted.data


@pytest.mark.django_db
def test_duplicate_request_is_idempotent_and_key_cannot_be_reused_for_new_payload():
    user = make_user()
    client = make_client(user)
    list_recipients(user)
    payload = payment_payload()

    first = client.post(
        f"{BASE}transactions/",
        payload,
        format="json",
        **headers("duplicate-payment-key-1"),
    )
    replay = client.post(
        f"{BASE}transactions/",
        payload,
        format="json",
        **headers("duplicate-payment-key-1"),
    )
    conflict = client.post(
        f"{BASE}transactions/",
        payment_payload(amount_minor=12_500),
        format="json",
        **headers("duplicate-payment-key-1"),
    )

    assert first.status_code == replay.status_code == 200
    assert first.data["reference"] == replay.data["reference"]
    assert conflict.status_code == 409
    assert PaymentTransaction.objects.filter(sender=user).count() == 1
    assert (
        WalletLedgerEntry.objects.filter(wallet__user=user, entry_type="debit").count()
        == 1
    )
    assert Wallet.objects.get(user=user).balance_minor == 2_445_600


@pytest.mark.django_db
def test_failed_simulated_payment_refunds_once_and_records_history_and_audit():
    user = make_user()
    client = make_client(user)
    before = client.get(f"{BASE}wallet/").data["balance_minor"]

    response = client.post(
        f"{BASE}transactions/",
        {"kind": "transfer", "upi_id": "fail@onepay", "amount_minor": 4_500},
        format="json",
        **headers("failed-payment-key-0001"),
    )
    replay = client.post(
        f"{BASE}transactions/",
        {"kind": "transfer", "upi_id": "fail@onepay", "amount_minor": 4_500},
        format="json",
        **headers("failed-payment-key-0001"),
    )

    assert response.status_code == 200
    assert response.data["status"] == "failed"
    assert replay.data["reference"] == response.data["reference"]
    assert Wallet.objects.get(user=user).balance_minor == before
    assert (
        WalletLedgerEntry.objects.filter(
            transaction__reference=response.data["reference"]
        ).count()
        == 2
    )
    assert [item["to_status"] for item in response.data["status_history"]] == [
        "pending",
        "failed",
    ]
    assert AuditEvent.objects.filter(
        transaction__reference=response.data["reference"]
    ).exists()


@pytest.mark.django_db
def test_network_failure_stays_pending_and_same_key_retry_settles_without_second_debit(
    monkeypatch,
):
    from apps.payments import services

    user = make_user()
    client = make_client(user)
    payload = {
        "kind": "transfer",
        "upi_id": "network.demo@onepay",
        "amount_minor": 8_000,
    }

    def network_error(_transaction):
        raise services.PaymentNetworkError("local simulated outage")

    monkeypatch.setattr(services, "simulate_payment", network_error)
    pending = client.post(
        f"{BASE}transactions/",
        payload,
        format="json",
        **headers("network-retry-key-0001"),
    )
    debited_balance = Wallet.objects.get(user=user).balance_minor

    monkeypatch.setattr(
        services,
        "simulate_payment",
        lambda _transaction: PaymentTransaction.Status.SUCCESSFUL,
    )
    settled = client.post(
        f"{BASE}transactions/",
        payload,
        format="json",
        **headers("network-retry-key-0001"),
    )

    assert pending.status_code == settled.status_code == 200
    assert pending.data["status"] == "pending"
    assert settled.data["status"] == "successful"
    assert settled.data["reference"] == pending.data["reference"]
    assert Wallet.objects.get(user=user).balance_minor == debited_balance
    assert (
        WalletLedgerEntry.objects.filter(
            transaction__reference=pending.data["reference"], entry_type="debit"
        ).count()
        == 1
    )


@pytest.mark.django_db
def test_bill_payment_masks_customer_identifier_and_returns_receipt():
    user = make_user()
    client = make_client(user)
    response = client.post(
        f"{BASE}transactions/",
        {
            "kind": "recharge",
            "service": "mobile",
            "amount_minor": 2_990,
            "recipient_reference": "+91 98765 43210",
        },
        format="json",
        **headers("mobile-recharge-key-0001"),
    )
    receipt = client.get(f"{BASE}transactions/{response.data['reference']}/receipt/")
    replay = client.post(
        f"{BASE}transactions/",
        {
            "kind": "recharge",
            "service": "mobile",
            "amount_minor": 2_990,
            "recipient_reference": "+91 98765 43210",
        },
        format="json",
        **headers("mobile-recharge-key-0001"),
    )
    conflicting_replay = client.post(
        f"{BASE}transactions/",
        {
            "kind": "recharge",
            "service": "mobile",
            "amount_minor": 2_990,
            "recipient_reference": "+91 98765 03210",
        },
        format="json",
        **headers("mobile-recharge-key-0001"),
    )

    assert response.status_code == 200
    assert response.data["recipient_name"] == "OnePay Mock Mobile Alpha"
    assert response.data["recipient_identifier"] == "Ending 3210"
    assert "+91 98765 43210" not in str(response.data)
    assert receipt.status_code == 200
    assert replay.status_code == 200
    assert replay.data["reference"] == response.data["reference"]
    assert PaymentTransaction.objects.filter(sender=user, kind="recharge").count() == 1
    assert WalletLedgerEntry.objects.filter(transaction__reference=response.data["reference"], entry_type="debit").count() == 1
    assert conflicting_replay.status_code == 409
    assert "No real money was transferred" in receipt.data["notice"]


@pytest.mark.django_db
def test_mock_recharge_operator_and_plan_are_validated_and_idempotent():
    user = make_user()
    client = make_client(user)
    payload = {
        "kind": "recharge",
        "service": "mobile",
        "provider": "OnePay Mock Mobile Beta",
        "plan_code": "mobile-beta-example-b",
        "amount_minor": 49_900,
        "recipient_reference": "9876543210",
    }
    first = client.post(f"{BASE}transactions/", payload, format="json", **headers("mock-plan-repeat-key-01"))
    replay = client.post(f"{BASE}transactions/", payload, format="json", **headers("mock-plan-repeat-key-01"))
    invalid_amount = client.post(
        f"{BASE}transactions/",
        {**payload, "amount_minor": 19_900},
        format="json",
        **headers("mock-plan-invalid-key-01"),
    )
    invalid_provider = client.post(
        f"{BASE}transactions/",
        {**payload, "provider": "Real Carrier", "plan_code": ""},
        format="json",
        **headers("mock-provider-invalid-01"),
    )

    assert first.status_code == replay.status_code == 200
    assert first.data["reference"] == replay.data["reference"]
    assert first.data["recipient_name"] == "OnePay Mock Mobile Beta"
    assert first.data["note"] == "Mock plan B · illustrative mock plan"
    assert first.data["recipient_identifier"] == "Ending 3210"
    assert "9876543210" not in str(first.data)
    assert invalid_amount.status_code == invalid_provider.status_code == 400
    assert PaymentTransaction.objects.filter(sender=user, kind="recharge").count() == 1
    assert WalletLedgerEntry.objects.filter(transaction__reference=first.data["reference"], entry_type="debit").count() == 1


@pytest.mark.django_db
def test_bill_reference_validation_and_failed_or_pending_outcomes_are_safe_to_retry():
    user = make_user()
    client = make_client(user)
    before = client.get(f"{BASE}wallet/").data["balance_minor"]
    invalid_reference = client.post(
        f"{BASE}transactions/",
        {"kind": "recharge", "service": "mobile", "amount_minor": 1_000, "recipient_reference": "12345"},
        format="json",
        **headers("bad-mobile-reference-001"),
    )
    failure_payload = {
        "kind": "bill", "service": "electricity", "provider": "OnePay Mock Electricity",
        "amount_minor": 5_000, "recipient_reference": "EB-0000",
    }
    failed = client.post(f"{BASE}transactions/", failure_payload, format="json", **headers("bill-fail-retry-key-01"))
    failed_replay = client.post(f"{BASE}transactions/", failure_payload, format="json", **headers("bill-fail-retry-key-01"))
    pending_payload = {
        "kind": "bill", "service": "water", "provider": "OnePay Mock Water",
        "amount_minor": 2_000, "recipient_reference": "WTR-9999",
    }
    pending = client.post(f"{BASE}transactions/", pending_payload, format="json", **headers("bill-pending-key-0001"))
    pending_replay = client.post(f"{BASE}transactions/", pending_payload, format="json", **headers("bill-pending-key-0001"))

    assert invalid_reference.status_code == 400
    assert failed.status_code == failed_replay.status_code == 200
    assert failed.data["status"] == "failed"
    assert failed_replay.data["reference"] == failed.data["reference"]
    assert failed.data["recipient_identifier"] == "Ending 0000"
    assert "EB-0000" not in str(failed.data)
    assert pending.status_code == pending_replay.status_code == 200
    assert pending.data["status"] == pending_replay.data["status"] == "pending"
    assert pending.data["reference"] == pending_replay.data["reference"]
    assert PaymentTransaction.objects.filter(sender=user).count() == 2
    assert WalletLedgerEntry.objects.filter(transaction__reference=failed.data["reference"], entry_type="debit").count() == 1
    assert WalletLedgerEntry.objects.filter(transaction__reference=failed.data["reference"], entry_type="failed_refund").count() == 1
    assert WalletLedgerEntry.objects.filter(transaction__reference=pending.data["reference"], entry_type="debit").count() == 1
    assert Wallet.objects.get(user=user).balance_minor == before - 2_000


@pytest.mark.django_db
def test_other_bill_service_is_recorded_with_a_masked_reference_and_receipt():
    user = make_user()
    client = make_client(user)
    response = client.post(
        f"{BASE}transactions/",
        {
            "kind": "bill", "service": "other", "provider": "OnePay Mock Utility",
            "amount_minor": 1_250, "recipient_reference": "MISC-483920",
        },
        format="json",
        **headers("other-bill-success-key-01"),
    )
    receipt = client.get(f"{BASE}transactions/{response.data['reference']}/receipt/")

    assert response.status_code == receipt.status_code == 200
    assert response.data["kind"] == "bill"
    assert response.data["service"] == "other"
    assert response.data["recipient_name"] == "OnePay Mock Utility"
    assert response.data["recipient_identifier"] == "Ending 3920"
    assert receipt.data["transaction"]["reference"] == response.data["reference"]
    assert "MISC-483920" not in str(receipt.data)
    assert "simulated transaction receipt" in receipt.data["notice"]
    assert PaymentTransaction.objects.filter(sender=user, kind="bill", service="other").count() == 1


@pytest.mark.django_db
def test_transaction_history_filters_and_paginates_owned_entries():
    user = make_user()
    client = make_client(user)
    transfer = client.post(
        f"{BASE}transactions/", payment_payload(amount_minor=1_000), format="json", **headers("history-transfer-key-01")
    )
    recharge = client.post(
        f"{BASE}transactions/",
        {
            "kind": "recharge", "service": "mobile", "provider": "OnePay Mock Mobile Alpha",
            "plan_code": "mobile-alpha-example-a", "amount_minor": 19_900, "recipient_reference": "9876543210",
        },
        format="json", **headers("history-recharge-key-01"),
    )
    bill = client.post(
        f"{BASE}transactions/",
        {
            "kind": "bill", "service": "water", "provider": "OnePay Mock Water",
            "amount_minor": 5_500, "recipient_reference": "WTR-483920",
        },
        format="json", **headers("history-bill-key-0001"),
    )
    topup = client.post(
        f"{BASE}wallet/topups/", {"amount_minor": 10_000}, format="json", **headers("history-topup-key-001")
    )
    old_transaction = PaymentTransaction.objects.get(reference=transfer.data["reference"])
    old_transaction.created_at = timezone.now() - timedelta(days=5)
    old_transaction.save(update_fields=("created_at",))

    first_page = client.get(f"{BASE}transactions/history/?page=1&page_size=1")
    second_page = client.get(f"{BASE}transactions/history/?page=2&page_size=1")
    filtered = client.get(
        f"{BASE}transactions/history/?status=successful&category=recharge&direction=debit"
        "&min_amount_minor=15000&max_amount_minor=20000"
        f"&date_from={timezone.localdate().isoformat()}&date_to={timezone.localdate().isoformat()}&search=Mock%20plan%20A"
    )
    bill_by_provider = client.get(f"{BASE}transactions/history/?category=bill&search=Water&min_amount_minor=5000")
    credits = client.get(f"{BASE}transactions/history/?direction=credit")
    invalid_amount_range = client.get(f"{BASE}transactions/history/?min_amount_minor=3000&max_amount_minor=2000")
    invalid_status = client.get(f"{BASE}transactions/history/?status=unknown")

    assert transfer.status_code == recharge.status_code == bill.status_code == topup.status_code == 200
    assert first_page.status_code == second_page.status_code == 200
    assert first_page.data["count"] == 4
    assert first_page.data["page"] == 1 and first_page.data["page_size"] == 1
    assert first_page.data["total_pages"] == 4 and first_page.data["has_next"] is True
    assert second_page.data["results"][0]["reference"] != first_page.data["results"][0]["reference"]
    assert filtered.data["count"] == 1
    assert filtered.data["results"][0]["reference"] == recharge.data["reference"]
    assert bill_by_provider.data["count"] == 1
    assert bill_by_provider.data["results"][0]["reference"] == bill.data["reference"]
    assert credits.data["count"] == 1
    assert credits.data["results"][0]["reference"] == topup.data["reference"]
    assert invalid_amount_range.status_code == invalid_status.status_code == 400


@pytest.mark.django_db
def test_transaction_history_is_authenticated_and_scoped_to_the_request_user():
    owner = make_user()
    owner_client = make_client(owner)
    payment = owner_client.post(
        f"{BASE}transactions/", payment_payload(), format="json", **headers("private-history-key-01")
    )
    other_client = make_client(make_user(email="history-intruder@example.test", full_name="History Intruder"))
    anonymous = APIClient().get(f"{BASE}transactions/history/")
    other_history = other_client.get(f"{BASE}transactions/history/")

    assert payment.status_code == 200
    assert anonymous.status_code == 401
    assert other_history.status_code == 200
    assert other_history.data["count"] == 0
    assert other_history.data["results"] == []


@pytest.mark.django_db
def test_customer_cannot_reverse_payment_but_internal_service_can():
    user = make_user()
    client = make_client(user)
    balance_before = client.get(f"{BASE}wallet/").data["balance_minor"]

    payment = client.post(
        f"{BASE}transactions/",
        payment_payload(amount_minor=25_000),
        format="json",
        **headers("reversible-payment-key-01"),
    )

    reversal_path = f"{BASE}transactions/{payment.data['reference']}/reverse/"
    first = client.post(
        reversal_path, {}, format="json", **headers("reverse-request-key-001")
    )
    history = client.get(f"{BASE}transactions/")

    assert first.status_code == 403
    assert history.data[0]["status"] == "successful"
    assert Wallet.objects.get(user=user).balance_minor == balance_before - 25_000
    assert not WalletLedgerEntry.objects.filter(
        transaction__reference=payment.data["reference"],
        entry_type="reversal_credit",
    ).exists()

    from apps.payments.services import PaymentConflict, reverse_transaction

    reversed_payment = reverse_transaction(
        user, payment.data["reference"], "internal-reversal-key-001"
    )
    replay = reverse_transaction(
        user, payment.data["reference"], "internal-reversal-key-001"
    )

    assert reversed_payment.status == "reversed"
    assert replay.reference == payment.data["reference"]
    assert Wallet.objects.get(user=user).balance_minor == balance_before
    assert (
        WalletLedgerEntry.objects.filter(
            transaction__reference=payment.data["reference"],
            entry_type="reversal_credit",
        ).count()
        == 1
    )

    with pytest.raises(PaymentConflict):
        reverse_transaction(
            user, payment.data["reference"], "internal-reversal-key-002"
        )


@pytest.mark.django_db
def test_transaction_detail_and_receipt_do_not_disclose_another_users_payment():
    owner = make_user()
    owner_client = make_client(owner)
    list_recipients(owner)
    payment = owner_client.post(
        f"{BASE}transactions/",
        payment_payload(),
        format="json",
        **headers("private-payment-key-001"),
    )
    other_client = make_client(
        make_user(email="intruder@example.test", full_name="Intruder")
    )

    detail = other_client.get(f"{BASE}transactions/{payment.data['reference']}/")
    status_response = other_client.get(
        f"{BASE}transactions/{payment.data['reference']}/status/"
    )
    receipt = other_client.get(
        f"{BASE}transactions/{payment.data['reference']}/receipt/"
    )

    assert (
        detail.status_code == status_response.status_code == receipt.status_code == 404
    )
    assert other_client.get(f"{BASE}transactions/").data == []


@pytest.mark.django_db(transaction=True)
def test_concurrent_payments_cannot_spend_the_same_demo_balance_twice():
    user = make_user()
    get_or_create_wallet(user)
    recipient = list_recipients(user).first()

    def submit(key):
        close_old_connections()
        try:
            worker_user = User.objects.get(pk=user.pk)
            return initiate_payment(
                worker_user,
                {
                    "kind": "transfer",
                    "recipient_id": recipient.pk,
                    "amount_minor": 1_500_000,
                    "note": "concurrency test",
                },
                key,
            ).status
        except ValidationError:
            return "insufficient_balance"
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(
                submit, ("concurrent-payment-key-01", "concurrent-payment-key-02")
            )
        )

    wallet = Wallet.objects.get(user=user)
    assert sorted(results) == [
        "insufficient_balance",
        PaymentTransaction.Status.SUCCESSFUL,
    ]
    assert wallet.balance_minor == 958_000
    assert PaymentTransaction.objects.filter(sender=user).count() == 1
    assert (
        WalletLedgerEntry.objects.filter(wallet=wallet, entry_type="debit").count() == 1
    )


@pytest.mark.django_db
def test_payment_endpoints_require_backend_authentication():
    client = APIClient()
    response = client.get(f"{BASE}wallet/")
    reversal = client.post(f"{BASE}transactions/OPW-UNKNOWN/reverse/", {}, format="json")
    qr_generation = client.post(f"{BASE}qr/generate/", {}, format="json")
    qr_resolution = client.post(f"{BASE}qr/resolve/", {"qr_content": ""}, format="json")

    assert (
        response.status_code
        == reversal.status_code
        == qr_generation.status_code
        == qr_resolution.status_code
        == 401
    )
    assert response.data["error"]["status"] == 401
    assert reversal.data["error"]["status"] == 401
