import logging

from django.db import DatabaseError, connection
from django.http import JsonResponse
from django.views.decorators.http import require_GET

logger = logging.getLogger("onepay")


@require_GET
def live_check(request):
    """Process liveness only; deliberately discloses no deployment details."""
    return JsonResponse({"status": "ok"})


@require_GET
def ready_check(request):
    """Readiness requires a reachable database and returns no connection details."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except DatabaseError as exc:
        request_id = getattr(request, "request_id", None)
        logger.error(
            "health.database_unavailable",
            extra={
                "event": "health.database_unavailable",
                "request_id": request_id,
                "method": request.method[:12],
                "route": getattr(getattr(request, "resolver_match", None), "route", "unresolved"),
                "status_code": 503,
                "error_type": type(exc).__name__[:80],
            },
        )
        return JsonResponse({"status": "unavailable"}, status=503)
    return JsonResponse({"status": "ok"})
