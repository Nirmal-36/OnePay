from django.urls import path


def intentionally_failing_api_view(request):
    raise RuntimeError("sensitive failure diagnostic must not be returned")


urlpatterns = [
    path("api/v1/test-failure/", intentionally_failing_api_view),
]
