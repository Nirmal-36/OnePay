import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def clear_analytics_cache():
    """Derived analytics are cached; isolate every test from previous payloads."""
    cache.clear()
    yield
    cache.clear()
