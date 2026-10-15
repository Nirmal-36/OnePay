from rest_framework.authentication import SessionAuthentication


class CsrfSessionAuthentication(SessionAuthentication):
    """Django session auth with explicit 401 responses for unauthenticated API calls."""

    def authenticate_header(self, request):
        return "Session"
