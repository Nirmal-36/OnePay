"""Local, deterministic spending categorization for OnePay's simulated ledger.

The categorizer is layered and explicit:

1. A user's saved correction (manual override).
2. Merchant-name / transaction-description rules.
3. Transaction metadata and payment kind.
4. An optional, locally configured classifier hook.
5. An optional LLM fallback that is disabled by default and requires both
   deployment configuration and the user's recorded consent.

Nothing here contacts an external service unless the final layer is configured
and the user has explicitly opted in. Only a short merchant label is ever sent;
amounts, references, notes, account identifiers, and user identity are excluded.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Mapping

CATEGORY_NAMES = (
    "Food and Dining",
    "Groceries",
    "Transport and Fuel",
    "Shopping",
    "Bills and Utilities",
    "Mobile Recharge",
    "Entertainment",
    "Healthcare",
    "Education",
    "Travel",
    "Personal Care",
    "Housing",
    "Subscriptions",
    "Financial Services",
    "Transfers",
    "Income",
    "Refunds",
    "Other",
)

CATEGORY_SET = frozenset(CATEGORY_NAMES)

# Categories that are not consumption. They are displayed for transparency but
# excluded from consumption-based budgets and savings suggestions.
NON_CONSUMPTION_CATEGORIES = frozenset({"Transfers", "Income", "Refunds"})

CATEGORY_SUBCATEGORIES: dict[str, tuple[str, ...]] = {
    "Food and Dining": ("Food delivery", "Restaurants and cafes", "Fast food", "Bakery", "Other dining"),
    "Groceries": ("Supermarket", "Quick commerce", "Fruit and vegetables", "Other groceries"),
    "Transport and Fuel": ("Ride hailing", "Fuel", "Public transport", "Parking", "Vehicle service", "Other transport"),
    "Shopping": ("Online marketplace", "Clothing and fashion", "Electronics", "Home and furniture", "Other shopping"),
    "Bills and Utilities": ("Electricity", "Water", "Gas", "Broadband", "Rent and maintenance", "Other utility"),
    "Mobile Recharge": ("Mobile bill", "Prepaid recharge", "Postpaid bill", "DTH recharge"),
    "Entertainment": ("Movies and events", "Gaming", "Streaming", "Hobbies", "Other entertainment"),
    "Healthcare": ("Hospital", "Pharmacy", "Doctor consultation", "Diagnostics", "Health insurance", "Other health"),
    "Education": ("School fees", "College fees", "Courses", "Books and supplies", "Other education"),
    "Travel": ("Flights", "Hotels and stays", "Trains and buses", "Holiday packages", "Other travel"),
    "Personal Care": ("Salon and spa", "Cosmetics", "Personal care products", "Other personal care"),
    "Housing": ("Rent", "Home maintenance", "Property charges", "Other housing"),
    "Subscriptions": ("Digital subscription", "Software subscription", "Membership", "Other subscription"),
    "Financial Services": ("Insurance", "Loan payment", "Bank charges", "Investment fees", "Other financial service"),
    "Transfers": ("Person-to-person transfer", "Own-account transfer", "Demo wallet top-up", "Other transfer"),
    "Income": ("Salary", "Business income", "Interest", "Other income"),
    "Refunds": ("Merchant refund", "Payment reversal", "Other refund"),
    "Other": ("Unclassified", "Cash withdrawal", "Other"),
}

DEFAULT_SUBCATEGORY = {category: values[0] for category, values in CATEGORY_SUBCATEGORIES.items()}

# Rules inspect only fields already stored by OnePay. The confidence value is a
# transparent rule-strength indicator, not a calibrated ML probability.
# (category, subcategory, strong_keywords, generic_keywords)
_MERCHANT_RULES: tuple[tuple[str, str, tuple[str, ...], tuple[str, ...]], ...] = (
    (
        "Subscriptions",
        "Digital subscription",
        ("netflix", "spotify", "disney+", "hotstar", "prime video", "youtube premium", "apple music", "sonyliv", "zee5"),
        ("subscription", "recurring plan", "annual plan", "monthly plan"),
    ),
    (
        "Food and Dining",
        "Food delivery",
        ("swiggy", "zomato", "eatsure", "dominos", "domino's", "kfc", "mcdonald", "burger king", "pizza hut"),
        ("food delivery", "food order", "online food"),
    ),
    (
        "Food and Dining",
        "Restaurants and cafes",
        ("starbucks", "third wave coffee", "blue tokai", "cafe coffee day", "ccd", "barbeque nation", "haldiram"),
        ("restaurant", "cafe", "coffee shop", "dining", "biryani", "pizzeria", "eatery"),
    ),
    (
        "Groceries",
        "Quick commerce",
        ("blinkit", "zepto", "instamart", "swiggy instamart", "bigbasket now", "dunzo"),
        ("quick commerce", "10 minute delivery", "grocery delivery"),
    ),
    (
        "Groceries",
        "Supermarket",
        ("dmart", "bigbasket", "reliance fresh", "more supermarket", "spencer", "nature's basket", "licious"),
        ("grocery", "groceries", "supermarket", "kirana", "provision store"),
    ),
    (
        "Groceries",
        "Fruit and vegetables",
        ("vegetable", "sabzi", "fruit seller", "mandi"),
        ("fruits", "vegetables", "farm produce"),
    ),
    (
        "Transport and Fuel",
        "Ride hailing",
        ("uber", "ola cabs", "rapido", "blusmart", "namma yatri", "indrive"),
        ("cab", "auto ride", "bike taxi", "ride fare"),
    ),
    (
        "Transport and Fuel",
        "Fuel",
        ("indian oil", "hpcl", "bpcl", "shell petrol", "nayara", "petrol pump", "fuel station"),
        ("petrol", "diesel", "fuel", "cng"),
    ),
    (
        "Transport and Fuel",
        "Public transport",
        ("irctc", "redbus", "abhibus", "delhi metro", "metro card", "bmrcl"),
        ("metro", "bus ticket", "train ticket", "toll"),
    ),
    (
        "Transport and Fuel",
        "Parking",
        ("parking",),
        ("valet",),
    ),
    (
        "Shopping",
        "Online marketplace",
        ("amazon", "flipkart", "meesho", "snapdeal", "jiomart", "tatacliq"),
        ("marketplace", "online shopping", "e-commerce"),
    ),
    (
        "Shopping",
        "Clothing and fashion",
        ("myntra", "ajio", "nykaa fashion", "westside", "pantaloons", "zara", "h&m", "uniqlo"),
        ("clothing", "fashion", "apparel", "footwear"),
    ),
    (
        "Shopping",
        "Electronics",
        ("croma", "reliance digital", "vijay sales", "apple store"),
        ("electronics", "mobile store", "laptop", "headphones"),
    ),
    (
        "Bills and Utilities",
        "Electricity",
        ("electricity", "discom", "power bill", "tsspdcl", "bescom", "mseb"),
        ("electric bill", "power supply"),
    ),
    (
        "Bills and Utilities",
        "Water",
        ("water bill", "water board", "jal board"),
        ("municipal water",),
    ),
    (
        "Bills and Utilities",
        "Gas",
        ("gas bill", "indane", "hp gas", "bharat gas", "piped gas"),
        ("lpg", "gas connection"),
    ),
    (
        "Bills and Utilities",
        "Broadband",
        ("broadband", "fibernet", "jiofiber", "airtel xstream", "act fibernet", "hathway"),
        ("internet bill", "wifi bill"),
    ),
    (
        "Bills and Utilities",
        "Rent and maintenance",
        ("maintenance charges", "society maintenance", "apartment maintenance"),
        ("maintenance", "property tax"),
    ),
    (
        "Mobile Recharge",
        "Mobile bill",
        ("airtel", "jio", "bsnl", "vodafone", "vi recharge", "mobile bill"),
        ("postpaid", "prepaid", "mobile recharge", "phone bill"),
    ),
    (
        "Entertainment",
        "Movies and events",
        ("bookmyshow", "pvr", "inox", "cinema", "multiplex"),
        ("movie ticket", "concert ticket", "event ticket"),
    ),
    (
        "Entertainment",
        "Gaming",
        ("steam", "playstation", "xbox", "nintendo", "game pass"),
        ("gaming", "in-game purchase"),
    ),
    (
        "Healthcare",
        "Hospital",
        ("apollo hospital", "fortis", "manipal hospital", "kims", "max hospital"),
        ("hospital", "clinic", "emergency care"),
    ),
    (
        "Healthcare",
        "Pharmacy",
        ("apollo pharmacy", "pharmeasy", "netmeds", "1mg", "truemeds"),
        ("pharmacy", "medical store", "medicine", "chemist"),
    ),
    (
        "Healthcare",
        "Diagnostics",
        ("diagnostic", "pathology", "lab test", "thyrocare", "dr lal"),
        ("blood test", "scan centre"),
    ),
    (
        "Education",
        "School fees",
        ("school fee", "school fees", "cbse", "icse"),
        ("tuition", "nursery fee"),
    ),
    (
        "Education",
        "Courses",
        ("udemy", "coursera", "unacademy", "byju", "vedantu", "upgrad", "simplilearn"),
        ("online course", "certification", "coaching"),
    ),
    (
        "Travel",
        "Flights",
        ("indigo", "air india", "spicejet", "akasa", "vistara", "emirates"),
        ("flight", "airline", "air ticket"),
    ),
    (
        "Travel",
        "Hotels and stays",
        ("makemytrip", "goibibo", "cleartrip", "booking.com", "airbnb", "oyo", "taj hotel", "marriott"),
        ("hotel", "resort", "homestay", "guest house"),
    ),
    (
        "Travel",
        "Trains and buses",
        ("irctc", "redbus", "abhibus"),
        ("train booking", "bus booking"),
    ),
    (
        "Personal Care",
        "Salon and spa",
        ("salon", "spa", "barber", "beauty parlour", "lakme salon", "naturals salon"),
        ("haircut", "grooming", "facial"),
    ),
    (
        "Personal Care",
        "Cosmetics",
        ("nykaa", "sephora", "mamaearth", "plum", "sugar cosmetics"),
        ("cosmetics", "skincare", "makeup"),
    ),
    (
        "Housing",
        "Rent",
        ("landlord", "rent payment", "house rent", "nobroker", "rentpay"),
        ("monthly rent", "rent"),
    ),
    (
        "Housing",
        "Home maintenance",
        ("home repair", "plumber", "electrician", "carpenter", "pest control"),
        ("house repair", "home service"),
    ),
    (
        "Financial Services",
        "Insurance",
        ("lic", "insurance premium", "policybazaar", "acko", "digit insurance", "star health"),
        ("insurance", "premium payment"),
    ),
    (
        "Financial Services",
        "Loan payment",
        ("loan emi", "home loan", "car loan", "personal loan", "bajaj finance"),
        ("emi", "loan instalment", "loan installment"),
    ),
    (
        "Financial Services",
        "Bank charges",
        ("bank charge", "annual fee", "credit card fee", "processing fee"),
        ("service charge", "late fee", "penalty"),
    ),
    (
        "Refunds",
        "Merchant refund",
        ("refund", "money back"),
        ("reversal credit", "returned order"),
    ),
    (
        "Income",
        "Salary",
        ("salary", "payroll", "stipend"),
        ("income credit", "employer payment"),
    ),
)

_TOKEN_RE = re.compile(r"[^a-z0-9]+")
_WHITESPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True)
class CategoryResult:
    category: str
    subcategory: str
    method: str
    confidence: float
    is_internal_transfer: bool = False
    is_consumption: bool = True
    merchant_key: str = ""
    merchant_label: str = ""
    matched_keyword: str = ""
    notes: tuple[str, ...] = field(default_factory=tuple)


def sanitize_subcategory(value: str | None, category: str) -> str:
    value = _WHITESPACE_RE.sub(" ", (value or "").strip())[:80]
    if value:
        return value
    return DEFAULT_SUBCATEGORY.get(category, "Other")


def slugify_merchant(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", (value or "")).encode("ascii", "ignore").decode("ascii").lower()
    text = _TOKEN_RE.sub("-", text).strip("-")
    return text[:120]


def merchant_key_for(transaction) -> str:
    """Return a stable, non-secret key used for repeat-merchant matching."""
    identifier = (getattr(transaction, "recipient_identifier", "") or "").strip().lower()
    name = (getattr(transaction, "recipient_name", "") or "").strip()
    kind = getattr(transaction, "kind", "") or ""
    service = (getattr(transaction, "service", "") or "").strip().lower()
    if kind in {"bill", "recharge"}:
        return f"service:{kind}:{service or 'unknown'}"
    if identifier:
        return f"upi:{identifier[:120]}"
    if name:
        return f"merchant:{slugify_merchant(name)}"
    note = (getattr(transaction, "note", "") or "").strip()
    if note:
        return f"note:{slugify_merchant(note)[:80]}"
    reference = getattr(transaction, "reference", "") or str(getattr(transaction, "pk", ""))
    return f"ref:{reference[:80]}"


def merchant_label_for(transaction) -> str:
    name = (getattr(transaction, "recipient_name", "") or "").strip()
    if name:
        return name[:120]
    service = (getattr(transaction, "service", "") or "").strip()
    if service:
        return service.replace("_", " ").title()
    return "Unnamed payment"


def _transaction_text(transaction) -> str:
    return " ".join(
        (
            getattr(transaction, "recipient_name", "") or "",
            getattr(transaction, "service", "") or "",
            getattr(transaction, "note", "") or "",
        )
    ).casefold()


def _all_rules() -> list[tuple[str, str, str, bool]]:
    rules: list[tuple[str, str, str, bool]] = []
    for category, subcategory, strong, generic in _MERCHANT_RULES:
        rules.extend((keyword, category, subcategory, True) for keyword in strong)
        rules.extend((keyword, category, subcategory, False) for keyword in generic)
    return rules


_COMPILED_RULES: tuple[tuple[re.Pattern[str], str, str, bool], ...] = tuple(
    (
        re.compile(rf"(?<![a-z0-9]){re.escape(keyword)}(?![a-z0-9])"),
        category,
        subcategory,
        strong,
    )
    for keyword, category, subcategory, strong in _all_rules()
)


def is_own_account_transfer(transaction, user_id: int) -> bool:
    own_identifier = f"user{user_id}@onepay".casefold()
    recipient_identifier = (getattr(transaction, "recipient_identifier", "") or "").strip().casefold()
    recipient_upi = ""
    recipient = getattr(transaction, "recipient", None)
    if recipient is not None:
        recipient_upi = (getattr(recipient, "upi_id", "") or "").strip().casefold()
    return (getattr(transaction, "kind", "") == "transfer") and (
        recipient_identifier == own_identifier or recipient_upi == own_identifier
    )


def classify_transaction(
    transaction,
    user_id: int,
    *,
    corrections: Mapping[str, Any] | None = None,
    transaction_corrections: Mapping[Any, Any] | None = None,
    allow_external_fallback: bool = True,
) -> CategoryResult:
    """Classify a recorded transaction using the layered strategy described above.

    ``corrections`` maps merchant keys to objects with ``category``/``subcategory``.
    ``transaction_corrections`` maps transaction ids to the same shape.
    """
    merchant_key = merchant_key_for(transaction)
    merchant_label = merchant_label_for(transaction)

    # Layer 0: explicit per-transaction correction (the user's own decision).
    correction = None
    if transaction_corrections:
        correction = transaction_corrections.get(getattr(transaction, "pk", None))
    if correction is not None:
        category = getattr(correction, "category", "Other")
        if category in CATEGORY_SET:
            return CategoryResult(
                category,
                sanitize_subcategory(getattr(correction, "subcategory", ""), category),
                "manual_override",
                1.0,
                is_consumption=category not in NON_CONSUMPTION_CATEGORIES,
                merchant_key=merchant_key,
                merchant_label=merchant_label,
                notes=("manual_correction",),
            )

    # Layer 0b: a user correction can be applied to future matching merchants.
    if corrections and merchant_key in corrections:
        correction = corrections[merchant_key]
        category = getattr(correction, "category", "Other")
        if category in CATEGORY_SET:
            return CategoryResult(
                category,
                sanitize_subcategory(getattr(correction, "subcategory", ""), category),
                "manual_override",
                1.0,
                is_consumption=category not in NON_CONSUMPTION_CATEGORIES,
                merchant_key=merchant_key,
                merchant_label=merchant_label,
                notes=("saved_merchant_correction",),
            )

    # An own-account movement is never consumption, regardless of its label.
    if is_own_account_transfer(transaction, user_id):
        return CategoryResult(
            "Transfers",
            "Own-account transfer",
            "metadata_rule",
            0.99,
            is_internal_transfer=True,
            is_consumption=False,
            merchant_key=merchant_key,
            merchant_label=merchant_label,
        )

    text = _transaction_text(transaction)

    # Layer 1: merchant-name / description rules.
    for pattern, category, subcategory, strong in _COMPILED_RULES:
        if pattern.search(text):
            return CategoryResult(
                category,
                subcategory,
                "merchant_rule",
                0.9 if strong else 0.78,
                is_consumption=category not in NON_CONSUMPTION_CATEGORIES,
                merchant_key=merchant_key,
                merchant_label=merchant_label,
                matched_keyword=pattern.pattern,
            )

    # Layer 2: transaction metadata and payment kind.
    kind = getattr(transaction, "kind", "") or ""
    service = (getattr(transaction, "service", "") or "").strip().lower()
    if kind == "bill":
        if service == "mobile":
            return CategoryResult(
                "Mobile Recharge",
                "Mobile bill",
                "metadata_rule",
                0.94,
                is_consumption=True,
                merchant_key=merchant_key,
                merchant_label=merchant_label,
            )
        subcategory = {
            "electricity": "Electricity",
            "water": "Water",
            "gas": "Gas",
            "broadband": "Broadband",
            "other": "Other utility",
        }.get(service, "Other utility")
        return CategoryResult(
            "Bills and Utilities",
            subcategory,
            "metadata_rule",
            0.92,
            is_consumption=True,
            merchant_key=merchant_key,
            merchant_label=merchant_label,
        )
    if kind == "recharge":
        return CategoryResult(
            "Entertainment" if service == "dth" else "Mobile Recharge",
            "DTH recharge" if service == "dth" else "Prepaid recharge",
            "metadata_rule",
            0.92,
            is_consumption=True,
            merchant_key=merchant_key,
            merchant_label=merchant_label,
        )
    if kind == "topup":
        return CategoryResult(
            "Transfers",
            "Demo wallet top-up",
            "metadata_rule",
            0.99,
            is_consumption=False,
            merchant_key=merchant_key,
            merchant_label=merchant_label,
        )

    # Layers 3 and 4: optional classifiers, only for ambiguous descriptions.
    if allow_external_fallback:
        from .classifiers import classify_with_configured_service, classify_with_llm

        configured = classify_with_configured_service(
            merchant_label=merchant_label,
            note="",
            kind=kind,
            service=service,
        )
        if configured is not None:
            category, subcategory, confidence = configured
            return CategoryResult(
                category,
                sanitize_subcategory(subcategory, category),
                "configured_classifier",
                confidence,
                is_consumption=category not in NON_CONSUMPTION_CATEGORIES,
                merchant_key=merchant_key,
                merchant_label=merchant_label,
            )

        llm_result = classify_with_llm(
            user_id=user_id,
            merchant_label=merchant_label,
            kind=kind,
            service=service,
        )
        if llm_result is not None:
            category, subcategory, confidence = llm_result
            return CategoryResult(
                category,
                sanitize_subcategory(subcategory, category),
                "llm_fallback",
                min(confidence, 0.6),
                is_consumption=category not in NON_CONSUMPTION_CATEGORIES,
                merchant_key=merchant_key,
                merchant_label=merchant_label,
                notes=("external_ai_consented", "data_minimized"),
            )

    # A person-to-person payment cannot reliably reveal what was purchased.
    if kind == "transfer":
        return CategoryResult(
            "Transfers",
            "Person-to-person transfer",
            "metadata_rule",
            0.6,
            is_consumption=False,
            merchant_key=merchant_key,
            merchant_label=merchant_label,
            notes=("ambiguous_p2p",),
        )

    return CategoryResult(
        "Other",
        "Unclassified",
        "fallback",
        0.35,
        is_consumption=False,
        merchant_key=merchant_key,
        merchant_label=merchant_label,
        notes=("insufficient_description",),
    )


def normalize_category(value: str | None) -> str:
    candidate = (value or "").strip()
    if candidate not in CATEGORY_SET:
        raise ValueError("Unknown spending category.")
    return candidate
