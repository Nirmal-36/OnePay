from datetime import date, datetime, time, timedelta

import pytest
from django.utils import timezone

from apps.payments.models import PaymentTransaction

from .helpers import client_for, make_transaction, make_user, previous_month_day, this_month_day

BASE = "/api/v1/analytics/"


@pytest.mark.django_db
def test_summary_calculates_only_eligible_transactions_and_separates_topups():
    user = make_user()
    make_transaction(
        user, amount=60_000, note="Swiggy dinner", recipient_name="Swiggy", recipient_identifier="swiggy@mock",
        created_at=this_month_day(3),
    )
    make_transaction(
        user, amount=40_000, note="BigBasket groceries", recipient_name="BigBasket",
        recipient_identifier="bigbasket@mock", created_at=this_month_day(4),
    )
    make_transaction(
        user, amount=30_000, kind="bill", service="electricity", recipient_name="OnePay Mock Electricity",
        created_at=this_month_day(5),
    )
    make_transaction(
        user, amount=90_000, note="Zomato lunch", recipient_name="Zomato", recipient_identifier="zomato@mock",
        created_at=this_month_day(6),
    )
    make_transaction(
        user, amount=100_000, kind="topup", recipient_name="OnePay Demo Wallet",
        recipient_identifier="topup@onepay", created_at=this_month_day(6),
    )
    make_transaction(user, amount=20_000, status="pending", note="Swiggy", created_at=this_month_day(7))
    make_transaction(user, amount=15_000, status="failed", note="Amazon", created_at=this_month_day(8))
    make_transaction(user, amount=25_000, status="reversed", note="Amazon", created_at=this_month_day(9))
    own_transfer = make_transaction(
        user, amount=50_000, recipient_name=user.full_name,
        recipient_identifier=f"user{user.pk}@onepay", created_at=this_month_day(10),
    )

    response = client_for(user).get(f"{BASE}summary/?period=this_month")

    assert response.status_code == 200
    data = response.data
    assert data["total_spending_minor"] == 220_000
    assert data["transaction_count"] == 4
    assert data["consumption_spending_minor"] == 220_000
    assert sum(item["amount_minor"] for item in data["categories"]) == 220_000
    assert abs(sum(item["percentage"] for item in data["categories"]) - 100.0) < 0.2
    assert data["money_received_minor"] is None
    assert data["net_cash_flow_minor"] is None
    assert data["income_data_available"] is False
    assert data["money_received"]["available"] is False
    assert data["demo_topups_minor"] == 100_000
    assert data["demo_topup_count"] == 1
    assert data["largest_expense"]["amount_minor"] == 90_000
    assert data["highest_category"]["category"] == "Food and Dining"
    assert data["excluded_activity"]["pending"]["count"] == 1
    assert data["excluded_activity"]["failed"]["count"] == 1
    assert data["excluded_activity"]["reversed"]["count"] == 1
    assert data["excluded_activity"]["internal_transfer"]["count"] == 1
    assert data["excluded_activity"]["internal_transfer"]["amount_minor"] == 50_000
    assert data["data_quality"]["transaction_count"] == 4
    assert data["categorization"]["external_ai_used"] is False
    assert data["categorization"]["external_ai_configured"] is False
    assert "recipient_identifier" not in data["recent_transactions"][0]
    assert data["recent_transactions"][0]["source"] == "simulated"
    assert all(
        transaction["reference"] != own_transfer.reference for transaction in data["recent_transactions"]
    )
    assert data["budget_overview"]["month"] == timezone.localdate().strftime("%Y-%m")
    assert data["daily_trend"][0]["date"] == data["period"]["start_date"]
    assert len(data["daily_trend"]) == data["period"]["days"]
    assert data["weekday_weekend"]["weekday"]["days"] > 0


@pytest.mark.django_db
def test_transaction_table_filters_search_amount_sort_and_pagination():
    user = make_user()
    make_transaction(user, amount=12_500, note="Cafe coffee", recipient_name="Local Cafe", created_at=this_month_day(2))
    make_transaction(user, amount=45_000, note="Amazon order", recipient_name="Amazon", created_at=this_month_day(3))
    make_transaction(user, amount=30_000, note="BigBasket", recipient_name="BigBasket", created_at=this_month_day(4))
    client = client_for(user)

    filtered = client.get(
        f"{BASE}transactions/?period=this_month&category=Shopping&search=amazon&sort=amount_desc&page_size=1"
    )
    assert filtered.status_code == 200
    assert filtered.data["count"] == 1
    assert filtered.data["results"][0]["amount_minor"] == 45_000
    assert filtered.data["filters"]["category"] == "Shopping"
    assert filtered.data["filtered_total_minor"] == 45_000
    assert "recipient_identifier" not in filtered.data["results"][0]

    grocery = client.get(f"{BASE}transactions/?period=this_month&category=Groceries")
    assert grocery.data["count"] == 1
    assert grocery.data["results"][0]["merchant"] == "BigBasket"

    ranged = client.get(f"{BASE}transactions/?period=this_month&min_amount_minor=20000&max_amount_minor=40000")
    assert ranged.data["count"] == 1
    assert ranged.data["results"][0]["amount_minor"] == 30_000

    paged = client.get(f"{BASE}transactions/?period=this_month&page_size=2&sort=amount_asc")
    assert paged.data["count"] == 3
    assert paged.data["total_pages"] == 2
    assert paged.data["has_next"] is True
    assert paged.data["results"][0]["amount_minor"] == 12_500

    assert client.get(f"{BASE}transactions/?period=this_month&category=Nonsense").status_code == 400
    assert client.get(f"{BASE}transactions/?period=this_month&page_size=51").status_code == 400
    assert client.get(f"{BASE}transactions/?period=this_month&sort=random").status_code == 400
    assert client.get(
        f"{BASE}transactions/?period=this_month&min_amount_minor=5000&max_amount_minor=1000"
    ).status_code == 400


@pytest.mark.django_db
def test_month_comparison_uses_same_elapsed_days_for_partial_month():
    user = make_user()
    make_transaction(user, amount=100_000, note="Swiggy", created_at=this_month_day(5))
    make_transaction(user, amount=60_000, note="Swiggy", created_at=previous_month_day(1))
    client = client_for(user)

    first = client.get(f"{BASE}summary/?period=this_month")
    assert first.status_code == 200
    comparison = first.data["month_over_month"]
    assert comparison["current_total_minor"] == 100_000
    assert comparison["previous_total_minor"] == 60_000
    assert comparison["change_minor"] == 40_000
    assert comparison["change_percent"] == 66.7

    # A payment after the comparable elapsed-day window must not change the baseline.
    comparison_end = date.fromisoformat(comparison["comparison_end"])
    late_day = comparison_end + timedelta(days=1)
    make_transaction(
        user,
        amount=500_000,
        note="Swiggy",
        created_at=timezone.make_aware(
            datetime.combine(late_day, time(12)), timezone.get_current_timezone()
        ),
    )
    second = client.get(f"{BASE}summary/?period=this_month")
    assert second.data["month_over_month"]["previous_total_minor"] == 60_000


@pytest.mark.django_db
def test_empty_history_returns_clear_zeros_and_sufficiency_flags():
    user = make_user()
    client = client_for(user)
    summary = client.get(f"{BASE}summary/?period=this_month")
    assert summary.status_code == 200
    assert summary.data["total_spending_minor"] == 0
    assert summary.data["transaction_count"] == 0
    assert summary.data["categories"] == []
    assert summary.data["largest_expense"] is None
    assert summary.data["highest_category"] is None
    assert summary.data["recent_insights"] == []
    assert summary.data["data_quality"]["sufficient_for_insights"] is False
    assert summary.data["data_quality"]["sufficient_for_forecast"] is False
    assert summary.data["data_quality"]["notes"]

    categories = client.get(f"{BASE}categories/?period=this_month")
    assert categories.data["categories"] == []
    insights = client.get(f"{BASE}insights/?period=this_month")
    assert insights.data["insights"] == []
    assert insights.data["empty_reason"]

    forecast = client.get(f"{BASE}forecast/")
    assert forecast.data["eligible"] is False
    assert forecast.data["current_month"] is None
    assert forecast.data["reasons"]
    anomalies = client.get(f"{BASE}anomalies/?period=this_month")
    assert anomalies.data["eligible"] is False
    assert anomalies.data["anomalies"] == []


@pytest.mark.django_db
def test_category_correction_updates_summary_and_future_matching_transactions():
    user = make_user()
    reference_keys = "swiggy-correction@mock"
    first = make_transaction(
        user, amount=10_000, note="Swiggy dinner", recipient_name="Swiggy",
        recipient_identifier=reference_keys, created_at=this_month_day(2),
    )
    make_transaction(
        user, amount=10_000, note="Swiggy dinner", recipient_name="Swiggy",
        recipient_identifier=reference_keys, created_at=this_month_day(3),
    )
    client = client_for(user)
    baseline = client.get(f"{BASE}summary/?period=this_month")
    assert baseline.data["categories"][0]["category"] == "Food and Dining"
    assert baseline.data["categories"][0]["amount_minor"] == 20_000

    detail = client.get(f"{BASE}transactions/{first.reference}/category/")
    assert detail.status_code == 200
    assert detail.data["category"] == "Food and Dining"
    assert detail.data["correction"] is None

    corrected = client.post(
        f"{BASE}transactions/{first.reference}/category/",
        {"category": "Groceries", "subcategory": "Other groceries", "apply_to_future": True},
        format="json",
    )
    assert corrected.status_code == 200
    assert corrected.data["transaction"]["category"] == "Groceries"
    assert corrected.data["transaction"]["classification_method"] == "manual_override"

    after = client.get(f"{BASE}summary/?period=this_month")
    by_category = {item["category"]: item["amount_minor"] for item in after.data["categories"]}
    assert by_category == {"Groceries": 20_000}

    corrections = client.get(f"{BASE}corrections/")
    assert corrections.data["count"] == 1
    assert corrections.data["results"][0]["apply_to_future"] is True

    deleted = client.delete(f"{BASE}transactions/{first.reference}/category/")
    assert deleted.status_code == 204
    restored = client.get(f"{BASE}summary/?period=this_month")
    assert restored.data["categories"][0]["category"] == "Food and Dining"

    invalid = client.post(
        f"{BASE}transactions/{first.reference}/category/", {"category": "Made up"}, format="json"
    )
    assert invalid.status_code == 400


@pytest.mark.django_db
def test_non_reusable_correction_only_changes_one_transaction():
    user = make_user()
    first = make_transaction(
        user, amount=10_000, note="Swiggy dinner", recipient_name="Swiggy",
        recipient_identifier="swiggy-once@mock", created_at=this_month_day(2),
    )
    make_transaction(
        user, amount=10_000, note="Swiggy dinner", recipient_name="Swiggy",
        recipient_identifier="swiggy-once@mock", created_at=this_month_day(3),
    )
    response = client_for(user).post(
        f"{BASE}transactions/{first.reference}/category/",
        {"category": "Other", "subcategory": "Other", "apply_to_future": False},
        format="json",
    )
    assert response.status_code == 200
    summary = client_for(user).get(f"{BASE}summary/?period=this_month")
    by_category = {item["category"]: item["amount_minor"] for item in summary.data["categories"]}
    assert by_category == {"Other": 10_000, "Food and Dining": 10_000}


@pytest.mark.django_db
def test_preferences_require_explicit_consent_and_are_user_scoped():
    user = make_user()
    other = make_user()
    client = client_for(user)
    initial = client.get(f"{BASE}preferences/")
    assert initial.status_code == 200
    assert initial.data["external_ai_consent"] is False
    assert initial.data["status"]["configured"] is False

    enabled = client.patch(f"{BASE}preferences/", {"external_ai_consent": True}, format="json")
    assert enabled.status_code == 200
    assert enabled.data["external_ai_consent"] is True
    assert enabled.data["consent_updated_at"] is not None

    other_state = client_for(other).get(f"{BASE}preferences/")
    assert other_state.data["external_ai_consent"] is False

    invalid = client.patch(f"{BASE}preferences/", {"external_ai_consent": "yes"}, format="json")
    assert invalid.status_code == 400
    withdrawn = client.patch(f"{BASE}preferences/", {"external_ai_consent": False}, format="json")
    assert withdrawn.data["external_ai_consent"] is False
    assert withdrawn.data["consent_updated_at"] is None


@pytest.mark.django_db
def test_analytics_endpoints_reject_anonymous_users():
    from rest_framework.test import APIClient

    client = APIClient()
    for path in (
        "summary/",
        "transactions/",
        "categories/",
        "trends/",
        "merchants/",
        "insights/",
        "forecast/",
        "anomalies/",
        "reports/months/",
        "budgets/",
        "goals/",
        "preferences/",
        "meta/",
    ):
        response = client.get(f"{BASE}{path}")
        assert response.status_code in {401, 403}, path


@pytest.mark.django_db
def test_trends_merchants_and_meta_are_calculated_from_records():
    user = make_user()
    make_transaction(
        user, amount=50_000, note="Swiggy", recipient_name="Swiggy", recipient_identifier="swiggy@mock",
        created_at=this_month_day(2),
    )
    make_transaction(
        user, amount=25_000, note="Swiggy", recipient_name="Swiggy", recipient_identifier="swiggy@mock",
        created_at=this_month_day(3),
    )
    make_transaction(
        user, amount=35_000, note="Zomato", recipient_name="Zomato", recipient_identifier="zomato@mock",
        created_at=this_month_day(4),
    )
    client = client_for(user)

    trends = client.get(f"{BASE}trends/?period=last_3_months")
    assert trends.status_code == 200
    assert len(trends.data["daily"]) == trends.data["period"]["days"]
    assert len(trends.data["monthly"]) == 3
    assert trends.data["total_spending_minor"] == 110_000
    assert "weekday" in trends.data["weekday_weekend"]

    merchants = client.get(f"{BASE}merchants/?period=this_month")
    assert merchants.status_code == 200
    assert merchants.data["merchants"][0]["name"] == "Swiggy"
    assert merchants.data["merchants"][0]["amount_minor"] == 75_000
    assert merchants.data["merchants"][0]["transaction_count"] == 2

    meta = client.get(f"{BASE}meta/")
    assert meta.status_code == 200
    assert len(meta.data["categories"]) == 18
    assert meta.data["money_received"]["income_tracking_available"] is False
    assert meta.data["categorization"]["configured"] is False

    assert client.get(f"{BASE}trends/?period=this_month&granularity=weekly").status_code == 400
