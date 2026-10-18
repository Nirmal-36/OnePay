import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def clear_notification_test_throttle_cache():
    cache.clear()
    yield
    cache.clear()
