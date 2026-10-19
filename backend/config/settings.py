import os
import secrets
from pathlib import Path
from urllib.parse import urlsplit

from corsheaders.defaults import default_headers

import dj_database_url
from dotenv import load_dotenv
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env", override=False)


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [value.strip() for value in os.environ.get(name, default).split(",") if value.strip()]


DEBUG = env_bool("DJANGO_DEBUG", True)
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "").strip()
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is false.")
    # Local-only ephemeral key; set DJANGO_SECRET_KEY in backend/.env for stable dev sessions.
    SECRET_KEY = secrets.token_urlsafe(50)

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "apps.accounts.apps.AccountsConfig",
    "apps.payments.apps.PaymentsConfig",
    "apps.notifications.apps.NotificationsConfig",
    "apps.analytics.apps.AnalyticsConfig",
]

MIDDLEWARE = [
    "config.observability.RequestIdAndErrorMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{BASE_DIR / 'db.sqlite3'}")
DATABASES = {
    "default": dj_database_url.parse(
        DATABASE_URL,
        conn_max_age=int(os.environ.get("DB_CONN_MAX_AGE", "60")),
        ssl_require=env_bool("DATABASE_SSL_REQUIRE", not DEBUG),
    )
}

AUTH_USER_MODEL = "accounts.User"
AUTHENTICATION_BACKENDS = ["django.contrib.auth.backends.ModelBackend"]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
PASSWORD_RESET_TIMEOUT = int(os.environ.get("PASSWORD_RESET_TIMEOUT", "3600"))

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "rest_framework.schemas.openapi.AutoSchema",
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.accounts.authentication.CsrfSessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "120/hour",
        "user": "1200/hour",
        "auth_register": "5/hour",
        "auth_login": "5/minute",
        "auth_password_reset": "3/hour",
        "auth_password_reset_confirm": "5/hour",
        "payment_create": "30/hour",
    },
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "EXCEPTION_HANDLER": "config.exceptions.api_exception_handler",
}

LANGUAGE_CODE = "en-in"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
)
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = (*default_headers, "idempotency-key")
CORS_URLS_REGEX = r"^/api/.*$"
CSRF_TRUSTED_ORIGINS = env_list(
    "CSRF_TRUSTED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
)
CSRF_FAILURE_VIEW = "config.exceptions.csrf_failure"
CSRF_USE_SESSIONS = False
CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_AGE = int(os.environ.get("SESSION_COOKIE_AGE", "43200"))
SESSION_SAVE_EVERY_REQUEST = False
SESSION_EXPIRE_AT_BROWSER_CLOSE = env_bool("SESSION_EXPIRE_AT_BROWSER_CLOSE", False)

cookie_samesite = os.environ.get("SESSION_COOKIE_SAMESITE", "Lax").strip().capitalize()
if cookie_samesite not in {"Lax", "Strict", "None"}:
    raise ImproperlyConfigured("SESSION_COOKIE_SAMESITE must be Lax, Strict, or None.")
COOKIE_SECURE = env_bool("COOKIE_SECURE", not DEBUG) or cookie_samesite == "None"
SESSION_COOKIE_SAMESITE = cookie_samesite
CSRF_COOKIE_SAMESITE = cookie_samesite
SESSION_COOKIE_SECURE = COOKIE_SECURE
CSRF_COOKIE_SECURE = COOKIE_SECURE

SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", not DEBUG)
SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "0" if DEBUG else "31536000"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", False)
SECURE_HSTS_PRELOAD = env_bool("SECURE_HSTS_PRELOAD", False)
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https") if env_bool("TRUST_PROXY_SSL_HEADER", False) else None
USE_X_FORWARDED_HOST = env_bool("USE_X_FORWARDED_HOST", False)

FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173").rstrip("/")
EMAIL_BACKEND = os.environ.get("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = os.environ.get("EMAIL_HOST", "localhost")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "25"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", False)
EMAIL_USE_SSL = env_bool("EMAIL_USE_SSL", False)
EMAIL_TIMEOUT = int(os.environ.get("EMAIL_TIMEOUT", "10"))
if EMAIL_USE_TLS and EMAIL_USE_SSL:
    raise ImproperlyConfigured("EMAIL_USE_TLS and EMAIL_USE_SSL cannot both be enabled.")
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "OnePay <no-reply@onepay.local>")

# Intelligent Spending Analysis. Local rules are always used. The optional
# classifier hook and external LLM endpoint are opt-in and disabled by default.
ANALYTICS_CACHE_SECONDS = int(os.environ.get("ANALYTICS_CACHE_SECONDS", "60"))
ANALYTICS_CLASSIFIER_PATH = os.environ.get("ANALYTICS_CLASSIFIER_PATH", "").strip()
ANALYTICS_EXTERNAL_LLM_ENABLED = env_bool("ANALYTICS_EXTERNAL_LLM_ENABLED", False)
ANALYTICS_EXTERNAL_LLM_ENDPOINT = os.environ.get("ANALYTICS_EXTERNAL_LLM_ENDPOINT", "").strip()
ANALYTICS_EXTERNAL_LLM_API_KEY = os.environ.get("ANALYTICS_EXTERNAL_LLM_API_KEY", "").strip()
ANALYTICS_EXTERNAL_LLM_TIMEOUT = float(os.environ.get("ANALYTICS_EXTERNAL_LLM_TIMEOUT", "4"))
if ANALYTICS_CACHE_SECONDS < 0:
    raise ImproperlyConfigured("ANALYTICS_CACHE_SECONDS cannot be negative.")

# LocMemCache is suitable for a single local dev process. Configure a shared Django
# cache backend in multi-worker deployments so DRF's authentication throttles are global.
CACHES = {
    "default": {
        "BACKEND": os.environ.get("DJANGO_CACHE_BACKEND", "django.core.cache.backends.locmem.LocMemCache"),
        "LOCATION": os.environ.get("DJANGO_CACHE_LOCATION", "onepay-local"),
    },
}


if not DEBUG:
    if len(SECRET_KEY) < 50 or SECRET_KEY.lower().startswith(("generate-", "replace-", "change-me")):
        raise ImproperlyConfigured("Production requires a unique DJANGO_SECRET_KEY of at least 50 characters.")
    if not os.environ.get("DJANGO_ALLOWED_HOSTS") or not ALLOWED_HOSTS or any(
        "*" in host or host.startswith(".") or host.lower() in {"localhost", "127.0.0.1"}
        for host in ALLOWED_HOSTS
    ):
        raise ImproperlyConfigured("Set exact, non-wildcard DJANGO_ALLOWED_HOSTS values for production.")
    if not os.environ.get("CORS_ALLOWED_ORIGINS") or not CORS_ALLOWED_ORIGINS:
        raise ImproperlyConfigured("Set exact HTTPS CORS_ALLOWED_ORIGINS values for production.")
    if not os.environ.get("CSRF_TRUSTED_ORIGINS") or not CSRF_TRUSTED_ORIGINS:
        raise ImproperlyConfigured("Set exact HTTPS CSRF_TRUSTED_ORIGINS values for production.")

    for setting_name, origins in (
        ("CORS_ALLOWED_ORIGINS", CORS_ALLOWED_ORIGINS),
        ("CSRF_TRUSTED_ORIGINS", CSRF_TRUSTED_ORIGINS),
    ):
        for origin in origins:
            parsed_origin = urlsplit(origin)
            if (
                parsed_origin.scheme != "https"
                or not parsed_origin.netloc
                or parsed_origin.path not in {"", "/"}
                or parsed_origin.query
                or parsed_origin.fragment
                or "*" in origin
                or parsed_origin.username
                or parsed_origin.password
            ):
                raise ImproperlyConfigured(f"{setting_name} must contain exact HTTPS origins without paths or wildcards.")

    frontend_origin = urlsplit(FRONTEND_BASE_URL)
    if (
        frontend_origin.scheme != "https"
        or not frontend_origin.netloc
        or frontend_origin.path not in {"", "/"}
        or frontend_origin.query
        or frontend_origin.fragment
        or "*" in FRONTEND_BASE_URL
    ):
        raise ImproperlyConfigured("FRONTEND_BASE_URL must be an exact HTTPS origin in production.")
    if not COOKIE_SECURE or not SECURE_SSL_REDIRECT:
        raise ImproperlyConfigured("Production requires secure session/CSRF cookies and HTTPS redirects.")
    if SECURE_HSTS_SECONDS < 31_536_000:
        raise ImproperlyConfigured("Production requires at least one year of HSTS.")
    if DATABASES["default"]["ENGINE"] != "django.db.backends.postgresql":
        raise ImproperlyConfigured("Production deployments must use PostgreSQL, not SQLite.")
    if CACHES["default"]["BACKEND"].endswith("LocMemCache"):
        raise ImproperlyConfigured("Production API throttles require a shared cache backend.")
    if EMAIL_BACKEND == "django.core.mail.backends.console.EmailBackend":
        raise ImproperlyConfigured("Production must use a configured email delivery backend, not console output.")
    if ANALYTICS_EXTERNAL_LLM_ENABLED and not ANALYTICS_EXTERNAL_LLM_ENDPOINT.startswith("https://"):
        raise ImproperlyConfigured("ANALYTICS_EXTERNAL_LLM_ENDPOINT must be HTTPS when external AI is enabled.")
    if USE_X_FORWARDED_HOST and SECURE_PROXY_SSL_HEADER is None:
        raise ImproperlyConfigured("USE_X_FORWARDED_HOST requires an explicitly trusted proxy configuration.")

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").strip().upper()
if LOG_LEVEL not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
    raise ImproperlyConfigured("LOG_LEVEL must be DEBUG, INFO, WARNING, ERROR, or CRITICAL.")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"structured": {"()": "config.observability.JsonLogFormatter"}},
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "structured",
        },
    },
    "loggers": {
        "django": {"handlers": ["console"], "level": LOG_LEVEL, "propagate": False},
        "django.server": {"handlers": ["console"], "level": LOG_LEVEL, "propagate": False},
        "onepay": {"handlers": ["console"], "level": LOG_LEVEL, "propagate": False},
    },
    "root": {"handlers": ["console"], "level": LOG_LEVEL},
}
