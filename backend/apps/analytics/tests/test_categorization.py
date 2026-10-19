from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.test import override_settings

from apps.analytics.categories import (
    CATEGORY_NAMES,
    classify_transaction,
    merchant_key_for,
    sanitize_subcategory,
)
from apps.analytics.classifiers import _configured_classifier, sanitize_merchant_label
from apps.analytics.models import AnalyticsPreference

from .helpers import make_transaction, make_user


@pytest.fixture(autouse=True)
def reset_classifier_hook():
    _configured_classifier.cache_clear()
    yield
    _configured_classifier.cache_clear()


def _fake_classifier(**kwargs):
    return ("Healthcare", "Doctor consultation", 0.81)


@pytest.mark.django_db
def test_rules_cover_merchants_and_subcategories():
    user = make_user()
    cases = [
        ("Swiggy order", "Swiggy", "Food and Dining", "Food delivery"),
        ("Netflix subscription", "Netflix", "Subscriptions", "Digital subscription"),
        ("Uber ride", "Uber", "Transport and Fuel", "Ride hailing"),
        ("BigBasket groceries", "BigBasket", "Groceries", "Supermarket"),
        ("Amazon shopping", "Amazon", "Shopping", "Online marketplace"),
        ("Apollo Pharmacy medicine", "Apollo Pharmacy", "Healthcare", "Pharmacy"),
        ("IndiGo flight", "IndiGo", "Travel", "Flights"),
        ("House rent", "Landlord", "Housing", "Rent"),
    ]
    for note, recipient, category, subcategory in cases:
        transaction = make_transaction(
            user,
            note=note,
            recipient_name=recipient,
            recipient_identifier=f"{recipient.lower().replace(' ', '')}@mock",
            amount=20_000,
        )
        result = classify_transaction(transaction, user.pk)
        assert result.category == category, (note, result)
        assert result.subcategory == subcategory, (note, result)


@pytest.mark.django_db
def test_metadata_rules_classify_bills_recharges_and_own_transfers():
    user = make_user()
    bill = make_transaction(
        user, kind="bill", service="electricity", note="", recipient_name="OnePay Mock Electricity", amount=30_000
    )
    dth = make_transaction(
        user, kind="recharge", service="dth", note="", recipient_name="OnePay Mock DTH", amount=19_900
    )
    own = make_transaction(
        user,
        amount=100_000,
        recipient_name=user.full_name,
        recipient_identifier=f"user{user.pk}@onepay",
    )

    bill_result = classify_transaction(bill, user.pk)
    dth_result = classify_transaction(dth, user.pk)
    own_result = classify_transaction(own, user.pk)

    assert bill_result.category == "Bills and Utilities"
    assert bill_result.subcategory == "Electricity"
    assert bill_result.is_consumption is True
    assert dth_result.category == "Entertainment"
    assert dth_result.subcategory == "DTH recharge"
    assert own_result.category == "Transfers"
    assert own_result.is_internal_transfer is True
    assert own_result.is_consumption is False


@pytest.mark.django_db
def test_short_keywords_do_not_match_inside_unrelated_words():
    user = make_user()
    transaction = make_transaction(
        user, note="Current account update", recipient_name="Someone", amount=10_000
    )

    result = classify_transaction(transaction, user.pk)

    assert result.category != "Housing"
    assert result.category == "Transfers"


@pytest.mark.django_db
def test_saved_corrections_override_rules_for_transaction_and_future_merchant():
    user = make_user()
    first = make_transaction(
        user, note="Cafe coffee", recipient_name="Local Cafe", recipient_identifier="localcafe@mock", amount=12_500
    )
    second = make_transaction(
        user, note="Cafe coffee", recipient_name="Local Cafe", recipient_identifier="localcafe@mock", amount=9_000
    )
    correction = SimpleNamespace(category="Groceries", subcategory="Other groceries")
    key = merchant_key_for(first)

    overridden = classify_transaction(
        first, user.pk, transaction_corrections={first.pk: correction}
    )
    future = classify_transaction(second, user.pk, corrections={key: correction})

    assert overridden.category == "Groceries"
    assert overridden.method == "manual_override"
    assert overridden.confidence == 1.0
    assert overridden.is_consumption is True
    assert future.category == "Groceries"
    assert future.method == "manual_override"


@pytest.mark.django_db
def test_subcategory_sanitization_and_supported_category_catalogue():
    assert len(CATEGORY_NAMES) == 18
    assert "Mobile Recharge" in CATEGORY_NAMES
    assert sanitize_subcategory("  My   custom   label  ", "Shopping") == "My custom label"
    assert sanitize_subcategory("", "Shopping") == "Online marketplace"


@pytest.mark.django_db
@override_settings(ANALYTICS_CLASSIFIER_PATH="apps.analytics.tests.test_categorization._fake_classifier")
def test_configured_local_classifier_is_used_for_ambiguous_transactions():
    _configured_classifier.cache_clear()
    user = make_user()
    transaction = make_transaction(user, note="", recipient_name="Acme Wellness", amount=35_000)

    result = classify_transaction(transaction, user.pk)

    assert result.category == "Healthcare"
    assert result.subcategory == "Doctor consultation"
    assert result.method == "configured_classifier"
    assert result.confidence == 0.81


@pytest.mark.django_db
def test_external_llm_is_off_by_default_and_requires_consent():
    user = make_user()
    transaction = make_transaction(user, note="", recipient_name="Acme Wellness", amount=35_000)

    with patch("apps.analytics.classifiers.urllib.request.urlopen") as urlopen:
        disabled = classify_transaction(transaction, user.pk)
    assert disabled.method == "metadata_rule"
    urlopen.assert_not_called()

    AnalyticsPreference.objects.create(user=user, external_ai_consent=True)
    with override_settings(
        ANALYTICS_EXTERNAL_LLM_ENABLED=True,
        ANALYTICS_EXTERNAL_LLM_ENDPOINT="https://classifier.example.test/classify",
        ANALYTICS_EXTERNAL_LLM_API_KEY="test-key",
    ), patch("apps.analytics.classifiers.urllib.request.urlopen") as urlopen:
        consent_missing = make_user("no-consent@example.test")
        no_consent_transaction = make_transaction(
            consent_missing, note="", recipient_name="Acme Wellness", amount=35_000
        )
        result = classify_transaction(no_consent_transaction, consent_missing.pk)
    assert result.method == "metadata_rule"
    urlopen.assert_not_called()


class _FakeResponse:
    def __init__(self, payload: bytes):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, *args):
        return self.payload


@pytest.mark.django_db
def test_consented_llm_fallback_sends_only_minimized_merchant_label():
    import json

    user = make_user()
    AnalyticsPreference.objects.create(user=user, external_ai_consent=True)
    transaction = make_transaction(
        user,
        note="Private note 9876543210",
        recipient_name="Acme Wellness 123456",
        recipient_identifier="acme@mock",
        amount=35_000,
    )
    response_payload = json.dumps(
        {"category": "Healthcare", "subcategory": "Doctor consultation", "confidence": 0.55}
    ).encode()

    with override_settings(
        ANALYTICS_EXTERNAL_LLM_ENABLED=True,
        ANALYTICS_EXTERNAL_LLM_ENDPOINT="https://classifier.example.test/classify",
        ANALYTICS_EXTERNAL_LLM_API_KEY="test-key",
    ), patch(
        "apps.analytics.classifiers.urllib.request.urlopen", return_value=_FakeResponse(response_payload)
    ) as urlopen:
        result = classify_transaction(transaction, user.pk)

    assert result.category == "Healthcare"
    assert result.method == "llm_fallback"
    assert result.confidence == 0.55
    request = urlopen.call_args.args[0]
    sent = json.loads(request.data.decode())
    assert sent["merchant_label"] == "Acme Wellness ****"
    assert "Private note" not in request.data.decode()
    assert "amount" not in sent
    assert "reference" not in sent
    assert "user" not in {key.lower() for key in sent}
    assert sent["payment_kind"] == "transfer"


def test_sanitize_merchant_label_masks_digits_and_email_addresses():
    assert sanitize_merchant_label("Acme 12345678") == "Acme ****"
    assert sanitize_merchant_label("person@example.test") == "merchant"
