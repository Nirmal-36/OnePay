"""Local, deterministic spending categorization for OnePay's simulated ledger."""

from dataclasses import dataclass


@dataclass(frozen=True)
class CategoryResult:
    category: str
    subcategory: str
    method: str
    confidence: float
    is_internal_transfer: bool = False


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

# Rules only inspect data already held by OnePay. This module never calls a provider.
_MERCHANT_RULES = (
    ("Subscriptions", "Digital subscription", ("subscription", "netflix", "spotify", "prime video", "disney+", "hotstar")),
    ("Food and Dining", "Food or dining", ("swiggy", "zomato", "restaurant", "cafe", "coffee", "food", "dining", "pizza", "burger", "bakery")),
    ("Groceries", "Groceries", ("grocery", "groceries", "supermarket", "vegetable", "fruit", "dmart", "bigbasket", "blinkit", "zepto", "instamart")),
    ("Transport and Fuel", "Transport or fuel", ("uber", "ola", "rapido", "metro", "transport", "fuel", "petrol", "diesel", "parking", "cab", "irctc", "redbus")),
    ("Shopping", "Retail purchase", ("amazon", "flipkart", "myntra", "shopping", "retail", "marketplace")),
    ("Bills and Utilities", "Utility bill", ("electricity", "water bill", "gas bill", "broadband", "utility", "utilities", "discom", "maintenance")),
    ("Mobile Recharge", "Mobile recharge", ("mobile recharge", "prepaid", "postpaid", "airtel", "jio", "bsnl", "vodafone", "idea")),
    ("Entertainment", "Entertainment", ("cinema", "movie", "bookmyshow", "gaming", "game pass", "dth")),
    ("Healthcare", "Health or pharmacy", ("hospital", "clinic", "pharmacy", "medical", "medicine", "doctor", "healthcare", "diagnostic")),
    ("Education", "Education", ("school", "college", "university", "course", "tuition", "education", "textbook")),
    ("Travel", "Travel or stay", ("hotel", "flight", "airline", "booking.com", "makemytrip", "travel", "airbnb")),
    ("Personal Care", "Personal care", ("salon", "spa", "barber", "beauty", "cosmetic")),
    ("Housing", "Housing", ("rent", "landlord", "housing", "apartment")),
    ("Financial Services", "Financial service", ("insurance", "loan payment", "bank charge", "finance fee", "credit card fee")),
)


def classify_transaction(transaction, user_id: int) -> CategoryResult:
    """Classify an outgoing transaction with transparent rules and heuristic confidence.

    Confidence is a rule-strength indicator, not a model probability. Incoming funds and
    refunds are not inferred from outgoing customer payment records.
    """
    own_identifier = f"user{user_id}@onepay".casefold()
    recipient_identifier = (transaction.recipient_identifier or "").strip().casefold()
    recipient_upi = ""
    if getattr(transaction, "recipient", None) is not None:
        recipient_upi = (transaction.recipient.upi_id or "").strip().casefold()
    is_internal = transaction.kind == "transfer" and (
        recipient_identifier == own_identifier or recipient_upi == own_identifier
    )
    if is_internal:
        return CategoryResult("Transfers", "Own-account transfer", "metadata_rule", 0.99, True)

    service = (transaction.service or "").strip().casefold()
    if transaction.kind == "bill":
        if service == "mobile":
            return CategoryResult("Mobile Recharge", "Mobile bill", "metadata_rule", 0.94)
        return CategoryResult("Bills and Utilities", service.replace("_", " ").title() or "Bill payment", "metadata_rule", 0.92)
    if transaction.kind == "recharge":
        if service == "dth":
            return CategoryResult("Entertainment", "DTH recharge", "metadata_rule", 0.92)
        return CategoryResult("Mobile Recharge", service.replace("_", " ").title() or "Recharge", "metadata_rule", 0.92)
    if transaction.kind != "transfer":
        return CategoryResult("Other", "Unclassified activity", "metadata_rule", 0.50)

    text = " ".join((
        transaction.note or "",
        transaction.recipient_name or "",
        transaction.recipient_identifier or "",
    )).casefold()
    for category, subcategory, keywords in _MERCHANT_RULES:
        if any(keyword in text for keyword in keywords):
            return CategoryResult(category, subcategory, "merchant_rule", 0.86)

    # Person-to-person payments cannot reliably reveal what was purchased.
    return CategoryResult("Transfers", "Person-to-person transfer", "metadata_rule", 0.72)
