import pytest
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model

from apps.payments.models import PaymentTransaction, Wallet, WalletLedgerEntry

User = get_user_model()
BASE = "/api/v1/payments/"


@pytest.mark.django_db
def test_topup_is_a_validated_idempotent_server_credit():
    user = User.objects.create_user(
        email="topup@example.test",
        password="OnePay!SecurePass2026",
        full_name="Top Up User",
    )
    client = APIClient()
    client.force_authenticate(user=user)
    key = "topup-idempotency-key-01"
    payload = {"amount_minor": 10_000}

    first = client.post(f"{BASE}wallet/topups/", payload, format="json", HTTP_IDEMPOTENCY_KEY=key)
    replay = client.post(f"{BASE}wallet/topups/", payload, format="json", HTTP_IDEMPOTENCY_KEY=key)
    invalid = client.post(f"{BASE}wallet/topups/", {"amount_minor": 12_345}, format="json", HTTP_IDEMPOTENCY_KEY="topup-invalid-key-001")
    forbidden_reversal = client.post(
        f"{BASE}transactions/{first.data['reference']}/reverse/",
        {}, format="json", HTTP_IDEMPOTENCY_KEY="topup-reversal-key-001",
    )

    assert first.status_code == replay.status_code == 200
    assert first.data["reference"] == replay.data["reference"]
    assert first.data["kind"] == "topup"
    assert first.data["status"] == "successful"
    assert invalid.status_code == 400
    assert forbidden_reversal.status_code == 409
    assert Wallet.objects.get(user=user).balance_minor == 2_468_000
    assert PaymentTransaction.objects.filter(sender=user, kind="topup").count() == 1
    assert WalletLedgerEntry.objects.filter(transaction__reference=first.data["reference"], entry_type="topup_credit").count() == 1
