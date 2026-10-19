"""Pure aggregation helpers used by dashboards, reports, and insights."""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

from django.utils import timezone

from .categories import NON_CONSUMPTION_CATEGORIES
from .ledger import AnalyticsContext, LedgerRow, build_rows, monthly_buckets
from .periods import Period, month_end_exclusive, shift_month


def entry_from_row(row: LedgerRow) -> dict:
    return {
        "reference": row.reference,
        "recipient_name": row.recipient_name,
        "merchant": row.merchant_label,
        "merchant_key": row.merchant_key,
        "kind": row.kind,
        "service": row.service,
        "note": row.note,
        "amount_minor": row.amount_minor,
        "currency": "INR",
        "direction": "debit",
        "status": "successful",
        "created_at": row.created_at,
        "category": row.category,
        "subcategory": row.subcategory,
        "classification_method": row.classification_method,
        "confidence": row.confidence,
        "is_consumption": row.is_consumption,
        "source": "simulated",
    }


def category_breakdown(context: AnalyticsContext) -> list[dict]:
    total = context.total_spending_minor
    categories: dict[str, dict] = {}
    for row in context.rows:
        entry = categories.setdefault(
            row.category,
            {
                "category": row.category,
                "amount_minor": 0,
                "transaction_count": 0,
                "budgetable": row.category not in NON_CONSUMPTION_CATEGORIES,
                "subcategories": {},
            },
        )
        entry["amount_minor"] += row.amount_minor
        entry["transaction_count"] += 1
        subcategory = entry["subcategories"].setdefault(
            row.subcategory, {"subcategory": row.subcategory, "amount_minor": 0, "transaction_count": 0}
        )
        subcategory["amount_minor"] += row.amount_minor
        subcategory["transaction_count"] += 1

    result = []
    for entry in categories.values():
        subcategories = sorted(
            entry["subcategories"].values(), key=lambda item: (-item["amount_minor"], item["subcategory"])
        )
        result.append(
            {
                "category": entry["category"],
                "amount_minor": entry["amount_minor"],
                "transaction_count": entry["transaction_count"],
                "percentage": round(entry["amount_minor"] * 100 / total, 1) if total else 0.0,
                "consumption_percentage": round(
                    entry["amount_minor"] * 100 / context.consumption_spending_minor, 1
                )
                if entry["budgetable"] and context.consumption_spending_minor
                else 0.0,
                "budgetable": entry["budgetable"],
                "subcategories": subcategories,
            }
        )
    return sorted(result, key=lambda item: (-item["amount_minor"], item["category"]))


def daily_trend(context: AnalyticsContext) -> list[dict]:
    amounts: dict[str, int] = defaultdict(int)
    counts: dict[str, int] = defaultdict(int)
    for row in context.rows:
        key = row.local_date.isoformat()
        amounts[key] += row.amount_minor
        counts[key] += 1
    values = []
    cursor = context.period.start
    while cursor < context.period.end_exclusive:
        key = cursor.isoformat()
        values.append(
            {
                "date": key,
                "amount_minor": amounts.get(key, 0),
                "transaction_count": counts.get(key, 0),
            }
        )
        cursor += timedelta(days=1)
    return values


def monthly_trend(context: AnalyticsContext) -> list[dict]:
    return monthly_buckets(context.period, context.rows)


def weekday_weekend(context: AnalyticsContext) -> dict:
    buckets = {
        "weekday": {"amount_minor": 0, "transaction_count": 0, "days": 0},
        "weekend": {"amount_minor": 0, "transaction_count": 0, "days": 0},
    }
    cursor = context.period.start
    while cursor < context.period.end_exclusive:
        bucket = "weekend" if cursor.weekday() >= 5 else "weekday"
        buckets[bucket]["days"] += 1
        cursor += timedelta(days=1)
    for row in context.rows:
        bucket = "weekend" if row.local_date.weekday() >= 5 else "weekday"
        buckets[bucket]["amount_minor"] += row.amount_minor
        buckets[bucket]["transaction_count"] += 1
    for bucket in buckets.values():
        bucket["average_minor"] = round(bucket["amount_minor"] / bucket["days"]) if bucket["days"] else 0
        bucket["share_percent"] = round(
            bucket["amount_minor"] * 100 / context.total_spending_minor, 1
        ) if context.total_spending_minor else 0.0
    return {
        "weekday": buckets["weekday"],
        "weekend": buckets["weekend"],
        "difference_percent": _percent_difference(
            buckets["weekday"]["average_minor"], buckets["weekend"]["average_minor"]
        ),
        "definition": "Weekends are Saturday and Sunday in the application timezone. Averages use all calendar days in the selected period, including days without spending.",
    }


def _percent_difference(weekday_average: int, weekend_average: int) -> float | None:
    if not weekday_average:
        return None
    return round((weekend_average - weekday_average) * 100 / weekday_average, 1)


def top_merchants(context: AnalyticsContext, limit: int = 10) -> list[dict]:
    merchants: dict[str, dict] = {}
    for row in context.rows:
        entry = merchants.setdefault(
            row.merchant_key,
            {
                "merchant_key": row.merchant_key,
                "name": row.merchant_label,
                "amount_minor": 0,
                "transaction_count": 0,
                "references": [],
                "dates": [],
                "categories": defaultdict(int),
                "is_recurring": False,
            },
        )
        entry["name"] = row.merchant_label or entry["name"]
        entry["amount_minor"] += row.amount_minor
        entry["transaction_count"] += 1
        entry["references"].append(row.reference)
        entry["dates"].append(row.local_date.isoformat())
        entry["categories"][row.category] += row.amount_minor

    result = []
    for entry in merchants.values():
        category = max(entry["categories"].items(), key=lambda item: item[1])[0]
        result.append(
            {
                "merchant_key": entry["merchant_key"],
                "name": entry["name"],
                "amount_minor": entry["amount_minor"],
                "transaction_count": entry["transaction_count"],
                "percentage": round(entry["amount_minor"] * 100 / context.total_spending_minor, 1)
                if context.total_spending_minor
                else 0.0,
                "category": category,
                "last_date": max(entry["dates"]),
                "references": entry["references"][:12],
                "is_recurring": entry["transaction_count"] >= 3,
            }
        )
    return sorted(result, key=lambda item: (-item["amount_minor"], item["name"]))[:limit]


def largest_expense(context: AnalyticsContext) -> dict | None:
    if not context.rows:
        return None
    row = max(context.rows, key=lambda item: (item.amount_minor, item.created_at))
    return {
        "reference": row.reference,
        "recipient_name": row.recipient_name,
        "merchant": row.merchant_label,
        "amount_minor": row.amount_minor,
        "created_at": row.created_at,
        "category": row.category,
        "subcategory": row.subcategory,
        "percentage_of_period": round(row.amount_minor * 100 / context.total_spending_minor, 1)
        if context.total_spending_minor
        else 0.0,
    }


def month_comparison(user, period: Period, rows: list[LedgerRow]) -> dict:
    """Compare the latest relevant month with the preceding month."""
    current_total = sum(row.amount_minor for row in rows)

    if period.key == "this_month":
        current_start = period.start
        current_end = period.end_exclusive
        previous_start = shift_month(period.start, -1)
        elapsed_days = (current_end - current_start).days
        previous_end = min(month_end_exclusive(previous_start), previous_start + timedelta(days=elapsed_days))
        basis = "Same number of elapsed days in the previous month."
    elif period.key == "last_month":
        current_start = period.start
        current_end = period.end_exclusive
        previous_start = shift_month(period.start, -1)
        previous_end = period.start
        basis = "Full previous month versus the full month before it."
    else:
        latest_start = period.end_inclusive.replace(day=1)
        current_start = latest_start
        current_end = period.end_exclusive
        previous_start = shift_month(latest_start, -1)
        elapsed_days = (current_end - current_start).days
        previous_end = min(month_end_exclusive(previous_start), previous_start + timedelta(days=elapsed_days))
        current_total = sum(
            row.amount_minor for row in rows if current_start <= row.local_date < current_end
        )
        basis = "Latest month in the selected period versus the same elapsed days one month earlier."

    previous_rows, _ = build_rows(user, Period("comparison", previous_start, previous_end, "Comparison month"))
    previous_total = sum(row.amount_minor for row in previous_rows)
    delta = current_total - previous_total
    return {
        "current_period_start": current_start.isoformat(),
        "current_period_end": (current_end - timedelta(days=1)).isoformat(),
        "comparison_start": previous_start.isoformat(),
        "comparison_end": (previous_end - timedelta(days=1)).isoformat(),
        "current_total_minor": current_total,
        "previous_total_minor": previous_total,
        "change_minor": delta,
        "change_percent": round(delta * 100 / previous_total, 1) if previous_total else None,
        "basis": basis,
    }


def preceding_period_comparison(user, period: Period, current_total: int) -> dict:
    previous = Period(
        "preceding",
        period.start - timedelta(days=period.days),
        period.start,
        "Preceding equal-length period",
    )
    previous_rows, _ = build_rows(user, previous)
    previous_total = sum(row.amount_minor for row in previous_rows)
    delta = current_total - previous_total
    return {
        "start_date": previous.start.isoformat(),
        "end_date": previous.end_inclusive.isoformat(),
        "current_total_minor": current_total,
        "previous_total_minor": previous_total,
        "change_minor": delta,
        "change_percent": round(delta * 100 / previous_total, 1) if previous_total else None,
        "note": "Compares the selected window with an equal-length window immediately before it.",
    }


def average_daily(context: AnalyticsContext) -> int:
    return round(context.total_spending_minor / context.period.days) if context.period.days else 0


def average_active_day(context: AnalyticsContext) -> int:
    active_days = len({row.local_date for row in context.rows})
    return round(context.total_spending_minor / active_days) if active_days else 0


def forecast_category_averages(user, *, today=None) -> list[dict]:
    """Average complete-month category totals for the previous three months."""
    today = today or timezone.localdate()
    current_month = today.replace(day=1)
    months = [shift_month(current_month, -offset) for offset in (1, 2, 3)]
    totals: dict[str, int] = defaultdict(int)
    for month in months:
        period = Period("month", month, shift_month(month, 1), "Month")
        rows, _ = build_rows(user, period)
        for row in rows:
            if not row.is_consumption:
                continue
            totals[row.category] += row.amount_minor
    return [
        {
            "category": category,
            "average_monthly_minor": round(amount / len(months)),
            "months_used": [f"{month.year:04d}-{month.month:02d}" for month in months],
        }
        for category, amount in sorted(totals.items(), key=lambda item: (-item[1], item[0]))
    ]
