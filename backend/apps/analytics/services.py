"""Owner-scoped analytics over the existing OnePay transaction ledger."""

from collections import defaultdict
from datetime import date, datetime, time, timedelta

from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.payments.models import PaymentTransaction

from .categories import CATEGORY_NAMES, classify_transaction

PERIOD_CHOICES = {"this_month", "last_month", "last_3_months", "last_6_months", "this_year", "custom"}
SPENDING_KINDS = (PaymentTransaction.Kind.TRANSFER, PaymentTransaction.Kind.BILL, PaymentTransaction.Kind.RECHARGE)
MAX_CUSTOM_DAYS = 366


def _month_start(value: date) -> date:
    return value.replace(day=1)


def _shift_month(value: date, months: int) -> date:
    absolute_month = value.year * 12 + value.month - 1 + months
    year, month_index = divmod(absolute_month, 12)
    return date(year, month_index + 1, 1)


def _parse_date(value: str, parameter: str) -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError({parameter: ["Use a date in YYYY-MM-DD format."]}) from exc


def resolve_date_range(params, *, today=None):
    """Resolve period/date filters to inclusive start and exclusive end dates."""
    today = today or timezone.localdate()
    period = (params.get("period") or "this_month").strip()
    if period not in PERIOD_CHOICES:
        raise ValidationError({"period": [f"Choose one of: {', '.join(sorted(PERIOD_CHOICES))}."]})

    current_month = _month_start(today)
    if period == "this_month":
        start, end_exclusive = current_month, today + timedelta(days=1)
    elif period == "last_month":
        start, end_exclusive = _shift_month(current_month, -1), current_month
    elif period == "last_3_months":
        start, end_exclusive = _shift_month(current_month, -2), today + timedelta(days=1)
    elif period == "last_6_months":
        start, end_exclusive = _shift_month(current_month, -5), today + timedelta(days=1)
    elif period == "this_year":
        start, end_exclusive = date(today.year, 1, 1), today + timedelta(days=1)
    else:
        raw_start = (params.get("date_from") or "").strip()
        raw_end = (params.get("date_to") or "").strip()
        if not raw_start or not raw_end:
            raise ValidationError({"date_range": ["Custom ranges require both date_from and date_to."]})
        start = _parse_date(raw_start, "date_from")
        end = _parse_date(raw_end, "date_to")
        if end < start:
            raise ValidationError({"date_to": ["The end date must be on or after the start date."]})
        if end > today:
            raise ValidationError({"date_to": ["The end date cannot be in the future."]})
        if (end - start).days + 1 > MAX_CUSTOM_DAYS:
            raise ValidationError({"date_range": [f"Choose a custom range of at most {MAX_CUSTOM_DAYS} days."]})
        end_exclusive = end + timedelta(days=1)

    return period, start, end_exclusive


def _aware_midnight(value: date) -> datetime:
    return timezone.make_aware(datetime.combine(value, time.min), timezone.get_current_timezone())


def spending_queryset(user, start: date, end_exclusive: date):
    own_identifier = f"user{user.pk}@onepay"
    return (
        PaymentTransaction.objects.filter(
            sender=user,
            currency="INR",
            status=PaymentTransaction.Status.SUCCESSFUL,
            kind__in=SPENDING_KINDS,
            created_at__gte=_aware_midnight(start),
            created_at__lt=_aware_midnight(end_exclusive),
        )
        .exclude(Q(recipient_identifier__iexact=own_identifier) | Q(recipient__upi_id__iexact=own_identifier))
        .select_related("recipient")
        .order_by("-created_at", "-reference")
    )


def _entry(transaction_obj, user_id):
    classification = classify_transaction(transaction_obj, user_id)
    return {
        "reference": transaction_obj.reference,
        "recipient_name": transaction_obj.recipient_name,
        "kind": transaction_obj.kind,
        "service": transaction_obj.service,
        "note": transaction_obj.note,
        "amount_minor": transaction_obj.amount_minor,
        "currency": transaction_obj.currency,
        "status": transaction_obj.status,
        "created_at": transaction_obj.created_at,
        "category": classification.category,
        "subcategory": classification.subcategory,
        "classification_method": classification.method,
        "confidence": classification.confidence,
        "source": "simulated",
    }


def _sum_spending(user, start, end_exclusive):
    total = spending_queryset(user, start, end_exclusive).aggregate(total=Sum("amount_minor"))["total"]
    return int(total or 0)


def _month_comparison(user, period, start, end_exclusive):
    if period not in {"this_month", "last_month"}:
        return None
    selected_start = start
    selected_month_end = _shift_month(selected_start, 1)
    if period == "this_month":
        selected_end = end_exclusive
        elapsed_days = (selected_end - selected_start).days
        previous_start = _shift_month(selected_start, -1)
        previous_end = min(_shift_month(previous_start, 1), previous_start + timedelta(days=elapsed_days))
    else:
        selected_end = selected_month_end
        previous_start = _shift_month(selected_start, -1)
        previous_end = selected_start
    current_total = _sum_spending(user, selected_start, selected_end)
    previous_total = _sum_spending(user, previous_start, previous_end)
    delta = current_total - previous_total
    return {
        "current_period_start": selected_start.isoformat(),
        "current_period_end": (selected_end - timedelta(days=1)).isoformat(),
        "comparison_start": previous_start.isoformat(),
        "comparison_end": (previous_end - timedelta(days=1)).isoformat(),
        "current_total_minor": current_total,
        "previous_total_minor": previous_total,
        "change_minor": delta,
        "change_percent": round(delta * 100 / previous_total, 1) if previous_total else None,
    }


def build_spending_summary(user, params):
    period, start, end_exclusive = resolve_date_range(params)
    total_days = max(1, (end_exclusive - start).days)
    total_spending = 0
    category_amounts = defaultdict(int)
    category_counts = defaultdict(int)
    daily_amounts = defaultdict(int)
    largest = None
    eligible_count = 0

    for transaction_obj in spending_queryset(user, start, end_exclusive).iterator(chunk_size=500):
        classification = classify_transaction(transaction_obj, user.pk)
        if classification.is_internal_transfer:
            continue
        amount = int(transaction_obj.amount_minor)
        total_spending += amount
        eligible_count += 1
        category_amounts[classification.category] += amount
        category_counts[classification.category] += 1
        local_day = timezone.localtime(transaction_obj.created_at).date().isoformat()
        daily_amounts[local_day] += amount
        if largest is None or amount > largest["amount_minor"]:
            largest = {
                "reference": transaction_obj.reference,
                "recipient_name": transaction_obj.recipient_name,
                "amount_minor": amount,
                "created_at": transaction_obj.created_at,
                "category": classification.category,
            }

    categories = [
        {
            "category": category,
            "amount_minor": amount,
            "transaction_count": category_counts[category],
            "percentage": round(amount * 100 / total_spending, 1) if total_spending else 0.0,
        }
        for category, amount in sorted(category_amounts.items(), key=lambda item: (-item[1], item[0]))
    ]
    highest_category = categories[0] if categories else None
    daily_trend = [
        {"date": (start + timedelta(days=offset)).isoformat(), "amount_minor": daily_amounts.get((start + timedelta(days=offset)).isoformat(), 0)}
        for offset in range(total_days)
    ]

    in_period = PaymentTransaction.objects.filter(
        sender=user,
        currency="INR",
        created_at__gte=_aware_midnight(start),
        created_at__lt=_aware_midnight(end_exclusive),
    )
    status_rows = {
        row["status"]: {"count": row["count"], "amount_minor": int(row["total"] or 0)}
        for row in in_period.filter(status__in=("pending", "failed", "reversed"))
        .values("status")
        .annotate(count=Count("pk"), total=Sum("amount_minor"))
    }
    topups = in_period.filter(kind=PaymentTransaction.Kind.TOPUP, status=PaymentTransaction.Status.SUCCESSFUL).aggregate(
        total=Sum("amount_minor"), count=Count("pk")
    )

    return {
        "period": {
            "key": period,
            "start_date": start.isoformat(),
            "end_date": (end_exclusive - timedelta(days=1)).isoformat(),
            "days": total_days,
        },
        "total_spending_minor": total_spending,
        "average_daily_spending_minor": round(total_spending / total_days),
        "transaction_count": eligible_count,
        "money_received_minor": None,
        "net_cash_flow_minor": None,
        "income_data_available": False,
        "income_unavailable_reason": "OnePay currently records outgoing simulated payments and wallet top-ups, not incoming transfers or verified income.",
        "demo_topups_minor": int(topups["total"] or 0),
        "demo_topup_count": int(topups["count"] or 0),
        "largest_expense": largest,
        "highest_category": highest_category,
        "categories": categories,
        "daily_trend": daily_trend,
        "excluded_activity": {
            key: {
                "count": status_rows.get(key, {}).get("count", 0),
                "amount_minor": status_rows.get(key, {}).get("amount_minor", 0),
            }
            for key in ("pending", "failed", "reversed")
        },
        "month_over_month": _month_comparison(user, period, start, end_exclusive),
        "recent_transactions": [
            _entry(transaction_obj, user.pk)
            for transaction_obj in spending_queryset(user, start, end_exclusive)[:8]
        ],
        "categorization": {
            "method": "local_rules_and_transaction_metadata",
            "external_ai_used": False,
            "confidence_note": "Confidence is a heuristic rule-strength indicator, not a machine-learning probability.",
        },
    }


def list_spending_transactions(user, params):
    period, start, end_exclusive = resolve_date_range(params)
    category = (params.get("category") or "").strip()
    if category and category not in CATEGORY_NAMES:
        raise ValidationError({"category": [f"Choose one of: {', '.join(CATEGORY_NAMES)}."]})
    try:
        page = int(params.get("page", "1"))
        page_size = int(params.get("page_size", "20"))
    except (TypeError, ValueError) as exc:
        raise ValidationError({"page": ["Page and page_size must be whole numbers."]}) from exc
    if page < 1:
        raise ValidationError({"page": ["Page must be at least 1."]})
    if not 1 <= page_size <= 50:
        raise ValidationError({"page_size": ["Choose a page size between 1 and 50."]})

    start_index, end_index = (page - 1) * page_size, page * page_size
    matches = []
    count = 0
    for transaction_obj in spending_queryset(user, start, end_exclusive).iterator(chunk_size=500):
        entry = _entry(transaction_obj, user.pk)
        if category and entry["category"] != category:
            continue
        if start_index <= count < end_index:
            matches.append(entry)
        count += 1

    return {
        "period": {"key": period, "start_date": start.isoformat(), "end_date": (end_exclusive - timedelta(days=1)).isoformat()},
        "count": count,
        "page": page,
        "page_size": page_size,
        "total_pages": (count + page_size - 1) // page_size,
        "has_next": end_index < count,
        "has_previous": page > 1 and count > 0,
        "results": matches,
    }
