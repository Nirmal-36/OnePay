"""Deterministic spending-behaviour intelligence.

Every observation is derived from recorded, completed transactions. Thresholds
are used only to decide when a pattern is worth surfacing; they never declare
spending abnormal against a universal rupee limit. Comparisons use the user's
own history, and every card carries its evidence, baseline, calculation,
data-sufficiency indicator, and a practical next step.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import date, timedelta

from django.utils import timezone

from .categories import NON_CONSUMPTION_CATEGORIES
from .ledger import AnalyticsContext, LedgerRow, build_context, build_rows
from .periods import Period, month_key, month_label, shift_month

MAX_INSIGHTS = 12
REVIEWABLE_CATEGORIES = ("Subscriptions", "Entertainment", "Personal Care", "Shopping")


def _confidence(level: str, score: float, sample: int, note: str) -> dict:
    return {
        "level": level,
        "score": round(max(0.0, min(1.0, score)), 2),
        "sample_size": sample,
        "data_sufficiency": note,
    }


def _insight(
    *,
    kind: str,
    title: str,
    explanation: str,
    evidence: dict,
    baseline: dict,
    calculation: str,
    action: str,
    confidence: dict,
    severity: str = "info",
    caveat: str = "",
    priority: int = 50,
) -> dict:
    return {
        "kind": kind,
        "title": title,
        "explanation": explanation,
        "evidence": evidence,
        "baseline": baseline,
        "calculation": calculation,
        "action": action,
        "confidence": confidence,
        "severity": severity,
        "caveat": caveat,
        "data_type": "actual",
        "priority": priority,
    }


def _money(minor: int) -> str:
    return f"₹{minor / 100:,.2f}"


def _month_totals(rows: list[LedgerRow]) -> dict[str, dict]:
    buckets: dict[str, dict] = {}
    for row in rows:
        key = row.local_date.strftime("%Y-%m")
        bucket = buckets.setdefault(key, {"amount_minor": 0, "count": 0})
        bucket["amount_minor"] += row.amount_minor
        bucket["count"] += 1
    return buckets


def _category_totals(rows: list[LedgerRow]) -> dict[str, dict]:
    totals: dict[str, dict] = {}
    for row in rows:
        entry = totals.setdefault(row.category, {"amount_minor": 0, "count": 0})
        entry["amount_minor"] += row.amount_minor
        entry["count"] += 1
    return totals


def _history_period(period: Period) -> Period:
    return Period(
        "insight_history",
        shift_month(period.start.replace(day=1), -5),
        period.end_exclusive,
        "Six-month insight history",
    )


def _linear_slope(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    n = len(values)
    x_mean = (n - 1) / 2
    y_mean = sum(values) / n
    numerator = sum((index - x_mean) * (value - y_mean) for index, value in enumerate(values))
    denominator = sum((index - x_mean) ** 2 for index in range(n))
    return numerator / denominator if denominator else 0.0


def _category_share(context: AnalyticsContext, category_totals: dict[str, dict]) -> list[dict]:
    if not context.rows or not context.total_spending_minor or len(context.rows) < 3:
        return []
    category, totals = max(category_totals.items(), key=lambda item: item[1]["amount_minor"])
    share = totals["amount_minor"] * 100 / context.total_spending_minor
    if share < 30:
        return []
    others = context.total_spending_minor - totals["amount_minor"]
    confidence = _confidence(
        "high" if totals["count"] >= 5 else "medium",
        0.82 if totals["count"] >= 5 else 0.64,
        totals["count"],
        f"Based on {totals['count']} completed transactions in this category.",
    )
    return [
        _insight(
            kind="category_share",
            title=f"{category} accounts for {share:.0f}% of spending",
            explanation=(
                f"{_money(totals['amount_minor'])} of your {_money(context.total_spending_minor)} "
                f"completed outflow in this period went to {category}."
            ),
            evidence={
                "category": category,
                "amount_minor": totals["amount_minor"],
                "transaction_count": totals["count"],
                "share_percent": round(share, 1),
                "total_spending_minor": context.total_spending_minor,
                "categories": [category],
                "dates": [row.local_date.isoformat() for row in context.rows if row.category == category][:10],
                "references": [row.reference for row in context.rows if row.category == category][:10],
            },
            baseline={
                "label": "All other categories combined",
                "amount_minor": others,
                "share_percent": round(100 - share, 1),
            },
            calculation=(
                f"Category total {_money(totals['amount_minor'])} ÷ total completed outflow "
                f"{_money(context.total_spending_minor)} = {share:.1f}%. Only successful, non-internal outgoing "
                "payments in the selected period are included."
            ),
            action=f"Open {category} to review the individual payments, then set a category budget if useful.",
            confidence=confidence,
            severity="watch" if share >= 45 else "info",
            priority=20,
        )
    ]


def _frequent_small(context: AnalyticsContext) -> list[dict]:
    if len(context.rows) < 6 or not context.total_spending_minor:
        return []
    amounts = sorted(row.amount_minor for row in context.rows)
    median = statistics.median(amounts)
    small_rows = [row for row in context.rows if row.amount_minor <= median]
    small_total = sum(row.amount_minor for row in small_rows)
    share = small_total * 100 / context.total_spending_minor
    if len(small_rows) < 5 or small_total < 50_000 or share < 10:
        return []
    top = sorted(small_rows, key=lambda row: row.amount_minor, reverse=True)[:8]
    labels = ", ".join(f"{row.merchant_label} ({_money(row.amount_minor)})" for row in top[:3])
    return [
        _insight(
            kind="frequent_small",
            title=f"{len(small_rows)} smaller payments add up to {_money(small_total)}",
            explanation=(
                f"Payments at or below your median payment of {_money(int(median))} total "
                f"{_money(small_total)} — {share:.0f}% of this period's spending. Examples: {labels}."
            ),
            evidence={
                "amount_minor": small_total,
                "transaction_count": len(small_rows),
                "median_transaction_minor": int(median),
                "share_percent": round(share, 1),
                "categories": sorted({row.category for row in small_rows}),
                "amounts_minor": [row.amount_minor for row in top],
                "dates": [row.local_date.isoformat() for row in top],
                "references": [row.reference for row in top],
                "merchants": [row.merchant_label for row in top],
            },
            baseline={
                "label": "Your median completed payment this period",
                "amount_minor": int(median),
            },
            calculation=(
                f"Transactions at or below the period median ({_money(int(median))}) were summed. "
                f"{len(small_rows)} payments total {_money(small_total)} ({share:.1f}% of period outflow)."
            ),
            action="Review these payments; if some are optional, a small cap can keep them from accumulating.",
            confidence=_confidence(
                "medium" if len(small_rows) >= 8 else "low",
                0.68 if len(small_rows) >= 8 else 0.52,
                len(small_rows),
                "Small-payment detection uses your own median payment, not a fixed amount.",
            ),
            priority=35,
        )
    ]


def _weekday_weekend(context: AnalyticsContext) -> list[dict]:
    if len(context.rows) < 8 or not context.total_spending_minor:
        return []
    weekday = [row for row in context.rows if row.local_date.weekday() < 5]
    weekend = [row for row in context.rows if row.local_date.weekday() >= 5]
    if len(weekday) < 3 or len(weekend) < 3:
        return []
    weekday_days = sum(1 for offset in range(context.period.days) if (context.period.start + timedelta(days=offset)).weekday() < 5)
    weekend_days = sum(1 for offset in range(context.period.days) if (context.period.start + timedelta(days=offset)).weekday() >= 5)
    if not weekday_days or not weekend_days:
        return []
    weekday_avg = sum(row.amount_minor for row in weekday) / weekday_days
    weekend_avg = sum(row.amount_minor for row in weekend) / weekend_days
    if not weekday_avg:
        return []
    difference = (weekend_avg - weekday_avg) * 100 / weekday_avg
    if abs(difference) < 25:
        return []
    higher = "Weekend" if difference > 0 else "Weekday"
    higher_avg = weekend_avg if difference > 0 else weekday_avg
    top = sorted(weekend if difference > 0 else weekday, key=lambda row: row.amount_minor, reverse=True)[:3]
    return [
        _insight(
            kind="weekday_weekend",
            title=f"{higher} spending averages {abs(difference):.0f}% more per day",
            explanation=(
                f"Average {higher.lower()} spending is {_money(round(higher_avg))} per calendar day versus "
                f"{_money(round(weekday_avg if difference > 0 else weekend_avg))} on "
                f"{'weekdays' if difference > 0 else 'weekends'} in this period."
            ),
            evidence={
                "higher_group": higher.lower(),
                "difference_percent": round(difference, 1),
                "weekday": {"amount_minor": sum(row.amount_minor for row in weekday), "days": weekday_days, "count": len(weekday)},
                "weekend": {"amount_minor": sum(row.amount_minor for row in weekend), "days": weekend_days, "count": len(weekend)},
                "amount_minor": sum(row.amount_minor for row in top),
                "dates": [row.local_date.isoformat() for row in top],
                "references": [row.reference for row in top],
                "categories": sorted({row.category for row in top}),
            },
            baseline={
                "label": f"Average {'weekday' if difference > 0 else 'weekend'} day",
                "amount_minor": round(weekday_avg if difference > 0 else weekend_avg),
            },
            calculation=(
                f"Group totals divided by calendar days in each group: weekend {_money(round(weekend_avg))}/day, "
                f"weekday {_money(round(weekday_avg))}/day. Difference = {difference:+.1f}%."
            ),
            action="If this pattern is expected, budget for it; otherwise review the largest payments in the higher group.",
            confidence=_confidence(
                "medium",
                0.66,
                len(context.rows),
                "Each group needs at least three completed transactions for this observation.",
            ),
            priority=40,
        )
    ]


def _baseline_rows(user, period: Period) -> list[LedgerRow]:
    preceding = Period(
        "preceding",
        period.start - timedelta(days=period.days),
        period.start,
        "Preceding equal-length period",
    )
    return build_rows(user, preceding)[0]


def _daily_change(context: AnalyticsContext, previous_rows: list[LedgerRow]) -> list[dict]:
    if len(context.rows) < 5 or len(previous_rows) < 5:
        return []
    current_avg = context.total_spending_minor / context.period.days
    previous_avg = sum(row.amount_minor for row in previous_rows) / max(1, context.period.days)
    if not previous_avg:
        return []
    change = (current_avg - previous_avg) * 100 / previous_avg
    if abs(change) < 20:
        return []
    direction = "up" if change > 0 else "down"
    return [
        _insight(
            kind="daily_change",
            title=f"Average daily spending is {direction} {abs(change):.0f}%",
            explanation=(
                f"You are averaging {_money(round(current_avg))} per calendar day in this period, compared with "
                f"{_money(round(previous_avg))} in the equal-length period immediately before it."
            ),
            evidence={
                "current_average_minor": round(current_avg),
                "previous_average_minor": round(previous_avg),
                "current_total_minor": context.total_spending_minor,
                "previous_total_minor": sum(row.amount_minor for row in previous_rows),
                "current_period": [context.period.start.isoformat(), context.period.end_inclusive.isoformat()],
                "comparison_period": [
                    (context.period.start - timedelta(days=context.period.days)).isoformat(),
                    (context.period.start - timedelta(days=1)).isoformat(),
                ],
                "transaction_count": len(context.rows),
                "baseline_transaction_count": len(previous_rows),
            },
            baseline={
                "label": "Equal-length preceding period",
                "amount_minor": round(previous_avg),
                "calculation": "total outflow ÷ calendar days",
            },
            calculation=(
                f"Current average {_money(round(current_avg))}/day vs previous {_money(round(previous_avg))}/day; "
                f"change {change:+.1f}%. Calendar days, including days without spending, are used."
            ),
            action="If the increase is intentional, update the monthly budget; if not, inspect the newest large payments.",
            confidence=_confidence("medium", 0.7, len(context.rows), "Requires at least five completed payments in each window."),
            severity="watch" if change > 0 else "info",
            priority=25,
        )
    ]


def _recurring(user, history_rows: list[LedgerRow], context: AnalyticsContext) -> list[dict]:
    groups: dict[str, list[LedgerRow]] = defaultdict(list)
    for row in history_rows:
        groups[row.merchant_key].append(row)
    observations = []
    current_keys = {row.merchant_key for row in context.rows}
    for key, rows in groups.items():
        if key not in current_keys or len(rows) < 3:
            continue
        months = sorted({row.local_date.strftime("%Y-%m") for row in rows})
        amounts = sorted(row.amount_minor for row in rows)
        median_amount = statistics.median(amounts)
        close_amounts = all(abs(amount - median_amount) <= max(1, median_amount * 0.25) for amount in amounts)
        if len(months) < 2 and not close_amounts:
            continue
        if len(months) < 2 or len(rows) < 3:
            continue
        current_rows = [row for row in context.rows if row.merchant_key == key]
        if not current_rows:
            continue
        total_current = sum(row.amount_minor for row in current_rows)
        label = current_rows[0].merchant_label
        category = current_rows[0].category
        observations.append(
            _insight(
                kind="recurring_payment",
                title=f"Repeated payment to {label}",
                explanation=(
                    f"{label} appears in {len(months)} months with {len(rows)} completed payments. "
                    f"The typical amount is {_money(int(median_amount))}; {_money(total_current)} falls in this period."
                ),
                evidence={
                    "merchant": label,
                    "merchant_key": key,
                    "category": category,
                    "amount_minor": total_current,
                    "median_amount_minor": int(median_amount),
                    "transaction_count": len(rows),
                    "months": months,
                    "dates": [row.local_date.isoformat() for row in rows[-8:]],
                    "references": [row.reference for row in rows[-8:]],
                },
                baseline={
                    "label": "Typical amount across observed payments",
                    "amount_minor": int(median_amount),
                    "months_observed": len(months),
                },
                calculation=(
                    f"Detected when a merchant has at least three completed payments across two or more months. "
                    f"Median amount {_money(int(median_amount))}; months observed: {', '.join(months[-6:])}."
                ),
                action="Keep this if it is valuable; otherwise review or cancel it with the merchant.",
                confidence=_confidence(
                    "high" if len(months) >= 3 else "medium",
                    0.85 if len(months) >= 3 else 0.68,
                    len(rows),
                    "Repeated-payment detection looks at up to six months of recorded history.",
                ),
                caveat="A repeated payment may be a subscription, a bill, or an intentional regular transfer. OnePay cannot confirm which.",
                priority=30,
            )
        )
    return sorted(observations, key=lambda item: -item["baseline"]["months_observed"])[:2]


def _trend(history_rows: list[LedgerRow], context: AnalyticsContext) -> list[dict]:
    totals = _month_totals(history_rows)
    ordered = sorted(totals.items())[-4:]
    if len(ordered) < 3:
        return []
    values = [value["amount_minor"] for _, value in ordered]
    if min(values) <= 0:
        return []
    slope = _linear_slope([float(value) for value in values])
    first, last = values[0], values[-1]
    change = (last - first) * 100 / first
    if abs(change) < 15:
        return []
    direction = "increasing" if slope > 0 else "decreasing"
    return [
        _insight(
            kind="spending_trend",
            title=f"Monthly spending trend is {direction}",
            explanation=(
                f"Monthly completed spending moved from {_money(first)} in {month_label(date.fromisoformat(ordered[0][0] + '-01'))} "
                f"to {_money(last)} in {month_label(date.fromisoformat(ordered[-1][0] + '-01'))} ({change:+.0f}%)."
            ),
            evidence={
                "months": [
                    {
                        "month": key,
                        "label": month_label(date.fromisoformat(key + "-01")),
                        "amount_minor": value["amount_minor"],
                        "transaction_count": value["count"],
                    }
                    for key, value in ordered
                ],
                "slope_minor_per_month": round(slope),
                "change_percent": round(change, 1),
                "amount_minor": last,
                "transaction_count": sum(value["count"] for _, value in ordered),
                "categories": sorted({row.category for row in history_rows}),
            },
            baseline={
                "label": "First month in the observed window",
                "amount_minor": first,
                "month": ordered[0][0],
            },
            calculation=(
                "A least-squares slope is fitted to up to four monthly totals. The percentage uses the first and "
                "last observed months. Partial current-month data is included only if it exists."
            ),
            action="Use this as context for next month's budget; it is a trend, not a prediction.",
            confidence=_confidence("medium", 0.68, sum(value["count"] for _, value in ordered), "Requires at least three months with completed spending."),
            priority=45,
        )
    ]


def _large_expenses(prior_rows: list[LedgerRow], context: AnalyticsContext) -> list[dict]:
    amounts = sorted(row.amount_minor for row in prior_rows)
    if len(amounts) < 10:
        return []
    median = statistics.median(amounts)
    deviations = sorted(abs(value - median) for value in amounts)
    mad = statistics.median(deviations)
    if median <= 0:
        return []
    observations = []
    for row in sorted(context.rows, key=lambda item: item.amount_minor, reverse=True):
        if row.amount_minor <= median * 2:
            continue
        if mad > 0:
            robust_z = 0.6745 * (row.amount_minor - median) / mad
            qualifies = robust_z >= 3.5
        else:
            qualifies = row.amount_minor >= median * 3
        if not qualifies:
            continue
        observations.append(
            _insight(
                kind="large_expense",
                title=f"Unusually large payment: {_money(row.amount_minor)} to {row.merchant_label}",
                explanation=(
                    f"This payment is {row.amount_minor / median:.1f}× your recent median completed payment "
                    f"({_money(int(median))}) and sits above your own recent range."
                ),
                evidence={
                    "reference": row.reference,
                    "merchant": row.merchant_label,
                    "merchant_key": row.merchant_key,
                    "amount_minor": row.amount_minor,
                    "date": row.local_date.isoformat(),
                    "category": row.category,
                    "dates": [row.local_date.isoformat()],
                    "categories": [row.category],
                    "references": [row.reference],
                },
                baseline={
                    "label": "Your prior 180-day completed payments",
                    "amount_minor": int(median),
                    "median_absolute_deviation_minor": int(mad),
                    "sample_size": len(prior_rows),
                },
                calculation=(
                    f"Robust z-score = 0.6745 × (payment − median) ÷ MAD. Median {_money(int(median))}, "
                    f"MAD {_money(int(mad))}, payment {_money(row.amount_minor)}. "
                    "Requires at least 10 prior completed payments." if mad else
                    f"Median {_money(int(median))}; payment exceeds 3× median. Requires at least 10 prior completed payments."
                ),
                action="Confirm this payment was expected. If not, review it with the recipient; OnePay cannot reverse customer payments.",
                confidence=_confidence(
                    "high" if len(prior_rows) >= 20 else "medium",
                    0.86 if len(prior_rows) >= 20 else 0.66,
                    len(prior_rows),
                    "Compares only with your own prior completed payments.",
                ),
                severity="watch",
                caveat="A large payment is not inherently a problem; it is only unusual relative to your own history.",
                priority=10,
            )
        )
        if len(observations) >= 3:
            break
    return observations


def _category_growth(user, context: AnalyticsContext) -> list[dict]:
    latest_start = context.period.end_inclusive.replace(day=1)
    elapsed_days = (context.period.end_inclusive - latest_start).days + 1
    previous_start = shift_month(latest_start, -1)
    previous_end = previous_start + timedelta(days=elapsed_days)
    previous_end = min(previous_end, shift_month(previous_start, 1))
    previous_rows, _ = build_rows(
        user, Period("comparison", previous_start, previous_end, "Same days previous month")
    )
    current_rows = [row for row in context.rows if latest_start <= row.local_date <= context.period.end_inclusive]
    current = _category_totals(current_rows)
    previous = _category_totals(previous_rows)
    candidates = []
    for category, current_entry in current.items():
        if category in NON_CONSUMPTION_CATEGORIES:
            continue
        previous_amount = previous.get(category, {}).get("amount_minor", 0)
        current_amount = current_entry["amount_minor"]
        if current_amount < 50_000 or previous_amount < 50_000:
            continue
        change = (current_amount - previous_amount) * 100 / previous_amount
        if change < 25:
            continue
        candidates.append((change, category, current_amount, previous_amount, current_entry["count"]))
    if not candidates:
        return []
    change, category, current_amount, previous_amount, count = max(candidates)
    return [
        _insight(
            kind="category_growth",
            title=f"{category} spending grew {change:.0f}% month over month",
            explanation=(
                f"{category} increased from {_money(previous_amount)} to {_money(current_amount)} between the same "
                f"elapsed days of the previous month and this month."
            ),
            evidence={
                "category": category,
                "amount_minor": current_amount,
                "previous_amount_minor": previous_amount,
                "transaction_count": count,
                "change_percent": round(change, 1),
                "dates": [row.local_date.isoformat() for row in current_rows if row.category == category][:10],
                "categories": [category],
                "references": [row.reference for row in current_rows if row.category == category][:10],
            },
            baseline={
                "label": "Same elapsed days in the previous month",
                "amount_minor": previous_amount,
                "start_date": previous_start.isoformat(),
                "end_date": (previous_end - timedelta(days=1)).isoformat(),
            },
            calculation=(
                f"({_money(current_amount)} − {_money(previous_amount)}) ÷ {_money(previous_amount)} = {change:+.1f}%. "
                "Both months use the same number of elapsed days to avoid partial-month bias."
            ),
            action=f"Open {category} to see which payments increased, then adjust that category budget if needed.",
            confidence=_confidence("medium", 0.7, count, "Requires at least ₹500 in both comparison windows."),
            severity="watch",
            priority=15,
        )
    ]


def _merchant_repeat(context: AnalyticsContext, recurring_keys: set[str]) -> list[dict]:
    groups: dict[str, list[LedgerRow]] = defaultdict(list)
    for row in context.rows:
        groups[row.merchant_key].append(row)
    observations = []
    for key, rows in groups.items():
        if key in recurring_keys or len(rows) < 3:
            continue
        total = sum(row.amount_minor for row in rows)
        if total < 50_000:
            continue
        median = statistics.median(row.amount_minor for row in rows)
        observations.append(
            _insight(
                kind="merchant_repeat",
                title=f"You paid {rows[0].merchant_label} {len(rows)} times this period",
                explanation=(
                    f"{len(rows)} completed payments to {rows[0].merchant_label} total {_money(total)}, "
                    f"with a typical payment of {_money(int(median))}."
                ),
                evidence={
                    "merchant": rows[0].merchant_label,
                    "merchant_key": key,
                    "amount_minor": total,
                    "transaction_count": len(rows),
                    "median_amount_minor": int(median),
                    "dates": [row.local_date.isoformat() for row in rows],
                    "categories": sorted({row.category for row in rows}),
                    "references": [row.reference for row in rows],
                },
                baseline={
                    "label": "Typical payment to this merchant",
                    "amount_minor": int(median),
                },
                calculation=f"{len(rows)} payments summed to {_money(total)}; median payment {_money(int(median))}.",
                action="Review the payments if you did not expect this many; otherwise no action is needed.",
                confidence=_confidence("medium", 0.62, len(rows), "Requires at least three payments to the same merchant in this period."),
                priority=55,
            )
        )
    return sorted(observations, key=lambda item: -item["evidence"]["amount_minor"])[:1]


def _review_opportunity(context: AnalyticsContext) -> list[dict]:
    categories = _category_totals(context.rows)
    candidates = [
        (category, entry)
        for category, entry in categories.items()
        if category in REVIEWABLE_CATEGORIES and entry["count"] >= 3 and entry["amount_minor"] >= 50_000
    ]
    if not candidates:
        return []
    category, entry = max(candidates, key=lambda item: item[1]["amount_minor"])
    share = entry["amount_minor"] * 100 / context.total_spending_minor if context.total_spending_minor else 0
    return [
        _insight(
            kind="review_opportunity",
            title=f"Review {entry['count']} payments in {category}",
            explanation=(
                f"{category} contains {entry['count']} completed payments totalling {_money(entry['amount_minor'])} "
                f"({share:.0f}% of this period's outflow). Some of these may be optional; OnePay cannot know which."
            ),
            evidence={
                "category": category,
                "amount_minor": entry["amount_minor"],
                "transaction_count": entry["count"],
                "share_percent": round(share, 1),
                "categories": [category],
                "references": [row.reference for row in context.rows if row.category == category][:10],
                "dates": [row.local_date.isoformat() for row in context.rows if row.category == category][:10],
            },
            baseline={
                "label": "Recorded spending in this category",
                "amount_minor": entry["amount_minor"],
                "automatic_saving_assumed_minor": 0,
            },
            calculation=(
                f"{entry['count']} completed payments in {category} total {_money(entry['amount_minor'])}. "
                "No savings percentage is assumed or applied."
            ),
            action=f"Open {category} and decide which payments to keep. Only cancel what you do not need.",
            confidence=_confidence("low", 0.45, entry["count"], "This is a review prompt, not a finding that spending was wasteful."),
            severity="opportunity",
            caveat="This is a suggestion to review, not a fact about your priorities or lifestyle. Many such payments are essential.",
            priority=60,
        )
    ]


def _elevated_week(history_rows: list[LedgerRow], context: AnalyticsContext) -> list[dict]:
    weekly: dict[date, int] = defaultdict(int)
    for row in history_rows:
        week_start = row.local_date - timedelta(days=row.local_date.weekday())
        weekly[week_start] += row.amount_minor
    if len(weekly) < 4:
        return []
    values = sorted(weekly.values())
    median = statistics.median(values)
    if median <= 0:
        return []
    current_weeks = {
        week_start: amount
        for week_start, amount in weekly.items()
        if week_start >= context.period.start - timedelta(days=context.period.start.weekday())
        and week_start <= context.period.end_inclusive
    }
    if not current_weeks:
        return []
    week_start, amount = max(current_weeks.items(), key=lambda item: item[1])
    if amount < median * 1.5:
        return []
    return [
        _insight(
            kind="elevated_period",
            title=f"Week of {week_start.strftime('%d %b')} was above your usual weekly range",
            explanation=(
                f"You spent {_money(amount)} in the week starting {week_start.strftime('%d %b %Y')}, compared with a "
                f"median weekly amount of {_money(int(median))} across your recent history."
            ),
            evidence={
                "week_start": week_start.isoformat(),
                "week_end": (week_start + timedelta(days=6)).isoformat(),
                "amount_minor": amount,
                "dates": [week_start.isoformat(), (week_start + timedelta(days=6)).isoformat()],
                "categories": sorted({row.category for row in context.rows if week_start <= row.local_date <= week_start + timedelta(days=6)}),
                "references": [row.reference for row in context.rows if week_start <= row.local_date <= week_start + timedelta(days=6)][:10],
            },
            baseline={
                "label": "Median weekly spending in recent history",
                "amount_minor": int(median),
                "weeks_observed": len(weekly),
            },
            calculation=(
                f"Weeks are Monday–Sunday. This week's {_money(amount)} is {amount / median:.1f}× the median of "
                f"{len(weekly)} observed weeks ({_money(int(median))})."
            ),
            action="Check which payments drove the week, then decide whether to adjust the next weekly or monthly plan.",
            confidence=_confidence("medium", 0.64, len(history_rows), "Requires at least four observed weeks; uses your own median."),
            priority=50,
        )
    ]


def build_insights(user, period: Period, context: AnalyticsContext | None = None) -> dict:
    context = context or build_context(user, period)
    quality = context.data_quality
    if not context.rows:
        return {
            "period": period.as_dict(),
            "insights": [],
            "data_quality": quality,
            "generated_at": timezone.now(),
            "method": "deterministic_rules_over_recorded_transactions",
            "empty_reason": "No completed eligible spending was recorded in this period.",
        }
    history_rows, _ = build_rows(user, _history_period(period))
    prior_rows = [row for row in history_rows if row.local_date < period.start]
    category_totals = _category_totals(context.rows)
    previous_rows = _baseline_rows(user, period)

    observations = [
        *_category_share(context, category_totals),
        *_frequent_small(context),
        *_weekday_weekend(context),
        *_daily_change(context, previous_rows),
        *_large_expenses(prior_rows, context),
    ]
    recurring = _recurring(user, history_rows, context)
    recurring_keys = {item["evidence"]["merchant_key"] for item in recurring}
    observations.extend(recurring)
    observations.extend(_trend(history_rows, context))
    observations.extend(_category_growth(user, context))
    observations.extend(_merchant_repeat(context, recurring_keys))
    observations.extend(_review_opportunity(context))
    observations.extend(_elevated_week(history_rows, context))
    observations.sort(key=lambda item: item["priority"])
    for observation in observations:
        observation.pop("priority", None)
    return {
        "period": period.as_dict(),
        "insights": observations[:MAX_INSIGHTS],
        "total_insights": len(observations),
        "data_quality": quality,
        "generated_at": timezone.now(),
        "method": "deterministic_rules_over_recorded_transactions",
        "method_note": (
            "All observations are computed from the user's recorded completed transactions. Detection thresholds are "
            "sensitivity settings, not universal definitions of normal spending. Each card includes its evidence and baseline."
        ),
        "empty_reason": None
        if observations
        else (
            "At least three completed payments are needed for behavioural observations."
            if len(context.rows) < 3
            else "No behavioural pattern crossed its evidence threshold for this period."
        ),
    }
