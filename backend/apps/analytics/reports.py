"""Monthly financial reports and CSV export from verified analytics."""

from __future__ import annotations

import csv
import io
from collections import defaultdict
from datetime import date, timedelta

from django.utils import timezone

from apps.payments.models import PaymentTransaction

from .aggregates import (
    average_active_day,
    average_daily,
    category_breakdown,
    daily_trend,
    entry_from_row,
    largest_expense,
    month_comparison,
    top_merchants,
    weekday_weekend,
)
from .budgets import build_budget_overview, goal_savings_context
from .forecasting import build_anomalies
from .insights import build_insights
from .ledger import SPENDING_KINDS, build_context, build_rows, data_quality
from .periods import Period, month_end_exclusive, month_key, month_label, report_month_bounds, shift_month


def available_report_months(user, *, today: date | None = None) -> list[dict]:
    today = today or timezone.localdate()
    current_month = today.replace(day=1)
    rows = (
        PaymentTransaction.objects.filter(
            sender=user,
            currency="INR",
            status=PaymentTransaction.Status.SUCCESSFUL,
        )
        .values_list("created_at", flat=True)
        .iterator(chunk_size=1000)
    )
    counts: dict[date, int] = defaultdict(int)
    for value in rows:
        local_day = timezone.localtime(value).date()
        counts[local_day.replace(day=1)] += 1
    earliest = min(counts) if counts else current_month
    months = []
    cursor = earliest
    while cursor <= current_month:
        months.append(
            {
                "month": month_key(cursor),
                "label": month_label(cursor),
                "has_data": counts.get(cursor, 0) > 0,
                "transaction_count": counts.get(cursor, 0),
                "is_current": cursor == current_month,
            }
        )
        cursor = shift_month(cursor, 1)
    if not months:
        months.append(
            {
                "month": month_key(current_month),
                "label": month_label(current_month),
                "has_data": False,
                "transaction_count": 0,
                "is_current": True,
            }
        )
    return months[-36:]


def _six_month_history(user, month: date) -> list[dict]:
    start = shift_month(month, -5)
    period = Period("report_history", start, month_end_exclusive(month), "Six-month history")
    rows, _ = build_rows(user, period)
    history = []
    cursor = start
    while cursor <= month:
        month_rows = [row for row in rows if cursor <= row.local_date < month_end_exclusive(cursor)]
        history.append(
            {
                "month": month_key(cursor),
                "label": month_label(cursor),
                "amount_minor": sum(row.amount_minor for row in month_rows),
                "transaction_count": len(month_rows),
            }
        )
        cursor = shift_month(cursor, 1)
    return history


def _outflow_by_kind(context) -> list[dict]:
    totals = defaultdict(int)
    counts = defaultdict(int)
    for row in context.rows:
        totals[row.kind] += row.amount_minor
        counts[row.kind] += 1
    labels = {"transfer": "Person-to-person transfers", "bill": "Bill payments", "recharge": "Mobile / DTH recharges"}
    return [
        {
            "kind": kind,
            "label": labels.get(kind, kind),
            "amount_minor": totals[kind],
            "transaction_count": counts[kind],
            "percentage": round(totals[kind] * 100 / context.total_spending_minor, 1)
            if context.total_spending_minor
            else 0.0,
        }
        for kind in ("transfer", "bill", "recharge")
    ]


def _executive_summary(context, comparison: dict, budgets: dict, merchants: list[dict]) -> str:
    if not context.rows:
        return (
            f"No completed eligible spending was recorded in {context.period.label}. "
            "Pending, failed, reversed, and own-account transfers are excluded from spending."
        )
    parts = [
        f"In {context.period.label}, you made {len(context.rows)} completed payments totalling "
        f"₹{context.total_spending_minor / 100:,.2f}, averaging ₹{average_daily(context) / 100:,.2f} per calendar day."
    ]
    categories = category_breakdown(context)
    if categories:
        top = categories[0]
        parts.append(
            f"{top['category']} was the largest category at ₹{top['amount_minor'] / 100:,.2f} "
            f"({top['percentage']:.1f}% of outflow)."
        )
    if comparison["previous_total_minor"]:
        direction = "more" if comparison["change_minor"] > 0 else "less"
        parts.append(
            f"Spending was {abs(comparison['change_percent']):.1f}% {direction} than the comparison month "
            f"({comparison['comparison_start']} to {comparison['comparison_end']})."
        )
    elif comparison["current_total_minor"]:
        parts.append("There was no prior-month spending baseline for a month-over-month percentage.")
    if merchants:
        parts.append(
            f"The top merchant was {merchants[0]['name']} at ₹{merchants[0]['amount_minor'] / 100:,.2f}."
        )
    if budgets.get("overall"):
        overall = budgets["overall"]
        parts.append(
            f"The overall budget is {overall['utilization_percent']:.1f}% used, with "
            f"₹{abs(overall['remaining_minor']) / 100:,.2f} {'remaining' if overall['remaining_minor'] >= 0 else 'over'}."
        )
    if context.demo_topups["amount_minor"]:
        parts.append(
            f"₹{context.demo_topups['amount_minor'] / 100:,.2f} of simulated wallet top-ups are reported separately "
            "and are not income."
        )
    parts.append("All figures come from recorded OnePay demo payments; no real bank balance is inferred.")
    return " ".join(parts)


def build_monthly_report(user, month: date, *, today: date | None = None) -> dict:
    today = today or timezone.localdate()
    period = report_month_bounds(month, today=today)
    context = build_context(user, period)
    comparison = month_comparison(user, period, context.rows)
    categories = category_breakdown(context)
    merchants = top_merchants(context, limit=8)
    largest = largest_expense(context)
    top_transactions = [
        entry_from_row(row) for row in sorted(context.rows, key=lambda item: -item.amount_minor)[:8]
    ]
    budgets = build_budget_overview(user, month.replace(day=1), today=today)
    insights_payload = build_insights(user, period, context)
    insights = insights_payload["insights"]
    anomalies = build_anomalies(user, period, context=context)
    recurring = [insight for insight in insights if insight["kind"] == "recurring_payment"]
    unusual = [insight for insight in insights if insight["kind"] == "large_expense"]
    unusual.extend(anomalies["anomalies"])
    opportunities = [insight for insight in insights if insight["kind"] in {"review_opportunity", "frequent_small"}]
    quality = data_quality(user, period, context.rows)

    report = {
        "report_type": "monthly_spending_report",
        "month": month_key(month),
        "label": month_label(month),
        "period": period.as_dict(),
        "generated_at": timezone.now(),
        "source": "simulated_onepay_transactions",
        "is_partial_month": period.is_partial_month,
        "summary": {
            "total_spending_minor": context.total_spending_minor,
            "consumption_spending_minor": context.consumption_spending_minor,
            "transaction_count": len(context.rows),
            "average_daily_spending_minor": average_daily(context),
            "average_active_day_spending_minor": average_active_day(context),
            "largest_expense": largest,
            "highest_category": categories[0] if categories else None,
            "demo_topups_minor": context.demo_topups["amount_minor"],
            "demo_topup_count": context.demo_topups["count"],
        },
        "income_and_outflow": {
            "income_available": False,
            "income_unavailable_reason": (
                "OnePay records outgoing simulated payments and demo wallet top-ups, not verified incoming income. "
                "Incoming funds are not inferred."
            ),
            "verified_income_minor": None,
            "demo_funds_added_minor": context.demo_topups["amount_minor"],
            "demo_funds_added_count": context.demo_topups["count"],
            "outflow_by_kind": _outflow_by_kind(context),
            "net_cash_flow_minor": None,
            "money_received_minor": None,
        },
        "categories": categories,
        "top_merchants": merchants,
        "largest_transactions": top_transactions,
        "recurring_payments": recurring,
        "weekday_weekend": weekday_weekend(context),
        "month_over_month": comparison,
        "six_month_history": _six_month_history(user, month.replace(day=1)),
        "daily_trend": daily_trend(context),
        "budgets": budgets,
        "savings_goals": goal_savings_context(user, month.replace(day=1)),
        "unusual_transactions": unusual,
        "opportunities": opportunities,
        "executive_summary": _executive_summary(context, comparison, budgets, merchants),
        "data_quality": quality,
        "method_note": (
            "Calculated from completed, successful INR payments owned by the authenticated user. Pending, failed, "
            "reversed, demo top-ups, and own-account transfers are excluded from spending. Income is not inferred. "
            "All amounts are recorded demo values, not projections."
        ),
        "limitations": [
            "OnePay is a simulated payment demo and does not connect to a bank account.",
            "Category totals depend on the local categorizer and any corrections you saved.",
            "The executive summary is generated from the computed figures above; it does not invent amounts or transactions.",
        ],
    }
    return report


def _safe_cell(value) -> str:
    text = "" if value is None else str(value)
    if text.startswith(("=", "+", "-", "@", "\t", "\r")):
        return f"'{text}"
    return text


def report_csv(report: dict) -> str:
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(
        [
            "section",
            "label",
            "category",
            "date",
            "reference",
            "amount_minor",
            "amount_inr",
            "percentage",
            "count",
            "detail",
        ]
    )

    def row(section, label, *, category="", date_value="", reference="", amount_minor="", percentage="", count="", detail=""):
        writer.writerow(
            [
                section,
                _safe_cell(label),
                _safe_cell(category),
                date_value,
                reference,
                amount_minor,
                f"{amount_minor / 100:.2f}" if isinstance(amount_minor, int) else "",
                percentage,
                count,
                _safe_cell(detail),
            ]
        )

    row("report", "Month", detail=f"{report['label']} ({report['month']})")
    row("report", "Period", date_value=report["period"]["start_date"], detail=report["period"]["end_date"])
    row("report", "Generated at", detail=report["generated_at"].isoformat())
    row("report", "Source", detail=report["source"])
    row("summary", "Total completed outflow", amount_minor=report["summary"]["total_spending_minor"], detail="INR minor units")
    row("summary", "Consumption spending", amount_minor=report["summary"]["consumption_spending_minor"])
    row("summary", "Completed transactions", count=report["summary"]["transaction_count"])
    row("summary", "Average daily spending", amount_minor=report["summary"]["average_daily_spending_minor"])
    row("summary", "Average active-day spending", amount_minor=report["summary"]["average_active_day_spending_minor"])
    row("summary", "Demo wallet top-ups (not income)", amount_minor=report["summary"]["demo_topups_minor"], detail="Reported separately")
    row("income", "Verified income", detail=report["income_and_outflow"]["income_unavailable_reason"])
    row("income", "Net cash flow", detail="Not available because incoming funds are not recorded.")
    row("executive_summary", "Summary", detail=report["executive_summary"])
    for item in report["categories"]:
        row(
            "category",
            item["category"],
            category=item["category"],
            amount_minor=item["amount_minor"],
            percentage=item["percentage"],
            count=item["transaction_count"],
            detail="; ".join(sub["subcategory"] for sub in item["subcategories"][:4]),
        )
    for merchant in report["top_merchants"]:
        row(
            "merchant",
            merchant["name"],
            category=merchant["category"],
            amount_minor=merchant["amount_minor"],
            percentage=merchant["percentage"],
            count=merchant["transaction_count"],
            detail=f"Last payment {merchant['last_date']}",
        )
    for transaction in report["largest_transactions"]:
        row(
            "largest_transaction",
            transaction["recipient_name"],
            category=transaction["category"],
            date_value=transaction["created_at"].date().isoformat(),
            reference=transaction["reference"],
            amount_minor=transaction["amount_minor"],
            detail=f"{transaction['kind']} · {transaction['subcategory']}",
        )
    for insight in report["recurring_payments"]:
        row(
            "recurring_payment",
            insight["evidence"]["merchant"],
            category=insight["evidence"]["category"],
            amount_minor=insight["evidence"]["amount_minor"],
            count=insight["evidence"]["transaction_count"],
            detail=insight["explanation"],
        )
    comparison = report["month_over_month"]
    row(
        "comparison",
        "Month over month",
        date_value=comparison["comparison_start"],
        amount_minor=comparison["change_minor"],
        percentage=comparison["change_percent"],
        detail=f"{comparison['comparison_start']} to {comparison['comparison_end']} · {comparison['basis']}",
    )
    if report["budgets"].get("overall"):
        overall = report["budgets"]["overall"]
        row(
            "budget",
            "Overall budget",
            amount_minor=overall["limit_minor"],
            percentage=overall["utilization_percent"],
            detail=f"Spent {overall['spent_minor']} minor; status {overall['status']}",
        )
    for budget in report["budgets"]["categories"]:
        row(
            "budget",
            budget["category"],
            category=budget["category"],
            amount_minor=budget["limit_minor"],
            percentage=budget["utilization_percent"],
            detail=f"Spent {budget['spent_minor']} minor; status {budget['status']}",
        )
    for anomaly in report["unusual_transactions"]:
        row(
            "unusual_transaction",
            anomaly.get("merchant") or anomaly.get("title", "Unusual transaction"),
            category=anomaly.get("category") or anomaly.get("evidence", {}).get("category", ""),
            date_value=anomaly.get("date", ""),
            reference=anomaly.get("reference", ""),
            amount_minor=anomaly.get("amount_minor", ""),
            detail=anomaly.get("explanation") or anomaly.get("calculation", ""),
        )
    for opportunity in report["opportunities"]:
        row(
            "opportunity",
            opportunity["title"],
            category=opportunity["evidence"].get("category", ""),
            amount_minor=opportunity["evidence"].get("amount_minor", ""),
            detail=opportunity["action"],
        )
    return output.getvalue()


def build_period_csv(user, period: Period) -> str:
    """Build a transaction-backed CSV for an arbitrary validated date period."""
    context = build_context(user, period)
    categories = category_breakdown(context)
    merchants = top_merchants(context, limit=20)
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(
        [
            "section", "label", "category", "date", "reference", "amount_minor",
            "amount_inr", "percentage", "count", "detail",
        ]
    )

    def write_row(
        section, label, *, category="", date_value="", reference="", amount_minor="",
        percentage="", count="", detail="",
    ):
        amount_inr = f"{amount_minor / 100:.2f}" if isinstance(amount_minor, int) else ""
        writer.writerow(
            [
                section, _safe_cell(label), _safe_cell(category), date_value,
                _safe_cell(reference), amount_minor, amount_inr, percentage, count,
                _safe_cell(detail),
            ]
        )

    write_row(
        "report", "Custom date range", date_value=period.start.isoformat(),
        detail=period.end_inclusive.isoformat(),
    )
    write_row("report", "Generated at", detail=timezone.now().isoformat())
    write_row("report", "Source", detail="simulated_onepay_transactions")
    write_row(
        "summary", "Total completed outflow", amount_minor=context.total_spending_minor,
        count=len(context.rows), detail="Eligible successful outgoing payments; INR minor units.",
    )
    write_row(
        "summary", "Consumption spending", amount_minor=context.consumption_spending_minor,
        detail="Excludes transfers and categories marked as non-consumption.",
    )
    write_row("summary", "Average daily spending", amount_minor=average_daily(context))
    write_row("summary", "Average active-day spending", amount_minor=average_active_day(context))
    write_row(
        "summary", "Demo wallet top-ups (not income)",
        amount_minor=int(context.demo_topups.get("amount_minor", 0)),
        count=int(context.demo_topups.get("count", 0)),
        detail="Reported separately; never treated as income or spending.",
    )

    for category in categories:
        subcategories = "; ".join(item["subcategory"] for item in category["subcategories"][:8])
        write_row(
            "category", category["category"], category=category["category"],
            amount_minor=category["amount_minor"], percentage=category["percentage"],
            count=category["transaction_count"], detail=subcategories,
        )
    for merchant in merchants:
        write_row(
            "merchant", merchant["name"], category=merchant.get("category", ""),
            date_value=merchant.get("last_date", ""), amount_minor=merchant["amount_minor"],
            percentage=merchant.get("percentage", ""), count=merchant["transaction_count"],
            detail="Top merchant in the selected date range.",
        )
    for transaction in sorted(context.rows, key=lambda item: (item.local_date, item.created_at, item.reference)):
        write_row(
            "transaction", transaction.merchant_label or transaction.recipient_name,
            category=transaction.category, date_value=transaction.local_date.isoformat(),
            reference=transaction.reference, amount_minor=transaction.amount_minor, count=1,
            detail=f"{transaction.kind} · {transaction.subcategory} · {transaction.classification_method}",
        )
    write_row(
        "report", "Method note",
        detail=(
            "Only the authenticated user's successful eligible INR outgoing transactions are included. "
            "Pending, failed, reversed, own-account transfers, and demo top-ups are not counted as consumption. "
            "No bank balance or income is inferred. Text cells are guarded against spreadsheet formula injection."
        ),
    )
    return output.getvalue()

