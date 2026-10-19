"""Optional classification hooks for the analytics categorizer.

Both hooks are disabled by default. The default OnePay experience is entirely
local and rule-based. Deployments that need stronger classification can point
``ANALYTICS_CLASSIFIER_PATH`` at a local Python callable, and can optionally
configure an LLM endpoint. The LLM hook additionally requires a recorded
per-user consent and sends only a short, sanitized merchant label.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from functools import lru_cache
from typing import Callable

from django.conf import settings
from django.utils.module_loading import import_string

from .categories import CATEGORY_NAMES, CATEGORY_SET, sanitize_subcategory

Classifier = Callable[..., object]

_MAX_LABEL = 80
_DIGIT_RUN = re.compile(r"\d{4,}")
_EMAIL = re.compile(r"[^@\s]+@[^@\s]+")


@lru_cache(maxsize=1)
def _configured_classifier() -> Classifier | None:
    path = (getattr(settings, "ANALYTICS_CLASSIFIER_PATH", "") or "").strip()
    if not path:
        return None
    try:
        candidate = import_string(path)
    except (ImportError, AttributeError):
        return None
    return candidate if callable(candidate) else None


def external_ai_configured() -> bool:
    return bool(
        getattr(settings, "ANALYTICS_EXTERNAL_LLM_ENABLED", False)
        and (getattr(settings, "ANALYTICS_EXTERNAL_LLM_ENDPOINT", "") or "").strip()
    )


def user_has_external_ai_consent(user_id: int) -> bool:
    from .models import AnalyticsPreference

    return AnalyticsPreference.objects.filter(
        user_id=user_id, external_ai_consent=True
    ).exists()


def external_ai_status(user_id: int) -> dict:
    return {
        "configured": external_ai_configured(),
        "consent": user_has_external_ai_consent(user_id),
        "enabled_for_user": external_ai_configured() and user_has_external_ai_consent(user_id),
        "provider": "configured_llm_endpoint" if external_ai_configured() else None,
        "data_sent": "Short merchant label, payment kind, and service only; no amounts, notes, references, account identifiers, or user identity.",
    }


def sanitize_merchant_label(value: str) -> str:
    """Minimize identifying data before any optional external request."""
    label = (value or "").strip()
    label = _EMAIL.sub("merchant", label)
    label = _DIGIT_RUN.sub("****", label)
    return label[:_MAX_LABEL]


def classify_with_configured_service(
    *, merchant_label: str, note: str, kind: str, service: str
) -> tuple[str, str, float] | None:
    """Call a locally configured classifier hook when one is configured.

    The hook receives sanitized merchant text plus payment metadata. It must
    return ``(category, subcategory, confidence)`` or ``None``. Errors are
    contained so classification always falls back to local rules.
    """
    classifier = _configured_classifier()
    if classifier is None:
        return None
    try:
        result = classifier(
            merchant_label=sanitize_merchant_label(merchant_label),
            note="",
            kind=kind,
            service=service,
            categories=CATEGORY_NAMES,
        )
    except Exception:  # pragma: no cover - depends on deployment hook
        return None
    return _validate_result(result)


def _validate_result(result: object) -> tuple[str, str, float] | None:
    if result is None:
        return None
    if isinstance(result, dict):
        category = result.get("category")
        subcategory = result.get("subcategory", "")
        confidence = result.get("confidence", 0.6)
    elif isinstance(result, (tuple, list)) and len(result) >= 2:
        category, subcategory = result[0], result[1]
        confidence = result[2] if len(result) > 2 else 0.6
    else:
        return None
    if category not in CATEGORY_SET:
        return None
    try:
        confidence_value = float(confidence)
    except (TypeError, ValueError):
        confidence_value = 0.6
    confidence_value = max(0.0, min(1.0, confidence_value))
    return category, sanitize_subcategory(str(subcategory or ""), category), confidence_value


def classify_with_llm(
    *, user_id: int, merchant_label: str, kind: str, service: str
) -> tuple[str, str, float] | None:
    """Optional LLM fallback. Off by default; requires consent and configuration.

    Only a sanitized merchant label, payment kind, and service are sent. The
    response is validated against the fixed category catalogue before use.
    """
    if not external_ai_configured() or not user_has_external_ai_consent(user_id):
        return None

    endpoint = (getattr(settings, "ANALYTICS_EXTERNAL_LLM_ENDPOINT", "") or "").strip()
    if not endpoint.startswith(("https://", "http://")):
        return None
    api_key = (getattr(settings, "ANALYTICS_EXTERNAL_LLM_API_KEY", "") or "").strip()
    timeout = float(getattr(settings, "ANALYTICS_EXTERNAL_LLM_TIMEOUT", 4))
    payload = {
        "task": "classify_onepay_transaction",
        "merchant_label": sanitize_merchant_label(merchant_label),
        "payment_kind": kind,
        "service": service,
        "allowed_categories": list(CATEGORY_NAMES),
        "response_format": {"category": "one allowed category", "subcategory": "short label", "confidence": "0 to 1"},
    }
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            **({"Authorization": f"Bearer {api_key}"} if api_key else {}),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - explicit config
            raw = response.read(64 * 1024)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return None
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if isinstance(decoded, dict) and isinstance(decoded.get("result"), dict):
        decoded = decoded["result"]
    return _validate_result(decoded)
