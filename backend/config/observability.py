import json
import logging
import re
import uuid
from datetime import datetime, timezone

from django.core.exceptions import PermissionDenied, SuspiciousOperation
from django.http import Http404, JsonResponse


logger = logging.getLogger("onepay")
SAFE_LOG_FIELDS = (
    "event",
    "request_id",
    "method",
    "route",
    "status_code",
    "error_type",
    "actor_id",
    "action",
    "event_type",
)
SAFE_LOG_PATTERNS = {
    "event": re.compile(r"^[a-z][a-z0-9_.-]{0,79}$"),
    "request_id": re.compile(r"^[a-f0-9]{32}$"),
    "method": re.compile(r"^[A-Z]{1,12}$"),
    "route": re.compile(r"^[A-Za-z0-9_./<>:-]{1,160}$"),
    "error_type": re.compile(r"^[A-Za-z0-9_]{1,80}$"),
    "action": re.compile(r"^[a-z][a-z0-9_.-]{0,47}$"),
    "event_type": re.compile(r"^[a-z][a-z0-9_.-]{0,47}$"),
}


class JsonLogFormatter(logging.Formatter):
    """Emit an allow-listed JSON record; never serialize arbitrary messages or tracebacks."""

    def format(self, record):
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "event": "application.log",
        }
        for field in SAFE_LOG_FIELDS:
            value = getattr(record, field, None)
            if value is None:
                continue
            if field in {"status_code", "actor_id"}:
                if isinstance(value, int) and not isinstance(value, bool):
                    payload[field] = value
                continue
            pattern = SAFE_LOG_PATTERNS.get(field)
            if isinstance(value, str) and pattern is not None and pattern.fullmatch(value):
                payload[field] = value
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _safe_route(request):
    match = getattr(request, "resolver_match", None)
    route = getattr(match, "route", None)
    return route if isinstance(route, str) and len(route) <= 160 else "unresolved"


def _actor_id(request):
    user = getattr(request, "user", None)
    if user is not None and getattr(user, "is_authenticated", False):
        return getattr(user, "pk", None)
    return None


def _record_operational_error(request, *, status_code, error_type):
    """Store only coarse, non-user-supplied diagnostic metadata for the admin dashboard."""
    try:
        from apps.payments.models import AuditEvent

        AuditEvent.objects.create(
            actor_id=_actor_id(request),
            action="system.api_error",
            metadata={
                "request_id": request.request_id,
                "method": request.method[:12],
                "route": _safe_route(request),
                "status_code": int(status_code),
                "error_type": str(error_type)[:80],
            },
        )
    except Exception:
        logger.error(
            "operational_error.audit_write_failed",
            extra={
                "event": "operational_error.audit_write_failed",
                "request_id": getattr(request, "request_id", ""),
                "method": getattr(request, "method", "")[:12],
                "route": _safe_route(request),
                "status_code": int(status_code),
                "error_type": str(error_type)[:80],
            },
        )


def _error_response(request, *, status_code, message):
    return JsonResponse(
        {
            "error": {
                "status": status_code,
                "message": message,
                "details": None,
                "request_id": request.request_id,
            }
        },
        status=status_code,
    )


def _report_api_error(request, *, status_code, error_type):
    logger.error(
        "request.api_server_error",
        extra={
            "event": "request.api_server_error",
            "request_id": request.request_id,
            "method": request.method[:12],
            "route": _safe_route(request),
            "status_code": int(status_code),
            "error_type": str(error_type)[:80],
            "actor_id": _actor_id(request),
        },
    )
    _record_operational_error(request, status_code=status_code, error_type=error_type)


class RequestIdAndErrorMiddleware:
    """Correlate responses and report API failures without logging request contents."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.request_id = uuid.uuid4().hex
        is_api = request.path.startswith("/api/")
        try:
            response = self.get_response(request)
        except Exception as exc:
            if not is_api:
                logger.error(
                    "request.unhandled_exception",
                    extra={
                        "event": "request.unhandled_exception",
                        "request_id": request.request_id,
                        "method": request.method[:12],
                        "route": _safe_route(request),
                        "status_code": 500,
                        "error_type": type(exc).__name__[:80],
                        "actor_id": _actor_id(request),
                    },
                )
                raise
            self._log_unhandled_api_error(request, exc)
            response = _error_response(
                request,
                status_code=500,
                message="An unexpected error occurred. Contact support with the request ID.",
            )
            response._onepay_error_logged = True
        else:
            if is_api and response.status_code >= 500 and not getattr(response, "_onepay_error_logged", False):
                self._log_unhandled_api_error(request, None)
                response = _error_response(
                    request,
                    status_code=500,
                    message="An unexpected error occurred. Contact support with the request ID.",
                )
                response._onepay_error_logged = True
            elif (
                is_api
                and response.status_code in {400, 403, 404}
                and response.get("Content-Type", "").startswith("text/html")
            ):
                message = {400: "Invalid request.", 403: "Permission denied.", 404: "Not found."}[response.status_code]
                response = _error_response(request, status_code=response.status_code, message=message)

        response["X-Request-ID"] = request.request_id
        return response

    def process_exception(self, request, exception):
        """Replace unhandled API exceptions with a safe JSON envelope before Django renders them."""
        if not request.path.startswith("/api/"):
            return None
        if isinstance(exception, Http404):
            response = _error_response(request, status_code=404, message="Not found.")
        elif isinstance(exception, PermissionDenied):
            response = _error_response(request, status_code=403, message="Permission denied.")
        elif isinstance(exception, SuspiciousOperation):
            response = _error_response(request, status_code=400, message="Invalid request.")
        else:
            self._log_unhandled_api_error(request, exception)
            response = _error_response(
                request,
                status_code=500,
                message="An unexpected error occurred. Contact support with the request ID.",
            )
        response._onepay_error_logged = True
        return response

    @staticmethod
    def _log_unhandled_api_error(request, exception):
        error_type = type(exception).__name__ if exception is not None else "http_response"
        _report_api_error(request, status_code=500, error_type=error_type)
