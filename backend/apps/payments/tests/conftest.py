import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def clear_payment_test_throttle_cache():
    """Keep DRF throttles isolated across DB-reset tests that reuse user IDs."""
    cache.clear()
    yield
    cache.clear()
