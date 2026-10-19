"""Owner-scoped analytics orchestration for OnePay."""

from __future__ import annotations

from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from apps.payments.models import PaymentTransaction

from .aggregates import (
    average_active_day,
    average_daily,
    category_breakdown,
    daily_trend,
    entry_from_row,
    largest_expense,
    month_comparison,
    monthly_trend,
    preceding_period_comparison,
    top_merchants,
    weekday_weekend,
)
from .budgets import build_budget_overview
from .cache import cached_payload
from .categories import (
    CATEGORY_NAMES,
    CATEGORY_SET,
    CATEGORY_SUBCATEGORIES,
    NON_CONSUMPTION_CATEGORIES,
    classify_transaction,
    merchant_key_for,
    merchant_label_for,
    sanitize_subcategory,
)
from .classifiers import external_ai_status
from .insights import build_insights
from .ledger import SPENDING_KINDS, build_context, build_rows
from .models import AnalyticsPreference, TransactionCategoryCorrection
from .periods import PERIOD_CHOICES, PERIOD_LABELS, Period, resolve_period as _resolve_period


def _external_status(user) -> dict:
    return external_ai_status(user.pk)


def build_spending_summary(user, params) -> dict:
    period = _resolve_period(params)
    today_key = timezone.localdate().isoformat()
    params_key = {
        "period": period.key,
        "start": period.start.isoformat(),
        "end": period.end_exclusive.isoformat(),
        "today": today_key,
    }

    def builder() -> dict:
        context = build_context(user, period)
        categories = category_breakdown(context)
        largest = largest_expense(context)
        comparison = month_comparison(user, period, context.rows)
        preceding = preceding_period_comparison(user, period, context.total_spending_minor)
        insights_payload = build_insights(user, period, context)
        latest_month = period.end_inclusive.replace(day=1)
        budgets = build_budget_overview(user, latest_month)
        categorization = _external_status(user)
        categorization.update(
            {
                "method": "layered_rules_metadata_and_optional_consented_classifier",
                "external_ai_configured": categorization["configured"],
                "external_ai_consent": categorization["consent"],
                "external_ai_used": any(
                    row.classification_method == "llm_fallback" for row in context.rows
                ),
                "user_corrections_stored": context.corrections_applied,
                "confidence_note": (
                    "Confidence is a transparent rule-strength or configured-classifier value. "
                    "It is not a calibrated probability."
                ),
            }
        )
        return {
            "period": period.as_dict(),
            "generated_at": timezone.now(),
            "total_spending_minor": context.total_spending_minor,
            "consumption_spending_minor": context.consumption_spending_minor,
            "average_daily_spending_minor": average_daily(context),
            "average_active_day_spending_minor": average_active_day(context),
            "active_spending_days": len({row.local_date for row in context.rows}),
            "transaction_count": len(context.rows),
            "money_received_minor": None,
            "net_cash_flow_minor": None,
            "income_data_available": False,
            "income_unavailable_reason": (
                "OnePay currently records outgoing simulated payments and demo wallet top-ups, not incoming "
                "transfers or verified income. Money received and net cash flow are not inferred."
            ),
            "money_received": {
                "available": False,
                "verified_income_available": False,
                "demo_funds_added_minor": context.demo_topups["amount_minor"],
                "demo_funds_added_count": context.demo_topups["count"],
                "label": "Verified money received is not tracked",
                "note": (
                    "Only outgoing payments and simulated wallet top-ups exist in this demo ledger. "
                    "Demo top-ups are not income and are never counted as spending."
                ),
            },
            "demo_topups_minor": context.demo_topups["amount_minor"],
            "demo_topup_count": context.demo_topups["count"],
            "largest_expense": largest,
            "highest_category": categories[0] if categories else None,
            "categories": categories,
            "daily_trend": daily_trend(context),
            "monthly_trend": monthly_trend(context),
            "weekday_weekend": weekday_weekend(context),
            "top_merchants": top_merchants(context, limit=6),
            "month_over_month": comparison,
            "comparison": preceding,
            "recent_transactions": [entry_from_row(row) for row in context.rows[:8]],
            "recent_insights": insights_payload["insights"][:3],
            "insights_available": len(insights_payload["insights"]),
            "budget_overview": budgets,
            "budget_warnings": budgets["warnings"],
            "excluded_activity": context.excluded,
            "data_quality": context.data_quality,
            "categorization": categorization,
            "calculation_notes": [
                "Spending = successful INR transfers, bills, and recharges owned by you in the selected period, excluding transfers to your own OnePay handle.",
                "Pending, failed, reversed, and demo wallet top-ups are excluded from spending totals.",
                "Calendar-day averages include days with no spending and use the application timezone.",
                "Monthly comparisons use the same elapsed days for a partial current month.",
                "Category totals are based on local rules plus any corrections you saved.",
            ],
        }

    return cached_payload(user.pk, "summary", params_key, builder)


def _parse_optional_amount(params, name: str) -> int | None:
    raw = (params.get(name) or "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValidationError({name: ["Enter a whole number of paise."]}) from exc
    if value < 0:
        raise ValidationError({name: ["Amount filters cannot be negative."]})
    return value


def list_spending_transactions(user, params) -> dict:
    period = _resolve_period(params)
    category = (params.get("category") or "").strip()
    if category and category not in CATEGORY_SET:
        raise ValidationError({"category": [f"Choose one of: {', '.join(CATEGORY_NAMES)}."]})
    subcategory = (params.get("subcategory") or "").strip()
    search = (params.get("search") or "").strip()
    if len(search) > 100:
        raise ValidationError({"search": ["Use at most 100 characters."]})
    try:
        page = int(params.get("page", "1"))
        page_size = int(params.get("page_size", "20"))
    except (TypeError, ValueError) as exc:
        raise ValidationError({"page": ["Page and page_size must be whole numbers."]}) from exc
    if page < 1:
        raise ValidationError({"page": ["Page must be at least 1."]})
    if not 1 <= page_size <= 50:
        raise ValidationError({"page_size": ["Choose a page size between 1 and 50."]})
    min_amount = _parse_optional_amount(params, "min_amount_minor")
    max_amount = _parse_optional_amount(params, "max_amount_minor")
    if min_amount is not None and max_amount is not None and min_amount > max_amount:
        raise ValidationError({"amount": ["The minimum cannot exceed the maximum."]})
    sort_key = (params.get("sort") or "newest").strip()
    if sort_key not in {"newest", "oldest", "amount_desc", "amount_asc"}:
        raise ValidationError({"sort": ["Choose newest, oldest, amount_desc, or amount_asc."]})

    rows, _ = build_rows(user, period)
    search_case = search.casefold()
    filtered = []
    for row in rows:
        if category and row.category != category:
            continue
        if subcategory and row.subcategory != subcategory:
            continue
        if min_amount is not None and row.amount_minor < min_amount:
            continue
        if max_amount is not None and row.amount_minor > max_amount:
            continue
        if search_case:
            haystack = " ".join(
                (row.merchant_label, row.note, row.reference, row.subcategory, row.category)
            ).casefold()
            if search_case not in haystack:
                continue
        filtered.append(row)

    if sort_key == "oldest":
        filtered.sort(key=lambda row: (row.created_at, row.reference))
    elif sort_key == "amount_desc":
        filtered.sort(key=lambda row: (-row.amount_minor, row.reference))
    elif sort_key == "amount_asc":
        filtered.sort(key=lambda row: (row.amount_minor, row.reference))
    else:
        filtered.sort(key=lambda row: (row.created_at, row.reference), reverse=True)

    count = len(filtered)
    start_index, end_index = (page - 1) * page_size, page * page_size
    page_rows = filtered[start_index:end_index]
    return {
        "period": period.as_dict(),
        "filters": {
            "category": category,
            "subcategory": subcategory,
            "search": search,
            "min_amount_minor": min_amount,
            "max_amount_minor": max_amount,
            "sort": sort_key,
        },
        "count": count,
        "filtered_total_minor": sum(row.amount_minor for row in filtered),
        "page": page,
        "page_size": page_size,
        "total_pages": (count + page_size - 1) // page_size,
        "has_next": end_index < count,
        "has_previous": page > 1 and count > 0,
        "results": [entry_from_row(row) for row in page_rows],
    }


def build_category_analytics(user, params) -> dict:
    period = _resolve_period(params)
    context = build_context(user, period)
    categories = category_breakdown(context)
    return {
        "period": period.as_dict(),
        "total_spending_minor": context.total_spending_minor,
        "consumption_spending_minor": context.consumption_spending_minor,
        "categories": categories,
        "subcategory_catalogue": CATEGORY_SUBCATEGORIES,
        "data_quality": context.data_quality,
        "notes": [
            "Percentages use total completed outflow, including person-to-person transfers.",
            "Transfers, income, and refunds are shown for transparency but excluded from consumption budgets.",
        ],
    }


def build_trends(user, params) -> dict:
    period = _resolve_period(params)
    context = build_context(user, period)
    granularity = (params.get("granularity") or "both").strip()
    if granularity not in {"daily", "monthly", "both"}:
        raise ValidationError({"granularity": ["Choose daily, monthly, or both."]})
    payload = {
        "period": period.as_dict(),
        "total_spending_minor": context.total_spending_minor,
        "weekday_weekend": weekday_weekend(context),
        "comparison": preceding_period_comparison(user, period, context.total_spending_minor),
        "month_over_month": month_comparison(user, period, context.rows),
        "data_quality": context.data_quality,
    }
    if granularity in {"daily", "both"}:
        payload["daily"] = daily_trend(context)
    if granularity in {"monthly", "both"}:
        payload["monthly"] = monthly_trend(context)
    return payload


def build_merchant_analytics(user, params) -> dict:
    period = _resolve_period(params)
    context = build_context(user, period)
    merchants = top_merchants(context, limit=20)
    repeated = [merchant for merchant in merchants if merchant["transaction_count"] >= 2]
    return {
        "period": period.as_dict(),
        "total_spending_minor": context.total_spending_minor,
        "merchants": merchants,
        "repeated_merchants": repeated,
        "data_quality": context.data_quality,
        "notes": [
            "Merchants are grouped by saved recipient identifier or normalized recipient name.",
            "A person-to-person recipient is shown as a merchant label but may be an individual.",
        ],
    }


def build_meta(user) -> dict:
    return {
        "categories": [
            {
                "name": category,
                "subcategories": list(CATEGORY_SUBCATEGORIES[category]),
                "budgetable": category not in NON_CONSUMPTION_CATEGORIES,
            }
            for category in CATEGORY_NAMES
        ],
        "periods": [
            {"key": key, "label": PERIOD_LABELS[key]} for key in PERIOD_CHOICES
        ],
        "categorization": _external_status(user),
        "rules": [
            "1. User's saved manual correction",
            "2. Merchant-name and description rules (local)",
            "3. Transaction metadata and payment kind",
            "4. Optional configured local classifier hook",
            "5. Optional LLM fallback, only when configured and consented",
        ],
        "privacy": (
            "Rule-based categorization happens locally. No merchant text, amount, note, or identifier is sent to an "
            "external AI service unless a deployment configures the optional endpoint and you explicitly opt in."
        ),
        "money_received": {
            "income_tracking_available": False,
            "reason": "The demo ledger records outgoing payments and wallet top-ups, not verified incoming funds.",
        },
    }


def _owned_transaction(user, reference: str):
    transaction = (
        PaymentTransaction.objects.select_related("recipient")
        .filter(sender=user, reference=reference)
        .first()
    )
    if transaction is None:
        raise NotFound("Transaction not found.")
    return transaction


def _correction_maps(user):
    corrections = TransactionCategoryCorrection.objects.filter(user=user)
    by_transaction = {correction.transaction_id: correction for correction in corrections if correction.transaction_id}
    by_merchant = {}
    for correction in corrections.filter(apply_to_future=True).order_by("updated_at", "pk"):
        by_merchant[correction.merchant_key] = correction
    return by_transaction, by_merchant


def transaction_category(user, reference: str) -> dict:
    transaction = _owned_transaction(user, reference)
    by_transaction, by_merchant = _correction_maps(user)
    classification = classify_transaction(
        transaction,
        user.pk,
        corrections=by_merchant,
        transaction_corrections=by_transaction,
        allow_external_fallback=external_ai_status(user.pk)["enabled_for_user"],
    )
    correction = by_transaction.get(transaction.pk)
    return {
        "reference": transaction.reference,
        "status": transaction.status,
        "kind": transaction.kind,
        "amount_minor": transaction.amount_minor,
        "created_at": transaction.created_at,
        "merchant": merchant_label_for(transaction),
        "merchant_key": merchant_key_for(transaction),
        "category": classification.category,
        "subcategory": classification.subcategory,
        "classification_method": classification.method,
        "confidence": classification.confidence,
        "is_internal_transfer": classification.is_internal_transfer,
        "is_consumption": classification.is_consumption,
        "eligible_for_spending": (
            transaction.status == PaymentTransaction.Status.SUCCESSFUL
            and transaction.kind in SPENDING_KINDS
            and not classification.is_internal_transfer
        ),
        "correction": {
            "id": correction.pk,
            "category": correction.category,
            "subcategory": correction.subcategory,
            "apply_to_future": correction.apply_to_future,
            "updated_at": correction.updated_at,
        }
        if correction
        else None,
        "available_categories": [
            {
                "name": category,
                "subcategories": list(CATEGORY_SUBCATEGORIES[category]),
                "budgetable": category not in NON_CONSUMPTION_CATEGORIES,
            }
            for category in CATEGORY_NAMES
        ],
    }


def save_transaction_category(user, reference: str, payload: dict) -> dict:
    transaction = _owned_transaction(user, reference)
    category = (payload.get("category") or "").strip()
    if category not in CATEGORY_SET:
        raise ValidationError({"category": [f"Choose one of: {', '.join(CATEGORY_NAMES)}."]})
    subcategory = sanitize_subcategory(payload.get("subcategory"), category)
    apply_to_future = bool(payload.get("apply_to_future", True))
    correction, _ = TransactionCategoryCorrection.objects.update_or_create(
        user=user,
        transaction=transaction,
        defaults={
            "merchant_key": merchant_key_for(transaction),
            "merchant_label": merchant_label_for(transaction),
            "category": category,
            "subcategory": subcategory,
            "apply_to_future": apply_to_future,
        },
    )
    return {
        "correction": {
            "id": correction.pk,
            "category": correction.category,
            "subcategory": correction.subcategory,
            "apply_to_future": correction.apply_to_future,
            "merchant_key": correction.merchant_key,
            "updated_at": correction.updated_at,
        },
        "transaction": transaction_category(user, reference),
        "note": (
            "Your correction applies to this transaction immediately"
            + (" and to future payments with the same merchant key." if apply_to_future else " only.")
        ),
    }


def delete_transaction_category(user, reference: str) -> None:
    transaction = _owned_transaction(user, reference)
    deleted, _ = TransactionCategoryCorrection.objects.filter(user=user, transaction=transaction).delete()
    if not deleted:
        raise NotFound("No saved category correction exists for this transaction.")


def list_corrections(user) -> dict:
    corrections = TransactionCategoryCorrection.objects.filter(user=user).select_related("transaction")
    return {
        "count": corrections.count(),
        "results": [
            {
                "id": correction.pk,
                "reference": correction.transaction.reference if correction.transaction else None,
                "merchant_key": correction.merchant_key,
                "merchant_label": correction.merchant_label,
                "category": correction.category,
                "subcategory": correction.subcategory,
                "apply_to_future": correction.apply_to_future,
                "updated_at": correction.updated_at,
            }
            for correction in corrections
        ],
    }


def get_preferences(user) -> dict:
    preference, _ = AnalyticsPreference.objects.get_or_create(user=user)
    return {
        "external_ai_consent": preference.external_ai_consent,
        "consent_updated_at": preference.consent_updated_at,
        "status": external_ai_status(user.pk),
        "privacy_note": (
            "Local rule-based categorization is always used first. Optional external AI is disabled unless the "
            "deployment configures it and you opt in here. Withdrawing consent takes effect immediately."
        ),
    }


def update_preferences(user, payload: dict) -> dict:
    if "external_ai_consent" not in payload:
        raise ValidationError({"external_ai_consent": ["Provide true or false."]})
    consent = payload.get("external_ai_consent")
    if not isinstance(consent, bool):
        raise ValidationError({"external_ai_consent": ["Provide true or false."]})
    preference, _ = AnalyticsPreference.objects.get_or_create(user=user)
    preference.external_ai_consent = consent
    preference.consent_updated_at = timezone.now() if consent else None
    preference.save()
    return get_preferences(user)


def budget_month_from_period(period: Period):
    return period.end_inclusive.replace(day=1)
