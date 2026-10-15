from django.http import JsonResponse
from rest_framework.views import exception_handler


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return None

    original = response.data
    if isinstance(original, dict) and "detail" in original:
        message = str(original["detail"])
        details = None
    else:
        message = "Please review the submitted information."
        details = original

    response.data = {
        "error": {
            "status": response.status_code,
            "message": message,
            "details": details,
        }
    }
    return response


def csrf_failure(request, reason=""):
    return JsonResponse(
        {"error": {"status": 403, "message": "CSRF validation failed. Refresh the page and try again.", "details": None}},
        status=403,
    )
