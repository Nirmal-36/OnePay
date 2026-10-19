from datetime import datetime, time, timedelta

import pytest
from django.utils import timezone

from apps.analytics.periods import shift_month

from .helpers import client_for, make_transaction, make_user, this_month_day

BASE = "/api/v1/analytics/"


def _at(day, hour=12):
    return timezone.make_aware(
        datetime.combine(day, time(hour=hour)), timezone.get_current_timezone()
    )


def _kinds(payload):
    return {insight["kind"] for insight in payload["insights"]}


@pytest.mark.django_db
def test_insight_cards_include_evidence_baseline_calculation_and_confidence():
    user = make_user()
    for index in range(5):
        make_transaction(
            user, amount=20_000, note="Swiggy", recipient_name="Swiggy",
            recipient_identifier="swiggy-insight@mock", created_at=this_month_day(index + 2),
        )
    make_transaction(
        user, amount=10_000, note="BigBasket", recipient_name="BigBasket",
        recipient_identifier="bigbasket-insight@mock", created_at=this_month_day(8),
    )

    response = client_for(user).get(f"{BASE}insights/?period=this_month")

    assert response.status_code == 200
    assert response.data["method"] == "deterministic_rules_over_recorded_transactions"
    assert response.data["insights"]
    category_share = next(item for item in response.data["insights"] if item["kind"] == "category_share")
    assert category_share["title"] == "Food and Dining accounts for 91% of spending"
    assert category_share["evidence"]["amount_minor"] == 100_000
    assert category_share["evidence"]["share_percent"] == 90.9
    assert category_share["baseline"]["amount_minor"] == 10_000
    assert "90.9%" in category_share["calculation"]
    assert category_share["confidence"]["level"] in {"medium", "high"}
    assert category_share["data_type"] == "actual"
    assert "priority" not in category_share

    for insight in response.data["insights"]:
        for key in (
            "kind", "title", "explanation", "evidence", "baseline", "calculation",
            "action", "confidence", "severity", "caveat", "data_type",
        ):
            assert key in insight
        assert insight["title"]
        assert insight["explanation"]
        assert insight["action"]
        assert insight["calculation"]
        assert insight["confidence"]["level"] in {"low", "medium", "high"}
        assert 0 <= insight["confidence"]["score"] <= 1
        assert insight["evidence"]


@pytest.mark.django_db
def test_weekday_weekend_comparison_uses_calendar_days_and_own_history():
    user = make_user()
    today = timezone.localdate()
    start = today - timedelta(days=55)
    cursor = start
    weekdays = []
    weekends = []
    while cursor <= today:
        if cursor.weekday() < 5:
            weekdays.append(cursor)
        else:
            weekends.append(cursor)
        cursor += timedelta(days=1)
    for day in weekdays[:4]:
        make_transaction(
            user, amount=10_000, note="Cafe", recipient_name="Local Cafe",
            recipient_identifier="cafe-weekday@mock", created_at=_at(day),
        )
    for day in weekends[:4]:
        make_transaction(
            user, amount=40_000, note="Cafe", recipient_name="Local Cafe",
            recipient_identifier="cafe-weekend@mock", created_at=_at(day),
        )
    client = client_for(user)
    response = client.get(
        f"{BASE}insights/?period=custom&date_from={start.isoformat()}&date_to={today.isoformat()}"
    )
    weekend = next(item for item in response.data["insights"] if item["kind"] == "weekday_weekend")
    assert weekend["evidence"]["higher_group"] == "weekend"
    assert weekend["evidence"]["difference_percent"] > 25
    assert weekend["evidence"]["weekend"]["days"] > 0
    assert weekend["evidence"]["weekday"]["days"] > 0
    assert weekend["baseline"]["amount_minor"] == weekend["evidence"]["weekday"]["amount_minor"] // weekend["evidence"]["weekday"]["days"]


@pytest.mark.django_db
def test_recurring_payment_detection_across_months():
    user = make_user()
    today = timezone.localdate()
    current = today.replace(day=1)
    for offset in (2, 1, 0):
        month = shift_month(current, -offset)
        make_transaction(
            user, amount=19_900, note="Netflix subscription", recipient_name="Netflix",
            recipient_identifier="netflix@mock", created_at=_at(month.replace(day=5)),
        )
    response = client_for(user).get(f"{BASE}insights/?period=last_3_months")
    recurring = next(item for item in response.data["insights"] if item["kind"] == "recurring_payment")
    assert recurring["evidence"]["merchant"] == "Netflix"
    assert recurring["evidence"]["median_amount_minor"] == 19_900
    assert recurring["evidence"]["transaction_count"] == 3
    assert len(recurring["evidence"]["months"]) == 3
    assert "cannot confirm" in recurring["caveat"].lower()
    assert recurring["confidence"]["level"] in {"medium", "high"}


@pytest.mark.django_db
def test_large_expense_insight_requires_prior_personal_baseline():
    user = make_user()
    today = timezone.localdate()
    for offset in range(20, 160, 10):
        make_transaction(
            user, amount=20_000, note="Cafe", recipient_name="Local Cafe",
            recipient_identifier="cafe-large@mock", created_at=_at(today - timedelta(days=offset)),
        )
    unusual = make_transaction(
        user, amount=500_000, note="Cafe", recipient_name="Local Cafe",
        recipient_identifier="cafe-large@mock", created_at=this_month_day(3),
    )
    response = client_for(user).get(f"{BASE}insights/?period=this_month")
    large = next(item for item in response.data["insights"] if item["kind"] == "large_expense")
    assert large["evidence"]["reference"] == unusual.reference
    assert large["evidence"]["amount_minor"] == 500_000
    assert large["baseline"]["amount_minor"] == 20_000
    assert "not inherently a problem" in large["caveat"].lower()
    assert large["confidence"]["sample_size"] >= 10

    sparse_user = make_user()
    make_transaction(sparse_user, amount=500_000, note="Cafe", recipient_name="Local Cafe",
                     recipient_identifier="cafe-sparse@mock", created_at=this_month_day(3))
    sparse = client_for(sparse_user).get(f"{BASE}insights/?period=this_month")
    assert "large_expense" not in _kinds(sparse.data)


@pytest.mark.django_db
def test_category_growth_and_review_opportunity_are_labelled_as_observations():
    user = make_user()
    today = timezone.localdate()
    previous = shift_month(today.replace(day=1), -1)
    for index in range(3):
        make_transaction(
            user, amount=20_000, note="Swiggy", recipient_name="Swiggy",
            recipient_identifier="swiggy-growth@mock", created_at=_at(previous.replace(day=index + 2)),
        )
    for index in range(5):
        make_transaction(
            user, amount=20_000, note="Swiggy", recipient_name="Swiggy",
            recipient_identifier="swiggy-growth@mock", created_at=this_month_day(index + 2),
        )
    for index in range(3):
        make_transaction(
            user, amount=20_000, note="Netflix subscription", recipient_name="Netflix",
            recipient_identifier="netflix-review@mock", created_at=this_month_day(index + 2),
        )
    response = client_for(user).get(f"{BASE}insights/?period=this_month")
    kinds = _kinds(response.data)
    assert "category_growth" in kinds
    assert "review_opportunity" in kinds
    growth = next(item for item in response.data["insights"] if item["kind"] == "category_growth")
    assert growth["evidence"]["change_percent"] > 25
    assert growth["baseline"]["amount_minor"] == 60_000
    review = next(item for item in response.data["insights"] if item["kind"] == "review_opportunity")
    assert review["severity"] == "opportunity"
    assert review["baseline"]["automatic_saving_assumed_minor"] == 0
    assert "suggestion" in review["caveat"].lower()
    assert "not a fact" in review["caveat"].lower()


@pytest.mark.django_db
def test_insights_are_empty_with_insufficient_history():
    user = make_user()
    make_transaction(user, amount=99_999, note="Swiggy", recipient_name="Swiggy",
                     recipient_identifier="swiggy-low@mock", created_at=this_month_day(2))
    make_transaction(user, amount=10_000, note="BigBasket", recipient_name="BigBasket",
                     recipient_identifier="bigbasket-low@mock", created_at=this_month_day(3))
    response = client_for(user).get(f"{BASE}insights/?period=this_month")
    assert response.status_code == 200
    assert response.data["insights"] == []
    assert "three completed payments" in response.data["empty_reason"]
    assert response.data["data_quality"]["sufficient_for_insights"] is False
