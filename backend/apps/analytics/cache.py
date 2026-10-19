"""Conservative caching for derived analytics.

Cached payloads are scoped to one user and include a revision derived from the
user's transaction, correction, budget, goal, and consent timestamps. A change
to any of those records therefore produces a new cache key immediately, rather
than relying on time-based invalidation alone. A short TTL also covers code or
rule changes.
"""

from __future__ import annotations

import hashlib
import json

from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, Max

CACHE_PREFIX = "onepay:analytics:v1"


def analytics_revision(user_id: int) -> str:
    from apps.payments.models import PaymentTransaction

    from .models import AnalyticsPreference, SavingsGoal, SpendingBudget, TransactionCategoryCorrection

    def aggregate(model, field: str) -> tuple[int, object]:
        result = model.objects.filter(user_id=user_id).aggregate(count=Count("pk"), latest=Max(field))
        return int(result["count"] or 0), result["latest"]

    # PaymentTransaction is scoped by ``sender`` rather than ``user``.
    transaction_stats = PaymentTransaction.objects.filter(sender_id=user_id).aggregate(
        count=Count("pk"), latest=Max("updated_at")
    )
    parts = [
        ("transactions", int(transaction_stats["count"] or 0), str(transaction_stats["latest"] or "")),
        ("corrections", *aggregate(TransactionCategoryCorrection, "updated_at")),
        ("budgets", *aggregate(SpendingBudget, "updated_at")),
        ("goals", *aggregate(SavingsGoal, "updated_at")),
        ("preference", *aggregate(AnalyticsPreference, "updated_at")),
    ]
    canonical = json.dumps(parts, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:20]


def cached_payload(user_id: int, name: str, params: dict, builder):
    ttl = int(getattr(settings, "ANALYTICS_CACHE_SECONDS", 60))
    if ttl <= 0:
        return builder()
    canonical = json.dumps(params, sort_keys=True, separators=(",", ":"), default=str)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]
    key = f"{CACHE_PREFIX}:{user_id}:{name}:{digest}:{analytics_revision(user_id)}"
    payload = cache.get(key)
    if payload is None:
        payload = builder()
        cache.set(key, payload, ttl)
    return payload
