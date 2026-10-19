"""Budget, savings-goal, and budget-warning calculations."""

from __future__ import annotations

from datetime import date
from math import ceil

from django.utils import timezone

from .categories import NON_CONSUMPTION_CATEGORIES
from .ledger import LedgerRow, build_rows, data_quality
from .models import SavingsGoal, SpendingBudget
from .periods import Period, month_end_exclusive, month_label, shift_month

APPROACHING_THRESHOLD = 80
EXCEEDED_THRESHOLD = 100


def _consumption_rows(rows: list[LedgerRow]) -> list[LedgerRow]:
    return [row for row in rows if row.is_consumption]


def _category_spending(rows: list[LedgerRow]) -> tuple[int, dict[str, int]]:
    consumption = _consumption_rows(rows)
    by_category: dict[str, int] = {}
    for row in consumption:
        by_category[row.category] = by_category.get(row.category, 0) + row.amount_minor
    return sum(row.amount_minor for row in consumption), by_category


def _status_for(spent: int, limit: int) -> tuple[str, str | None]:
    if not limit:
        return "no_limit", None
    percent = spent * 100 / limit
    if percent >= EXCEEDED_THRESHOLD:
        return "exceeded", f"Limit exceeded by ₹{(spent - limit) / 100:,.2f}."
    if percent >= APPROACHING_THRESHOLD:
        return "approaching", f"{percent:.0f}% of this limit is used."
    return "on_track", None


def _budget_entry(limit_minor: int, spent_minor: int, label: str) -> dict:
    remaining = limit_minor - spent_minor
    percent = round(spent_minor * 100 / limit_minor, 1) if limit_minor else 0.0
    status, warning = _status_for(spent_minor, limit_minor)
    return {
        "label": label,
        "limit_minor": limit_minor,
        "spent_minor": spent_minor,
        "remaining_minor": remaining,
        "utilization_percent": percent,
        "status": status,
        "warning": warning,
        "is_over": remaining < 0,
    }


def build_budget_overview(user, month: date, *, today: date | None = None) -> dict:
    today = today or timezone.localdate()
    month = month.replace(day=1)
    start = shift_month(month, -1)
    # A single three-month query provides current spending and comparison history.
    history_period = Period("budget_history", min(start, month), month_end_exclusive(month), "Budget history")
    rows, _ = build_rows(user, history_period)
    current_rows = [row for row in rows if month <= row.local_date < month_end_exclusive(month)]
    consumption_total, by_category = _category_spending(current_rows)
    budgets = list(SpendingBudget.objects.filter(user=user, month=month))

    overall_budget = next((budget for budget in budgets if not budget.category), None)
    overall = None
    if overall_budget:
        overall = {
            "id": overall_budget.pk,
            "category": "",
            **{
                key: value
                for key, value in _budget_entry(overall_budget.limit_minor, consumption_total, "Overall").items()
                if key != "label"
            },
        }

    category_budgets = []
    warnings: list[dict] = []
    for budget in sorted(budgets, key=lambda item: item.category):
        if not budget.category:
            continue
        spent = by_category.get(budget.category, 0)
        entry = {
            "id": budget.pk,
            "category": budget.category,
            **_budget_entry(budget.limit_minor, spent, budget.category),
        }
        category_budgets.append(entry)
        if entry["warning"]:
            warnings.append(
                {
                    "scope": "category",
                    "category": budget.category,
                    "status": entry["status"],
                    "message": f"{budget.category}: {entry['warning']}",
                    "utilization_percent": entry["utilization_percent"],
                }
            )

    if overall and overall["warning"]:
        warnings.insert(
            0,
            {
                "scope": "overall",
                "category": "",
                "status": overall["status"],
                "message": f"Overall budget: {overall['warning']}",
                "utilization_percent": overall["utilization_percent"],
            },
        )

    unbudgeted = [
        {"category": category, "spent_minor": amount}
        for category, amount in sorted(by_category.items(), key=lambda item: (-item[1], item[0]))
        if category not in {budget.category for budget in budgets if budget.category}
    ]

    previous_start = shift_month(month, -1)
    previous_rows = [row for row in rows if previous_start <= row.local_date < month]
    previous_total, _ = _category_spending(previous_rows)
    comparison = {
        "previous_month": previous_start.strftime("%Y-%m"),
        "previous_spending_minor": previous_total,
        "change_minor": consumption_total - previous_total,
        "change_percent": round((consumption_total - previous_total) * 100 / previous_total, 1)
        if previous_total
        else None,
    }

    return {
        "month": month.strftime("%Y-%m"),
        "label": month_label(month),
        "period": Period("budget", month, month_end_exclusive(month), month_label(month)).as_dict(),
        "is_current_month": month == today.replace(day=1),
        "is_future_month": month > today.replace(day=1),
        "consumption_spending_minor": consumption_total,
        "total_category_limits_minor": sum(
            budget.limit_minor for budget in budgets if budget.category
        ),
        "overall": overall,
        "categories": category_budgets,
        "unbudgeted_categories": unbudgeted,
        "warnings": warnings,
        "comparison": comparison,
        "has_any_budget": bool(budgets),
        "calculation_note": (
            "Budget progress uses completed consumption in the calendar month. Person-to-person transfers, "
            "internal transfers, income, refunds, pending, failed, and reversed payments are excluded."
        ),
    }


def _round_up_minor(value: int, step_minor: int = 10_000) -> int:
    if value <= 0:
        return 0
    return int(ceil(value / step_minor) * step_minor)


def recommended_budgets(user, *, today: date | None = None) -> dict:
    """Estimate a budget from complete months only. Never presented as a fact."""
    today = today or timezone.localdate()
    current_month = today.replace(day=1)
    period = Period("recommendation", shift_month(current_month, -3), current_month, "Previous 3 complete months")
    rows, _ = build_rows(user, period)
    consumption = _consumption_rows(rows)
    quality = data_quality(user, period, rows)
    months_with_spending = sorted({row.local_date.strftime("%Y-%m") for row in consumption})
    eligible = len(months_with_spending) >= 2 and len(consumption) >= 10
    if not eligible:
        return {
            "available": False,
            "label": "Estimate",
            "basis": "Last 3 complete calendar months",
            "months_used": months_with_spending,
            "reason": "Recommendations need at least 10 completed consumption transactions across 2 complete months.",
            "overall_estimate_minor": None,
            "categories": [],
            "limitations": [
                "This is an estimate from recorded OnePay demo activity, not a financial recommendation.",
                "Too little history exists to produce a stable estimate.",
            ],
            "data_quality": quality,
        }

    total = sum(row.amount_minor for row in consumption)
    average_total = round(total / 3)
    by_category: dict[str, int] = {}
    counts: dict[str, int] = {}
    for row in consumption:
        by_category[row.category] = by_category.get(row.category, 0) + row.amount_minor
        counts[row.category] = counts.get(row.category, 0) + 1
    categories = [
        {
            "category": category,
            "average_monthly_minor": round(amount / 3),
            "suggested_limit_minor": _round_up_minor(round(amount / 3)),
            "transaction_count": counts[category],
        }
        for category, amount in sorted(by_category.items(), key=lambda item: (-item[1], item[0]))
        if category not in NON_CONSUMPTION_CATEGORIES and amount > 0
    ]
    return {
        "available": True,
        "label": "Estimate",
        "basis": "Average of the last 3 complete calendar months",
        "months_used": months_with_spending,
        "overall_estimate_minor": _round_up_minor(average_total),
        "average_monthly_spending_minor": average_total,
        "categories": categories,
        "limitations": [
            "This is a statistical estimate from recorded OnePay demo activity, not financial advice.",
            "Three months may not represent irregular or seasonal expenses.",
            "You can override every recommendation.",
        ],
        "data_quality": quality,
    }


def goal_payload(goal: SavingsGoal, *, today: date | None = None) -> dict:
    today = today or timezone.localdate()
    remaining = max(0, goal.target_amount_minor - goal.saved_amount_minor)
    days_remaining = (goal.target_date - today).days if goal.target_date else None
    months_remaining = max(1, ceil(days_remaining / 30)) if days_remaining and days_remaining > 0 else None
    return {
        "id": goal.pk,
        "name": goal.name,
        "target_amount_minor": goal.target_amount_minor,
        "saved_amount_minor": goal.saved_amount_minor,
        "remaining_minor": remaining,
        "target_date": goal.target_date.isoformat() if goal.target_date else None,
        "note": goal.note,
        "is_archived": goal.is_archived,
        "progress_percent": min(100.0, goal.progress_percent),
        "raw_progress_percent": goal.progress_percent,
        "is_complete": goal.saved_amount_minor >= goal.target_amount_minor,
        "days_remaining": days_remaining,
        "monthly_amount_needed_minor": round(remaining / months_remaining) if months_remaining else remaining,
        "status": (
            "complete"
            if goal.saved_amount_minor >= goal.target_amount_minor
            else "overdue"
            if days_remaining is not None and days_remaining < 0
            else "on_track"
        ),
        "progress_source": "user_recorded",
        "note_on_progress": "Saved amounts are recorded by you. OnePay does not infer a real bank balance.",
    }


def goal_savings_context(user, month: date) -> dict:
    goals = SavingsGoal.objects.filter(user=user, is_archived=False)
    total_target = sum(goal.target_amount_minor for goal in goals)
    total_saved = sum(goal.saved_amount_minor for goal in goals)
    return {
        "active_goal_count": goals.count(),
        "total_target_minor": total_target,
        "total_saved_minor": total_saved,
        "total_remaining_minor": max(0, total_target - total_saved),
        "progress_percent": round(total_saved * 100 / total_target, 1) if total_target else 0.0,
    }
