import logging
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.core.mail import send_mail
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.notifications.services import notify_login, notify_password_changed, notify_profile_updated

from .authentication import CsrfSessionAuthentication
from .serializers import (
    LoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    ProfileUpdateSerializer,
    RegistrationSerializer,
    UserSerializer,
)
from .tokens import password_reset_token_generator

User = get_user_model()
logger = logging.getLogger(__name__)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfTokenView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"csrfToken": get_token(request)})


class PublicAuthView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]


@method_decorator(csrf_protect, name="dispatch")
class RegistrationView(PublicAuthView):
    throttle_scope = "auth_register"

    def post(self, request):
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        login(request, user)
        return Response(
            {"user": UserSerializer(user).data, "csrfToken": get_token(request)},
            status=status.HTTP_201_CREATED,
        )


@method_decorator(csrf_protect, name="dispatch")
class LoginView(PublicAuthView):
    authentication_classes = [CsrfSessionAuthentication]
    throttle_scope = "auth_login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(
            request,
            email=serializer.validated_data["email"],
            password=serializer.validated_data["password"],
        )
        if user is None:
            raise AuthenticationFailed("Unable to log in with those credentials.")
        login(request, user)
        notify_login(user)
        return Response({"user": UserSerializer(user).data, "csrfToken": get_token(request)})


@method_decorator(csrf_protect, name="dispatch")
class LogoutView(APIView):
    authentication_classes = [CsrfSessionAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response({"message": "You have been signed out.", "csrfToken": get_token(request)})


class CurrentUserView(APIView):
    authentication_classes = [CsrfSessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"user": UserSerializer(request.user).data})


class ProfileView(APIView):
    authentication_classes = [CsrfSessionAuthentication]
    permission_classes = [IsAuthenticated]

    def patch(self, request):
        serializer = ProfileUpdateSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        changed = any(
            getattr(request.user, field) != value
            for field, value in serializer.validated_data.items()
        )
        serializer.save()
        if changed:
            notify_profile_updated(request.user)
        return Response({"user": UserSerializer(request.user).data})


@method_decorator(csrf_protect, name="dispatch")
class PasswordResetRequestView(PublicAuthView):
    throttle_scope = "auth_password_reset"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        users = User.objects.filter(email__iexact=email, is_active=True)
        for user in users:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = password_reset_token_generator.make_token(user)
            query = urlencode({"uid": uid, "token": token})
            reset_url = f"{settings.FRONTEND_BASE_URL}/reset-password/confirm?{query}"
            sent = send_mail(
                subject="Reset your OnePay password",
                message=(
                    f"Hello {user.full_name},\n\n"
                    "We received a request to reset your OnePay account password. "
                    "Use the link below within one hour. If you did not request this, ignore this email.\n\n"
                    f"{reset_url}\n\n"
                    "OnePay support will never ask for a banking PIN, OTP, or banking password."
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=True,
            )
            if sent != 1:
                logger.warning("Password reset email delivery failed for user_id=%s", user.pk)
        # Intentionally identical for known and unknown emails to prevent account enumeration.
        return Response({"message": "If an account exists for that email, password-reset instructions have been sent."})


@method_decorator(csrf_protect, name="dispatch")
class PasswordResetConfirmView(PublicAuthView):
    throttle_scope = "auth_password_reset_confirm"

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=["password"])
        notify_password_changed(user)
        return Response({"message": "Password updated. You can now sign in with your new password."})
