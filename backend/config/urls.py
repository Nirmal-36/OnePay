from django.contrib import admin
from django.urls import include, path
from rest_framework.permissions import AllowAny
from rest_framework.renderers import JSONOpenAPIRenderer
from rest_framework.schemas import get_schema_view
from rest_framework.schemas.openapi import SchemaGenerator as OpenAPISchemaGenerator

from .admin_dashboard import audit_log_review, operations_dashboard
from .health import live_check, ready_check

api_schema = get_schema_view(
    generator_class=OpenAPISchemaGenerator,
    title="OnePay API",
    description=(
        "Session-authenticated OnePay API for simulated payments. Unsafe requests require CSRF; "
        "payment mutations accept Idempotency-Key. This demo does not connect to a bank or move real money."
    ),
    version="1.0.0",
    renderer_classes=[JSONOpenAPIRenderer],
    public=True,
    permission_classes=[AllowAny],
)

urlpatterns = [
    path("admin/dashboard/", admin.site.admin_view(operations_dashboard), name="ops-dashboard"),
    path("admin/audit/", admin.site.admin_view(audit_log_review), name="audit-log-review"),
    path("admin/", admin.site.urls),
    path("health/live/", live_check, name="health-live"),
    path("health/ready/", ready_check, name="health-ready"),
    path("api/schema/", api_schema, name="api-schema"),
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/payments/", include("apps.payments.urls")),
    path("api/v1/notifications/", include("apps.notifications.urls")),
]
