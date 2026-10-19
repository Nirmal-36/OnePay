from datetime import date, datetime, time, timedelta

import pytest
from django.utils import timezone

from apps.analytics.periods import shift_month

from .helpers import client_for, make_transaction, make_user, previous_month_day, this_month_day

BASE = "/api/v1/analytics/"


def _date_at(day: date, hour: int = 12, minute: int = 0) -> datetime:
    return timezone.make_aware(
        datetime.combine(day, time(hour=hour, minute=minute)), timezone.get_current_timezone()
    )


@pytest.mark.django_db
def test_budget_crud_warnings_recommendation_and_transfer_exclusion():
    user = make_user()
    make_transaction(
        user, amount=85_000, note="Swiggy", recipient_name="Swiggy", recipient_identifier="swiggy@mock",
        created_at=this_month_day(3),
    )
    make_transaction(
        user, amount=40_000, note="BigBasket", recipient_name="BigBasket",
        recipient_identifier="bigbasket@mock", created_at=this_month_day(4),
    )
    make_transaction(
        user, amount=100_000, note="", recipient_name="A Friend",
        recipient_identifier="friend@mock", created_at=this_month_day(5),
    )
    client = client_for(user)
    month = timezone.localdate().strftime("%Y-%m")

    overall = client.post(
        f"{BASE}budgets/", {"month": month, "category": "", "limit_minor": 100_000}, format="json"
    )
    assert overall.status_code == 201
    overview = overall.data["overview"]
    assert overview["consumption_spending_minor"] == 125_000
    assert overview["overall"]["spent_minor"] == 125_000
    assert overview["overall"]["status"] == "exceeded"
    assert overview["overall"]["remaining_minor"] == -25_000
    assert overview["warnings"][0]["status"] == "exceeded"

    food = client.post(
        f"{BASE}budgets/",
        {"month": month, "category": "Food and Dining", "limit_minor": 90_000},
        format="json",
    )
    assert food.status_code == 201
    assert food.data["overview"]["categories"][0]["utilization_percent"] == 94.4
    assert food.data["overview"]["categories"][0]["status"] == "approaching"
    food_id = food.data["budget"]["id"]

    listing = client.get(f"{BASE}budgets/?month={month}")
    assert listing.status_code == 200
    assert len(listing.data["warnings"]) == 2
    assert listing.data["has_any_budget"] is True
    assert listing.data["recommendation"]["available"] is False
    assert listing.data["total_category_limits_minor"] == 90_000
    assert listing.data["comparison"]["previous_month"] == shift_month(timezone.localdate().replace(day=1), -1).strftime("%Y-%m")

    patched = client.patch(
        f"{BASE}budgets/{food_id}/", {"limit_minor": 200_000}, format="json"
    )
    assert patched.status_code == 200
    assert patched.data["overview"]["categories"][0]["status"] == "on_track"
    assert patched.data["overview"]["categories"][0]["remaining_minor"] == 115_000

    upsert = client.post(
        f"{BASE}budgets/", {"month": month, "category": "", "limit_minor": 300_000}, format="json"
    )
    assert upsert.status_code == 200
    assert upsert.data["created"] is False
    assert upsert.data["overview"]["overall"]["status"] == "on_track"

    invalid_transfer = client.post(
        f"{BASE}budgets/", {"month": month, "category": "Transfers", "limit_minor": 50_000}, format="json"
    )
    assert invalid_transfer.status_code == 400
    assert client.post(
        f"{BASE}budgets/", {"month": month, "category": "Other", "limit_minor": 0}, format="json"
    ).status_code == 400
    assert client.post(
        f"{BASE}budgets/", {"month": "2026-13", "category": "", "limit_minor": 1000}, format="json"
    ).status_code == 400

    deleted = client.delete(f"{BASE}budgets/{food_id}/")
    assert deleted.status_code == 200
    assert deleted.data["overview"]["categories"] == []

    other = make_user()
    other_client = client_for(other)
    assert other_client.patch(
        f"{BASE}budgets/{overall.data['budget']['id']}/", {"limit_minor": 5000}, format="json"
    ).status_code == 404
    assert other_client.delete(f"{BASE}budgets/{overall.data['budget']['id']}/").status_code == 404
    assert other_client.get(f"{BASE}budgets/?month={month}").data["overall"] is None


@pytest.mark.django_db
def test_budget_recommendation_requires_two_complete_months_and_is_labelled_estimate():
    user = make_user()
    today = timezone.localdate()
    two_months_ago = shift_month(today.replace(day=1), -2)
    last_month = shift_month(today.replace(day=1), -1)
    for index in range(6):
        make_transaction(
            user, amount=30_000, note="Swiggy", recipient_name="Swiggy",
            recipient_identifier="swiggy-rec@mock",
            created_at=_date_at(two_months_ago.replace(day=index + 1)),
        )
        make_transaction(
            user, amount=20_000, note="BigBasket", recipient_name="BigBasket",
            recipient_identifier="bigbasket-rec@mock",
            created_at=_date_at(last_month.replace(day=index + 1)),
        )

    response = client_for(user).get(f"{BASE}budgets/")
    recommendation = response.data["recommendation"]
    assert recommendation["available"] is True
    assert recommendation["label"] == "Estimate"
    assert recommendation["overall_estimate_minor"] > 0
    assert recommendation["overall_estimate_minor"] % 10_000 == 0
    assert recommendation["categories"]
    assert "estimate" in recommendation["basis"].lower() or "average" in recommendation["basis"].lower()
    assert recommendation["limitations"]
    assert response.data["overall"] is None
    assert response.data["consumption_spending_minor"] == 0


@pytest.mark.django_db
def test_savings_goal_crud_progress_and_isolation():
    user = make_user()
    other = make_user()
    client = client_for(user)
    target_date = timezone.localdate() + timedelta(days=90)
    created = client.post(
        f"{BASE}goals/",
        {
            "name": "Emergency fund",
            "target_amount_minor": 100_000,
            "saved_amount_minor": 25_000,
            "target_date": target_date.isoformat(),
            "note": "User-recorded progress",
        },
        format="json",
    )
    assert created.status_code == 201
    goal = created.data["goal"]
    assert goal["progress_percent"] == 25.0
    assert goal["remaining_minor"] == 75_000
    assert goal["monthly_amount_needed_minor"] == 25_000
    assert goal["progress_source"] == "user_recorded"
    goal_id = goal["id"]

    listing = client.get(f"{BASE}goals/")
    assert listing.status_code == 200
    assert listing.data["count"] == 1
    assert listing.data["summary"]["total_target_minor"] == 100_000
    assert listing.data["summary"]["total_saved_minor"] == 25_000

    updated = client.patch(
        f"{BASE}goals/{goal_id}/", {"saved_amount_minor": 100_000}, format="json"
    )
    assert updated.status_code == 200
    assert updated.data["goal"]["status"] == "complete"
    assert updated.data["goal"]["progress_percent"] == 100.0

    archived = client.patch(f"{BASE}goals/{goal_id}/", {"is_archived": True}, format="json")
    assert archived.status_code == 200
    assert client.get(f"{BASE}goals/").data["count"] == 0
    assert client.get(f"{BASE}goals/?include_archived=true").data["count"] == 1

    assert client.post(
        f"{BASE}goals/", {"name": "A", "target_amount_minor": 0}, format="json"
    ).status_code == 400
    assert client_for(other).get(f"{BASE}goals/").data["count"] == 0
    assert client_for(other).patch(
        f"{BASE}goals/{goal_id}/", {"saved_amount_minor": 1}, format="json"
    ).status_code == 404
    assert client_for(other).delete(f"{BASE}goals/{goal_id}/").status_code == 404
    assert client.delete(f"{BASE}goals/{goal_id}/").status_code == 204


@pytest.mark.django_db
def test_forecast_is_withheld_without_history_and_transparent_with_enough_history():
    empty_user = make_user()
    empty = client_for(empty_user).get(f"{BASE}forecast/")
    assert empty.status_code == 200
    assert empty.data["eligible"] is False
    assert empty.data["current_month"] is None
    assert empty.data["next_month"] is None
    assert empty.data["method"]["limitations"]

    user = make_user()
    today = timezone.localdate()
    for offset in range(6, 96, 4):
        make_transaction(
            user, amount=25_000, note="Swiggy", recipient_name="Swiggy",
            recipient_identifier="swiggy-forecast@mock",
            created_at=_date_at(today - timedelta(days=offset)),
        )
    make_transaction(
        user, amount=50_000, note="Swiggy", recipient_name="Swiggy",
        recipient_identifier="swiggy-forecast@mock", created_at=this_month_day(2),
    )
    forecast = client_for(user).get(f"{BASE}forecast/")
    assert forecast.status_code == 200
    assert forecast.data["eligible"] is True
    assert forecast.data["reasons"] == []
    current = forecast.data["current_month"]
    assert current["actual_to_date_minor"] >= 50_000
    assert current["projected_total_minor"] >= current["actual_to_date_minor"]
    assert current["range_minor"][0] <= current["projected_total_minor"]
    assert current["range_minor"][0] <= current["range_minor"][1]
    assert current["data_type"] == "forecast"
    assert current["is_estimate"] is True
    assert forecast.data["next_month"]["projected_total_minor"] > 0
    assert forecast.data["next_month"]["range_minor"][0] <= forecast.data["next_month"]["projected_total_minor"]
    assert forecast.data["category_projections"]
    assert all(item["is_estimate"] for item in forecast.data["category_projections"])
    assert "not a guarantee" in " ".join(forecast.data["method"]["limitations"]).lower()


@pytest.mark.django_db
def test_anomaly_detection_uses_the_users_own_baseline():
    user = make_user()
    today = timezone.localdate()
    for offset in range(20, 140, 10):
        make_transaction(
            user, amount=20_000, note="Cafe", recipient_name="Local Cafe",
            recipient_identifier="cafe-anomaly@mock",
            created_at=_date_at(today - timedelta(days=offset)),
        )
    unusual = make_transaction(
        user, amount=500_000, note="Cafe", recipient_name="Local Cafe",
        recipient_identifier="cafe-anomaly@mock", created_at=this_month_day(3),
    )
    response = client_for(user).get(f"{BASE}anomalies/?period=this_month")
    assert response.status_code == 200
    assert response.data["eligible"] is True
    transaction_anomalies = [item for item in response.data["anomalies"] if item["type"] == "transaction"]
    assert transaction_anomalies
    assert transaction_anomalies[0]["reference"] == unusual.reference
    assert transaction_anomalies[0]["amount_minor"] == 500_000
    assert transaction_anomalies[0]["baseline_median_minor"] == 20_000
    assert "universal rupee threshold" in response.data["method"]["description"].lower()

    other = make_user()
    make_transaction(
        other, amount=500_000, note="Cafe", recipient_name="Local Cafe",
        recipient_identifier="cafe-anomaly-other@mock", created_at=this_month_day(3),
    )
    insufficient = client_for(other).get(f"{BASE}anomalies/?period=this_month")
    assert insufficient.data["eligible"] is False
    assert insufficient.data["anomalies"] == []
    assert insufficient.data["reasons"]


@pytest.mark.django_db
def test_monthly_report_navigation_executive_summary_and_csv_export():
    user = make_user()
    make_transaction(
        user, amount=60_000, note="Swiggy", recipient_name="Swiggy", recipient_identifier="swiggy@mock",
        created_at=this_month_day(2),
    )
    make_transaction(
        user, amount=40_000, note="BigBasket", recipient_name="BigBasket",
        recipient_identifier="bigbasket@mock", created_at=this_month_day(3),
    )
    make_transaction(
        user, amount=30_000, kind="bill", service="electricity", recipient_name="OnePay Mock Electricity",
        created_at=this_month_day(4),
    )
    make_transaction(
        user, amount=50_000, note="Swiggy", recipient_name="Swiggy", recipient_identifier="swiggy@mock",
        created_at=previous_month_day(5),
    )
    make_transaction(
        user, amount=10_000, note="", recipient_name="=SUM(1,1)", recipient_identifier="formula@mock",
        created_at=this_month_day(6),
    )
    client = client_for(user)
    today = timezone.localdate()
    month = today.strftime("%m")
    year = today.year

    months = client.get(f"{BASE}reports/months/")
    assert months.status_code == 200
    assert months.data["months"][-1]["month"] == today.strftime("%Y-%m")
    assert months.data["months"][-1]["is_current"] is True
    assert any(item["month"] == shift_month(today.replace(day=1), -1).strftime("%Y-%m") for item in months.data["months"])

    report = client.get(f"{BASE}reports/{year}/{int(month)}/")
    assert report.status_code == 200
    data = report.data
    assert data["label"]
    assert data["summary"]["total_spending_minor"] == 140_000
    assert data["summary"]["transaction_count"] == 4
    assert data["categories"]
    assert data["top_merchants"]
    assert data["largest_transactions"]
    assert "completed payments" in data["executive_summary"]
    assert "demo" in data["executive_summary"].lower()
    assert data["income_and_outflow"]["income_available"] is False
    assert data["month_over_month"]["comparison_start"]
    assert data["six_month_history"]
    assert data["budgets"]["month"] == today.strftime("%Y-%m")
    assert data["method_note"]
    assert data["limitations"]
    assert data["data_quality"]["transaction_count"] == 4

    csv_response = client.get(f"{BASE}reports/{year}/{int(month)}/export.csv")
    assert csv_response.status_code == 200
    assert csv_response["Content-Type"].startswith("text/csv")
    assert f"onepay-spending-report-{today.strftime('%Y-%m')}.csv" in csv_response["Content-Disposition"]
    body = csv_response.content.decode("utf-8")
    assert body.startswith("section,label,category,date,reference,amount_minor,amount_inr,percentage,count,detail")
    assert "Total completed outflow" in body
    assert "Food and Dining" in body
    assert "'=SUM(1,1)" in body
    assert "Executive" not in body or "executive_summary" in body

    assert client.get(f"{BASE}reports/{year}/13/").status_code == 400
    future = today.replace(day=1) + timedelta(days=62)
    assert client.get(f"{BASE}reports/{future.year}/{future.month}/").status_code == 400


@pytest.mark.django_db
def test_reports_and_csv_are_owner_scoped():
    owner = make_user()
    other = make_user()
    make_transaction(
        owner, amount=90_000, note="Swiggy", recipient_name="Swiggy", recipient_identifier="swiggy-owner@mock",
        created_at=this_month_day(2),
    )
    client = client_for(other)
    today = timezone.localdate()

    report = client.get(f"{BASE}reports/{today.year}/{today.month}/")
    assert report.status_code == 200
    assert report.data["summary"]["total_spending_minor"] == 0
    assert report.data["categories"] == []
    csv_response = client.get(f"{BASE}reports/{today.year}/{today.month}/export.csv")
    assert csv_response.status_code == 200
    assert "90,000.00" not in csv_response.content.decode("utf-8")
    months = client.get(f"{BASE}reports/months/")
    assert months.data["months"][-1]["has_data"] is False


@pytest.mark.django_db
def test_cross_user_isolation_for_analytics_and_corrections():
    owner = make_user()
    intruder = make_user()
    transaction = make_transaction(
        owner, amount=75_000, note="Swiggy", recipient_name="Swiggy",
        recipient_identifier="swiggy-private@mock", created_at=this_month_day(2),
    )
    client = client_for(intruder)

    assert client.get(f"{BASE}summary/?period=this_month").data["total_spending_minor"] == 0
    assert client.get(f"{BASE}transactions/?period=this_month").data["count"] == 0
    assert client.get(f"{BASE}categories/?period=this_month").data["categories"] == []
    assert client.get(f"{BASE}merchants/?period=this_month").data["merchants"] == []
    assert client.get(f"{BASE}insights/?period=this_month").data["insights"] == []
    assert client.get(f"{BASE}trends/?period=this_month").data["total_spending_minor"] == 0
    assert client.get(f"{BASE}transactions/{transaction.reference}/category/").status_code == 404
    assert client.post(
        f"{BASE}transactions/{transaction.reference}/category/",
        {"category": "Other", "subcategory": "Other", "apply_to_future": True},
        format="json",
    ).status_code == 404
    assert client.delete(f"{BASE}transactions/{transaction.reference}/category/").status_code == 404
    assert client.get(f"{BASE}corrections/").data["count"] == 0


@pytest.mark.django_db
def test_timezone_boundaries_are_local_midnight_and_custom_ranges_are_inclusive():
    user = make_user()
    today = timezone.localdate()
    month_start = today.replace(day=1)
    previous_day = month_start - timedelta(days=1)
    make_transaction(
        user, amount=11_000, note="Swiggy", recipient_name="Swiggy",
        recipient_identifier="swiggy-tz@mock",
        created_at=_date_at(month_start, hour=0, minute=0),
    )
    make_transaction(
        user, amount=99_000, note="Swiggy", recipient_name="Swiggy",
        recipient_identifier="swiggy-tz@mock",
        created_at=_date_at(previous_day, hour=23, minute=59),
    )
    client = client_for(user)

    current = client.get(f"{BASE}summary/?period=this_month")
    assert current.data["total_spending_minor"] == 11_000
    previous = client.get(f"{BASE}summary/?period=last_month")
    assert previous.data["total_spending_minor"] == 99_000

    inclusive = client.get(
        f"{BASE}summary/?period=custom&date_from={month_start.isoformat()}&date_to={month_start.isoformat()}"
    )
    assert inclusive.status_code == 200
    assert inclusive.data["total_spending_minor"] == 11_000
    assert inclusive.data["period"]["end_date"] == month_start.isoformat()


@pytest.mark.django_db
def test_cache_is_invalidated_by_new_transactions_and_budget_changes():
    user = make_user()
    client = client_for(user)
    make_transaction(
        user, amount=10_000, note="Swiggy", recipient_name="Swiggy",
        recipient_identifier="swiggy-cache@mock", created_at=this_month_day(2),
    )
    first = client.get(f"{BASE}summary/?period=this_month")
    assert first.data["total_spending_minor"] == 10_000

    make_transaction(
        user, amount=5_000, note="Swiggy", recipient_name="Swiggy",
        recipient_identifier="swiggy-cache@mock", created_at=this_month_day(3),
    )
    second = client.get(f"{BASE}summary/?period=this_month")
    assert second.data["total_spending_minor"] == 15_000

    month = timezone.localdate().strftime("%Y-%m")
    client.post(f"{BASE}budgets/", {"month": month, "category": "", "limit_minor": 20_000}, format="json")
    third = client.get(f"{BASE}summary/?period=this_month")
    assert third.data["budget_overview"]["overall"]["limit_minor"] == 20_000
    assert third.data["budget_overview"]["overall"]["utilization_percent"] == 75.0

@pytest.mark.django_db
def test_custom_range_csv_export_includes_only_transactions_within_selected_dates():
    user = make_user()
    today = timezone.localdate()
    start = today - timedelta(days=9)
    end = today - timedelta(days=3)
    make_transaction(
        user, amount=12_500, note="Range start purchase", recipient_name="Range Start Merchant",
        recipient_identifier="range-start@mock", created_at=_date_at(start),
    )
    make_transaction(
        user, amount=23_500, note="Range end purchase", recipient_name="Range End Merchant",
        recipient_identifier="range-end@mock", created_at=_date_at(end),
    )
    make_transaction(
        user, amount=99_900, note="Before range", recipient_name="Outside Before Merchant",
        recipient_identifier="outside-before@mock", created_at=_date_at(start - timedelta(days=1)),
    )
    make_transaction(
        user, amount=88_800, note="After range", recipient_name="Outside After Merchant",
        recipient_identifier="outside-after@mock", created_at=_date_at(end + timedelta(days=1)),
    )

    response = client_for(user).get(
        f"{BASE}reports/export.csv",
        {"period": "custom", "date_from": start.isoformat(), "date_to": end.isoformat()},
    )

    assert response.status_code == 200
    assert response["Content-Type"].startswith("text/csv")
    assert f"onepay-spending-report-{start.isoformat()}-to-{end.isoformat()}.csv" in response["Content-Disposition"]
    body = response.content.decode("utf-8")
    assert "Range Start Merchant" in body
    assert "Range End Merchant" in body
    assert "Outside Before Merchant" not in body
    assert "Outside After Merchant" not in body
    assert "Custom date range" in body
    assert "Demo wallet top-ups (not income)" in body


@pytest.mark.django_db
def test_custom_range_csv_export_rejects_invalid_date_ranges():
    user = make_user()
    today = timezone.localdate()
    client = client_for(user)
    reversed_range = client.get(
        f"{BASE}reports/export.csv",
        {"period": "custom", "date_from": today.isoformat(), "date_to": (today - timedelta(days=1)).isoformat()},
    )
    assert reversed_range.status_code == 400

    future_end = client.get(
        f"{BASE}reports/export.csv",
        {"period": "custom", "date_from": today.isoformat(), "date_to": (today + timedelta(days=1)).isoformat()},
    )
    assert future_end.status_code == 400

