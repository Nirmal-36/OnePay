"""Eligible-transaction extraction and reusable analytics context.

The ledger remains owned by ``apps.payments``. This module narrows the query to
the authenticated user's date-bounded, completed outgoing transactions, applies
the layered categorizer once, and exposes a small context object to the summary,
insight, forecast, budget, and report services.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from django.db.models import Count, Min, Q, Sum
from django.utils import timezone

from apps.payments.models import PaymentTransaction

from .categories import classify_transaction
from .classifiers import external_ai_configured, user_has_external_ai_consent
from .models import TransactionCategoryCorrection
from .periods import Period, aware_midnight, month_key, month_label

SPENDING_KINDS = (
    PaymentTransaction.Kind.TRANSFER,
    PaymentTransaction.Kind.BILL,
    PaymentTransaction.Kind.RECHARGE,
)
INSIGHT_MIN_TRANSACTIONS = 5
INSIGHT_MIN_HISTORY_DAYS = 14
FORECAST_MIN_TRANSACTIONS = 10
FORECAST_MIN_HISTORY_DAYS = 60
FORECAST_MIN_COMPLETE_MONTHS = 2


@dataclass(frozen=True)
class LedgerRow:
    transaction_pk: object
    reference: str
    created_at: object
    local_date: date
    amount_minor: int
    category: str
    subcategory: str
    classification_method: str
    confidence: float
    merchant_key: str
    merchant_label: str
    kind: str
    service: str
    note: str
    recipient_name: str
    is_consumption: bool


@dataclass
class AnalyticsContext:
    user: object
    period: Period
    rows: list[LedgerRow]
    excluded: dict
    demo_topups: dict
    data_quality: dict
    corrections_applied: int

    @property
    def total_spending_minor(self) -> int:
        return sum(row.amount_minor for row in self.rows)

    @property
    def consumption_spending_minor(self) -> int:
        return sum(row.amount_minor for row in self.rows if row.is_consumption)


def _correction_maps(user_id: int) -> tuple[dict, dict, int]:
    corrections = list(
        TransactionCategoryCorrection.objects.filter(user_id=user_id).order_by("updated_at", "pk")
    )
    by_transaction: dict = {}
    by_merchant: dict = {}
    applied = 0
    for correction in corrections:
        if correction.transaction_id is not None:
            by_transaction[correction.transaction_id] = correction
        if correction.apply_to_future and correction.merchant_key:
            # Later corrections win for the same merchant.
            by_merchant[correction.merchant_key] = correction
        applied += 1
    return by_transaction, by_merchant, applied


def spending_queryset(user, period: Period):
    """Completed outgoing transactions in the period, excluding demo top-ups."""
    return (
        PaymentTransaction.objects.filter(
            sender=user,
            currency="INR",
            status=PaymentTransaction.Status.SUCCESSFUL,
            kind__in=SPENDING_KINDS,
            created_at__gte=aware_midnight(period.start),
            created_at__lt=aware_midnight(period.end_exclusive),
        )
        .select_related("recipient")
        .order_by("-created_at", "-reference")
    )


def build_rows(user, period: Period) -> tuple[list[LedgerRow], int]:
    by_transaction, by_merchant, correction_count = _correction_maps(user.pk)
    external_allowed = external_ai_configured() and user_has_external_ai_consent(user.pk)
    rows: list[LedgerRow] = []
    for transaction in spending_queryset(user, period).iterator(chunk_size=500):
        classification = classify_transaction(
            transaction,
            user.pk,
            corrections=by_merchant,
            transaction_corrections=by_transaction,
            allow_external_fallback=external_allowed,
        )
        if classification.is_internal_transfer:
            # Own-account movement is recorded in excluded activity, not spending.
            continue
        rows.append(
            LedgerRow(
                transaction_pk=transaction.pk,
                reference=transaction.reference,
                created_at=transaction.created_at,
                local_date=timezone.localtime(transaction.created_at).date(),
                amount_minor=int(transaction.amount_minor),
                category=classification.category,
                subcategory=classification.subcategory,
                classification_method=classification.method,
                confidence=classification.confidence,
                merchant_key=classification.merchant_key,
                merchant_label=classification.merchant_label,
                kind=transaction.kind,
                service=transaction.service,
                note=transaction.note,
                recipient_name=transaction.recipient_name,
                is_consumption=classification.is_consumption,
            )
        )
    return rows, correction_count


def excluded_activity(user, period: Period) -> dict:
    in_period = PaymentTransaction.objects.filter(
        sender=user,
        currency="INR",
        created_at__gte=aware_midnight(period.start),
        created_at__lt=aware_midnight(period.end_exclusive),
    )
    status_rows = {
        row["status"]: {"count": row["count"], "amount_minor": int(row["total"] or 0)}
        for row in in_period.filter(status__in=("pending", "failed", "reversed"))
        .values("status")
        .annotate(count=Count("pk"), total=Sum("amount_minor"))
    }
    own_identifier = f"user{user.pk}@onepay"
    internal = (
        in_period.filter(
            status=PaymentTransaction.Status.SUCCESSFUL,
            kind=PaymentTransaction.Kind.TRANSFER,
        )
        .filter(Q(recipient_identifier__iexact=own_identifier) | Q(recipient__upi_id__iexact=own_identifier))
        .aggregate(count=Count("pk"), total=Sum("amount_minor"))
    )
    topups = in_period.filter(
        kind=PaymentTransaction.Kind.TOPUP,
        status=PaymentTransaction.Status.SUCCESSFUL,
    ).aggregate(count=Count("pk"), total=Sum("amount_minor"))
    payload = {
        key: {
            "count": status_rows.get(key, {}).get("count", 0),
            "amount_minor": status_rows.get(key, {}).get("amount_minor", 0),
        }
        for key in ("pending", "failed", "reversed")
    }
    payload["internal_transfer"] = {
        "count": int(internal["count"] or 0),
        "amount_minor": int(internal["total"] or 0),
    }
    return payload


def demo_topups(user, period: Period) -> dict:
    aggregate = PaymentTransaction.objects.filter(
        sender=user,
        currency="INR",
        kind=PaymentTransaction.Kind.TOPUP,
        status=PaymentTransaction.Status.SUCCESSFUL,
        created_at__gte=aware_midnight(period.start),
        created_at__lt=aware_midnight(period.end_exclusive),
    ).aggregate(count=Count("pk"), total=Sum("amount_minor"))
    return {"count": int(aggregate["count"] or 0), "amount_minor": int(aggregate["total"] or 0)}


def user_history_bounds(user) -> tuple[date | None, date | None]:
    aggregate = PaymentTransaction.objects.filter(
        sender=user,
        currency="INR",
        status=PaymentTransaction.Status.SUCCESSFUL,
        kind__in=SPENDING_KINDS,
    ).aggregate(first=Min("created_at"))
    first = aggregate["first"]
    if first is None:
        return None, None
    first_date = timezone.localtime(first).date()
    return first_date, timezone.localdate()


def data_quality(user, period: Period, rows: list[LedgerRow] | None = None) -> dict:
    rows = rows if rows is not None else build_rows(user, period)[0]
    first_date, today = user_history_bounds(user)
    today = today or timezone.localdate()
    history_days = (today - first_date).days + 1 if first_date else 0
    months = sorted({month_key(row.local_date) for row in rows})
    transaction_count = len(rows)
    eligible_days = len({row.local_date for row in rows})
    sufficient_insights = transaction_count >= INSIGHT_MIN_TRANSACTIONS and history_days >= INSIGHT_MIN_HISTORY_DAYS
    complete_months = _complete_spending_months(user, today)
    sufficient_forecast = (
        transaction_count >= FORECAST_MIN_TRANSACTIONS
        and history_days >= FORECAST_MIN_HISTORY_DAYS
        and len(complete_months) >= FORECAST_MIN_COMPLETE_MONTHS
    )
    notes: list[str] = []
    if not transaction_count:
        notes.append("No completed eligible spending was recorded in this period.")
    elif not sufficient_insights:
        notes.append(
            f"Behavior insights need at least {INSIGHT_MIN_TRANSACTIONS} completed transactions and "
            f"{INSIGHT_MIN_HISTORY_DAYS} days of history. This period has {transaction_count} and {history_days} days."
        )
    if not sufficient_forecast:
        notes.append(
            f"Forecasts need at least {FORECAST_MIN_TRANSACTIONS} completed transactions, "
            f"{FORECAST_MIN_HISTORY_DAYS} days of history, and {FORECAST_MIN_COMPLETE_MONTHS} complete months of spending."
        )
    return {
        "transaction_count": transaction_count,
        "eligible_days": eligible_days,
        "period_days": period.days,
        "history_days": history_days,
        "first_transaction_date": first_date.isoformat() if first_date else None,
        "months_in_period": months,
        "complete_months_with_spending": [month_key(value) for value in complete_months[-6:]],
        "sufficient_for_insights": sufficient_insights,
        "sufficient_for_forecast": sufficient_forecast,
        "thresholds": {
            "insights_min_transactions": INSIGHT_MIN_TRANSACTIONS,
            "insights_min_history_days": INSIGHT_MIN_HISTORY_DAYS,
            "forecast_min_transactions": FORECAST_MIN_TRANSACTIONS,
            "forecast_min_history_days": FORECAST_MIN_HISTORY_DAYS,
            "forecast_min_complete_months": FORECAST_MIN_COMPLETE_MONTHS,
        },
        "notes": notes,
    }


def _complete_spending_months(user, today: date) -> list[date]:
    current_month = today.replace(day=1)
    rows = (
        PaymentTransaction.objects.filter(
            sender=user,
            currency="INR",
            status=PaymentTransaction.Status.SUCCESSFUL,
            kind__in=SPENDING_KINDS,
            created_at__lt=aware_midnight(current_month),
        )
        .values_list("created_at", flat=True)
        .iterator(chunk_size=500)
    )
    seen: set[date] = set()
    for value in rows:
        seen.add(timezone.localtime(value).date().replace(day=1))
    return sorted(seen)


def build_context(user, period: Period) -> AnalyticsContext:
    rows, corrections_applied = build_rows(user, period)
    return AnalyticsContext(
        user=user,
        period=period,
        rows=rows,
        excluded=excluded_activity(user, period),
        demo_topups=demo_topups(user, period),
        data_quality=data_quality(user, period, rows),
        corrections_applied=corrections_applied,
    )


def month_rows_by_category(rows: list[LedgerRow]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for row in rows:
        entry = result.setdefault(
            row.category,
            {"amount_minor": 0, "transaction_count": 0, "subcategories": {}},
        )
        entry["amount_minor"] += row.amount_minor
        entry["transaction_count"] += 1
        sub = entry["subcategories"].setdefault(row.subcategory, {"amount_minor": 0, "transaction_count": 0})
        sub["amount_minor"] += row.amount_minor
        sub["transaction_count"] += 1
    return result


def monthly_buckets(period: Period, rows: list[LedgerRow]) -> list[dict]:
    """Return every calendar month touched by the period, including empty ones."""
    buckets: list[dict] = []
    cursor = period.start.replace(day=1)
    by_month: dict[str, list[LedgerRow]] = {}
    for row in rows:
        by_month.setdefault(month_key(row.local_date), []).append(row)
    while cursor < period.end_exclusive:
        key = month_key(cursor)
        bucket_rows = by_month.get(key, [])
        buckets.append(
            {
                "month": key,
                "label": month_label(cursor),
                "amount_minor": sum(row.amount_minor for row in bucket_rows),
                "consumption_minor": sum(row.amount_minor for row in bucket_rows if row.is_consumption),
                "transaction_count": len(bucket_rows),
            }
        )
        cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
    return buckets
