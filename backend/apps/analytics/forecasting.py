"""Transparent statistical forecasts and user-relative anomaly detection.

No model is trained on a server or sent anywhere. Forecasts use simple moving
averages and observed ranges. Every projection is labelled as an estimate, carries
the period and method used, and is withheld when the history is insufficient.
"""

from __future__ import annotations

import math
import statistics
from collections import defaultdict
from datetime import date, timedelta

from django.utils import timezone

from .ledger import (
    FORECAST_MIN_COMPLETE_MONTHS,
    FORECAST_MIN_HISTORY_DAYS,
    FORECAST_MIN_TRANSACTIONS,
    LedgerRow,
    build_rows,
    user_history_bounds,
)
from .periods import Period, month_end_exclusive, month_key, month_label, shift_month

METHOD_KEY = "moving_average_with_observed_range"
LIMITATIONS = (
    "This is a statistical estimate from recorded OnePay activity, not a guarantee or financial advice.",
    "It assumes recent spending patterns continue; irregular or seasonal expenses can change the outcome.",
    "Only completed consumption payments are used. Transfers, income, refunds, pending, failed, and reversed payments are excluded.",
    "Projections are not filled with invented data when history is missing.",
)


def _consumption(rows: list[LedgerRow]) -> list[LedgerRow]:
    return [row for row in rows if row.is_consumption]


def _complete_months(today: date, count: int = 3) -> list[date]:
    current = today.replace(day=1)
    return [shift_month(current, -offset) for offset in range(count, 0, -1)]


def _month_totals(user, months: list[date]) -> list[dict]:
    if not months:
        return []
    period = Period("history", months[0], month_end_exclusive(months[-1]), "Complete months")
    rows, _ = build_rows(user, period)
    values = []
    for month in months:
        month_rows = [
            row for row in _consumption(rows) if month <= row.local_date < month_end_exclusive(month)
        ]
        values.append(
            {
                "month": month_key(month),
                "label": month_label(month),
                "amount_minor": sum(row.amount_minor for row in month_rows),
                "transaction_count": len(month_rows),
            }
        )
    return values


def _weighted_average(values: list[int]) -> int:
    weights = list(range(1, len(values) + 1))
    denominator = sum(weights)
    return round(sum(value * weight for value, weight in zip(values, weights)) / denominator) if denominator else 0


def build_forecast(user, *, today: date | None = None) -> dict:
    today = today or timezone.localdate()
    first_date, _ = user_history_bounds(user)
    history_days = (today - first_date).days + 1 if first_date else 0
    months = _complete_months(today, 3)
    month_history = _month_totals(user, months)
    months_with_spending = [entry for entry in month_history if entry["amount_minor"] > 0]
    prior_period = Period("forecast_history", today - timedelta(days=180), today + timedelta(days=1), "Last 180 days")
    prior_rows, _ = build_rows(user, prior_period)
    prior_consumption = _consumption(prior_rows)
    recent_rows = [row for row in prior_consumption if row.local_date >= today - timedelta(days=90)]

    reasons = []
    if history_days < FORECAST_MIN_HISTORY_DAYS:
        reasons.append(f"At least {FORECAST_MIN_HISTORY_DAYS} days of recorded history are required; found {max(0, history_days)}.")
    if len(prior_consumption) < FORECAST_MIN_TRANSACTIONS:
        reasons.append(
            f"At least {FORECAST_MIN_TRANSACTIONS} completed consumption payments are required in the last 180 days; "
            f"found {len(prior_consumption)}."
        )
    if len(months_with_spending) < FORECAST_MIN_COMPLETE_MONTHS:
        reasons.append(
            f"At least {FORECAST_MIN_COMPLETE_MONTHS} complete months with spending are required; "
            f"found {len(months_with_spending)}."
        )
    eligible = not reasons

    current_month = today.replace(day=1)
    current_period = Period("current_month", current_month, today + timedelta(days=1), month_label(current_month))
    current_rows, _ = build_rows(user, current_period)
    current_consumption = _consumption(current_rows)
    actual_to_date = sum(row.amount_minor for row in current_consumption)
    days_elapsed = (today - current_month).days + 1
    days_remaining = max(0, (month_end_exclusive(current_month) - (today + timedelta(days=1))).days)

    daily_totals = defaultdict(int)
    for row in recent_rows:
        daily_totals[row.local_date] += row.amount_minor
    daily_values = sorted(daily_totals.values())
    calendar_daily = [
        daily_totals.get(today - timedelta(days=offset), 0) for offset in range(0, 90)
    ]
    daily_rate = round(sum(calendar_daily) / 90) if calendar_daily else 0
    daily_deviation = round(statistics.pstdev(calendar_daily)) if len(calendar_daily) >= 2 else 0
    uncertainty_margin = round(daily_deviation * math.sqrt(days_remaining))

    month_amounts = [entry["amount_minor"] for entry in month_history]
    next_month_estimate = _weighted_average(month_amounts) if eligible else 0
    next_month_range = [min(month_amounts), max(month_amounts)] if month_amounts else [0, 0]

    current_projection = None
    next_month_projection = None
    category_projections: list[dict] = []
    daily_projection: list[dict] = []

    if eligible:
        projected_total = actual_to_date + daily_rate * days_remaining
        current_projection = {
            "month": month_key(current_month),
            "label": month_label(current_month),
            "actual_to_date_minor": actual_to_date,
            "projected_remaining_minor": daily_rate * days_remaining,
            "projected_total_minor": projected_total,
            "range_minor": [
                max(0, projected_total - uncertainty_margin),
                projected_total + uncertainty_margin,
            ],
            "range_method": (
                "Projected total ± one standard deviation of the previous 90 days of daily spending, "
                "scaled by the square root of remaining days. This is an observed variability band, not a guarantee."
            ),
            "days_elapsed": days_elapsed,
            "days_remaining": days_remaining,
            "daily_rate_minor": daily_rate,
            "daily_deviation_minor": daily_deviation,
            "daily_rate_basis": "Average completed consumption per calendar day over the previous 90 days.",
            "data_type": "forecast",
            "is_estimate": True,
        }
        next_start = shift_month(current_month, 1)
        next_month_projection = {
            "month": month_key(next_start),
            "label": month_label(next_start),
            "projected_total_minor": next_month_estimate,
            "range_minor": next_month_range,
            "weighted_months": month_history,
            "method": "Weighted average of up to three complete months (most recent month weighted highest).",
            "data_type": "forecast",
            "is_estimate": True,
        }
        category_period = Period(
            "category_history",
            shift_month(current_month, -3),
            current_month,
            "Previous three complete months",
        )
        category_rows, _ = build_rows(user, category_period)
        with_totals: dict[str, list[int]] = defaultdict(list)
        for month in months:
            monthly: dict[str, int] = defaultdict(int)
            for row in _consumption(category_rows):
                if month <= row.local_date < month_end_exclusive(month):
                    monthly[row.category] += row.amount_minor
            for category, amount in monthly.items():
                with_totals[category].append(amount)
        for category, values in sorted(with_totals.items(), key=lambda item: -sum(item[1])):
            while len(values) < 3:
                values.append(0)
            category_projections.append(
                {
                    "category": category,
                    "projected_total_minor": round(sum(values) / 3),
                    "range_minor": [min(values), max(values)],
                    "monthly_values": values,
                    "data_type": "forecast",
                    "is_estimate": True,
                }
            )
        for offset in range(1, min(31, days_remaining + 31)):
            projected_date = today + timedelta(days=offset)
            daily_projection.append(
                {
                    "date": projected_date.isoformat(),
                    "projected_minor": daily_rate,
                    "data_type": "forecast",
                    "is_estimate": True,
                }
            )

    return {
        "as_of_date": today.isoformat(),
        "eligible": eligible,
        "reasons": reasons,
        "history": {
            "first_transaction_date": first_date.isoformat() if first_date else None,
            "history_days": max(0, history_days),
            "complete_months": month_history,
            "complete_months_with_spending": len(months_with_spending),
            "transactions_last_180_days": len(prior_consumption),
            "active_days_last_90_days": len(daily_values),
            "period_covered": {
                "start_date": (today - timedelta(days=180)).isoformat(),
                "end_date": today.isoformat(),
            },
        },
        "method": {
            "key": METHOD_KEY,
            "label": "Moving average with observed range",
            "description": (
                "Current-month projection = actual consumption to date + average daily consumption over the previous "
                "90 days × remaining days. The range uses one standard deviation of daily spending scaled by the "
                "square root of remaining days. Next-month projection = weighted average of up to three complete months, "
                "with the observed month range shown."
            ),
            "limitations": list(LIMITATIONS),
        },
        "current_month": current_projection,
        "next_month": next_month_projection,
        "category_projections": category_projections,
        "daily_projection": daily_projection,
        "data_type": "forecast",
        "is_estimate": True,
    }


def build_anomalies(user, period: Period, *, context=None) -> dict:
    from .ledger import build_context

    context = context or build_context(user, period)
    prior_period = Period(
        "anomaly_baseline",
        period.start - timedelta(days=180),
        period.start,
        "180-day baseline before the selected period",
    )
    prior_rows, _ = build_rows(user, prior_period)
    amounts = sorted(row.amount_minor for row in prior_rows)
    reasons = []
    anomalies: list[dict] = []
    if len(amounts) < 10:
        reasons.append("At least 10 completed payments before the selected period are needed as a personal baseline.")
        return {
            "period": period.as_dict(),
            "eligible": False,
            "reasons": reasons,
            "anomalies": [],
            "baseline": {"transaction_count": len(amounts), "median_minor": None, "mad_minor": None},
            "method": {
                "key": "robust_z_score_against_own_history",
                "description": "Compares each payment with the median of the user's own prior 180 days using median absolute deviation.",
                "limitations": [
                    "A large payment is not inherently wrong; it may be a planned expense.",
                    "The baseline requires at least 10 prior completed payments.",
                    "OnePay does not detect fraud or judge whether a merchant is trustworthy.",
                ],
            },
            "data_quality": context.data_quality,
        }

    median = statistics.median(amounts)
    mad = statistics.median(sorted(abs(value - median) for value in amounts))
    for row in sorted(context.rows, key=lambda item: item.amount_minor, reverse=True):
        if row.amount_minor <= median * 2:
            continue
        if mad > 0:
            robust_z = 0.6745 * (row.amount_minor - median) / mad
            if robust_z < 3.5:
                continue
        elif row.amount_minor < median * 3:
            continue
        anomalies.append(
            {
                "type": "transaction",
                "reference": row.reference,
                "date": row.local_date.isoformat(),
                "merchant": row.merchant_label,
                "category": row.category,
                "amount_minor": row.amount_minor,
                "baseline_median_minor": int(median),
                "baseline_mad_minor": int(mad),
                "multiple_of_median": round(row.amount_minor / median, 2) if median else None,
                "explanation": (
                    f"{row.merchant_label} was {row.amount_minor / median:.1f}× your prior median completed payment."
                    if median
                    else "This payment is above your prior completed payments."
                ),
                "confidence": "high" if len(prior_rows) >= 20 else "medium",
                "data_type": "actual",
                "is_estimate": False,
            }
        )
        if len(anomalies) >= 5:
            break

    daily: dict[date, int] = defaultdict(int)
    for row in context.rows:
        daily[row.local_date] += row.amount_minor
    prior_daily_map: dict[date, int] = defaultdict(int)
    for row in prior_rows:
        prior_daily_map[row.local_date] += row.amount_minor
    prior_daily = sorted(prior_daily_map.values())
    if len(prior_daily) >= 14:
        daily_median = statistics.median(prior_daily)
        daily_mad = statistics.median(sorted(abs(value - daily_median) for value in prior_daily))
        if daily_median > 0:
            for day, amount in sorted(daily.items(), key=lambda item: -item[1])[:2]:
                if amount <= daily_median * 2:
                    continue
                if daily_mad > 0:
                    robust_z = 0.6745 * (amount - daily_median) / daily_mad
                    if robust_z < 3.5:
                        continue
                anomalies.append(
                    {
                        "type": "day",
                        "date": day.isoformat(),
                        "amount_minor": amount,
                        "baseline_median_minor": int(daily_median),
                        "baseline_mad_minor": int(daily_mad),
                        "multiple_of_median": round(amount / daily_median, 2),
                        "explanation": (
                            f"Spending on {day.isoformat()} was {amount / daily_median:.1f}× your median active day."
                        ),
                        "confidence": "medium",
                        "data_type": "actual",
                        "is_estimate": False,
                    }
                )

    return {
        "period": period.as_dict(),
        "eligible": True,
        "reasons": [],
        "anomalies": anomalies,
        "baseline": {
            "transaction_count": len(amounts),
            "median_minor": int(median),
            "mad_minor": int(mad),
            "active_days": len(prior_daily),
        },
        "method": {
            "key": "robust_z_score_against_own_history",
            "description": "Compares payments and active days with the user's own prior 180 days using median and median absolute deviation. No universal rupee threshold is used.",
            "limitations": [
                "A large payment is not inherently wrong; it may be a planned expense.",
                "The baseline requires at least 10 prior completed payments.",
                "OnePay does not detect fraud or judge whether a merchant is trustworthy.",
            ],
        },
        "data_quality": context.data_quality,
    }
