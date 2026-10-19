from datetime import datetime, time, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from apps.payments.models import PaymentTransaction

User = get_user_model()
BASE = "/api/v1/analytics/"


def make_user(email="analytics@example.test"):
    return User.objects.create_user(email=email, password="OnePay!SecurePass2026", full_name="Analytics Tester")


def make_transaction(user, *, key, amount=1000, kind="transfer", status="successful", note="", recipient_name="Rohan Mehta", recipient_identifier="rohan@onepay", service="", created_at=None):
    transaction_obj = PaymentTransaction.objects.create(
        sender=user,
        sender_name=user.full_name,
        recipient_name=recipient_name,
        recipient_identifier=recipient_identifier,
        kind=kind,
        service=service,
        note=note,
        amount_minor=amount,
        currency="INR",
        status=PaymentTransaction.Status.PENDING,
        idempotency_key=key,
        request_fingerprint=(key.encode().hex()[:64]).ljust(64, "0"),
        created_at=created_at or timezone.now(),
    )
    if status == PaymentTransaction.Status.SUCCESSFUL:
        transaction_obj.record_status_transition(PaymentTransaction.Status.SUCCESSFUL, actor=user, reason="test transaction")
    elif status == PaymentTransaction.Status.FAILED:
        transaction_obj.record_status_transition(PaymentTransaction.Status.FAILED, actor=user, reason="test transaction")
    elif status == PaymentTransaction.Status.REVERSED:
        transaction_obj.record_status_transition(PaymentTransaction.Status.SUCCESSFUL, actor=user, reason="test transaction")
        transaction_obj.refresh_from_db()
        transaction_obj.record_status_transition(PaymentTransaction.Status.REVERSED, actor=user, reason="test reversal")
    return transaction_obj


@pytest.mark.django_db
def test_summary_counts_only_successful_outgoing_spending_and_separates_topups():
    user = make_user()
    client = APIClient()
    client.force_authenticate(user=user)
    make_transaction(user, key="analytics-food-0001", amount=2500, note="Zomato order", recipient_name="Zomato")
    make_transaction(user, key="analytics-utility-01", amount=3200, kind="bill", service="electricity", recipient_name="OnePay Mock Electricity")
    make_transaction(user, key="analytics-topup-001", amount=10000, kind="topup", recipient_name="OnePay Demo Wallet")
    make_transaction(user, key="analytics-pending-01", amount=9000, status="pending", note="Swiggy order", recipient_name="Swiggy")
    make_transaction(user, key="analytics-failed-001", amount=8000, status="failed", note="Groceries")
    make_transaction(user, key="analytics-reversed-1", amount=7000, status="reversed", note="Amazon order", recipient_name="Amazon")

    response = client.get(f"{BASE}summary/?period=this_month")

    assert response.status_code == 200
    assert response.data["total_spending_minor"] == 5700
    assert response.data["transaction_count"] == 2
    assert response.data["money_received_minor"] is None
    assert response.data["net_cash_flow_minor"] is None
    assert response.data["income_data_available"] is False
    assert response.data["demo_topups_minor"] == 10000
    assert {item["category"] for item in response.data["categories"]} == {"Food and Dining", "Bills and Utilities"}
    assert response.data["excluded_activity"]["pending"]["count"] == 1
    assert response.data["excluded_activity"]["failed"]["count"] == 1
    assert response.data["excluded_activity"]["reversed"]["count"] == 1


@pytest.mark.django_db
def test_analytics_is_scoped_to_authenticated_owner_and_excludes_own_account_transfer():
    user = make_user()
    other = make_user("other-analytics@example.test")
    make_transaction(user, key="analytics-own-xfer-01", amount=5000, recipient_identifier=f"user{user.pk}@onepay", recipient_name="Analytics Tester")
    make_transaction(other, key="analytics-other-user1", amount=90000, note="Zomato order", recipient_name="Zomato")
    client = APIClient()
    client.force_authenticate(user=user)

    summary = client.get(f"{BASE}summary/")
    transactions = client.get(f"{BASE}transactions/")

    assert summary.status_code == 200
    assert summary.data["total_spending_minor"] == 0
    assert summary.data["transaction_count"] == 0
    assert transactions.status_code == 200
    assert transactions.data["count"] == 0


@pytest.mark.django_db
def test_category_filter_returns_only_matching_categorized_transactions_without_private_identifier():
    user = make_user()
    make_transaction(user, key="analytics-food-0002", amount=1250, note="Cafe coffee", recipient_name="Local Cafe")
    make_transaction(user, key="analytics-shop-0001", amount=4500, note="Amazon shopping", recipient_name="Amazon")
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get(f"{BASE}transactions/?period=this_month&category=Food%20and%20Dining")

    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["category"] == "Food and Dining"
    assert response.data["results"][0]["amount_minor"] == 1250
    assert "recipient_identifier" not in response.data["results"][0]


@pytest.mark.django_db
def test_custom_range_validation_and_unauthenticated_access():
    client = APIClient()
    assert client.get(f"{BASE}summary/").status_code in {401, 403}

    user = make_user()
    client.force_authenticate(user=user)
    invalid = client.get(f"{BASE}summary/?period=custom&date_from=2026-10-10&date_to=2026-10-01")
    missing = client.get(f"{BASE}summary/?period=custom&date_from=2026-10-01")
    invalid_period = client.get(f"{BASE}summary/?period=all_time")

    assert invalid.status_code == 400
    assert missing.status_code == 400
    assert invalid_period.status_code == 400


@pytest.mark.django_db
def test_custom_range_uses_date_boundaries_inclusive_of_end_date():
    user = make_user()
    now = timezone.localtime(timezone.now())
    start = now.date() - timedelta(days=2)
    end = now.date() - timedelta(days=1)
    make_transaction(user, key="analytics-custom-in-01", amount=1200, note="Cafe", created_at=timezone.make_aware(datetime.combine(start, time.min), timezone.get_current_timezone()))
    make_transaction(user, key="analytics-custom-out1", amount=900, note="Cafe", created_at=timezone.make_aware(datetime.combine(end + timedelta(days=1), time.min), timezone.get_current_timezone()))
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get(f"{BASE}summary/?period=custom&date_from={start.isoformat()}&date_to={end.isoformat()}")

    assert response.status_code == 200
    assert response.data["total_spending_minor"] == 1200
    assert response.data["period"]["end_date"] == end.isoformat()
