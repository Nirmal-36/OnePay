import re
from urllib.parse import urlsplit


SAFE_FIXED_TARGETS = frozenset(
    {
        "/",
        "/send",
        "/scan",
        "/transactions",
        "/bills",
        "/recipients",
        "/profile",
        "/notifications",
        "/help",
    }
)
TRANSACTION_TARGET_RE = re.compile(r"^/transactions/(OPW-[A-F0-9]{32})(?:/receipt)?$")


def is_safe_navigation_target(value):
    """Allow only routes implemented by OnePay; never accept an arbitrary URL."""
    if value in (None, ""):
        return True
    if not isinstance(value, str) or len(value) > 255 or value != value.strip():
        return False
    if "\\" in value or "%" in value or any(ord(character) < 33 or ord(character) == 127 for character in value):
        return False
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment or parsed.path != value:
        return False
    if not value.startswith("/") or value.startswith("//"):
        return False
    return value in SAFE_FIXED_TARGETS or TRANSACTION_TARGET_RE.fullmatch(value) is not None


def is_transaction_navigation_target(value):
    return isinstance(value, str) and TRANSACTION_TARGET_RE.fullmatch(value) is not None
