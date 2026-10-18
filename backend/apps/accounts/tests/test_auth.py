from urllib.parse import parse_qs, urlparse

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APIClient

User = get_user_model()

BASE = "/api/v1/auth/"
REGISTER_DATA = {
    "email": "ananya@example.test",
    "full_name": "Ananya Sharma",
    "password": "OnePay!SecurePass2026",
    "password_confirm": "OnePay!SecurePass2026",
}


@pytest.fixture(autouse=True)
def clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def register(client=None, **overrides):
    client = client or APIClient()
    payload = {**REGISTER_DATA, **overrides}
    return client, client.post(f"{BASE}register/", payload, format="json")


def csrf_headers(client):
    response = client.get(f"{BASE}csrf/")
    return {"HTTP_X_CSRFTOKEN": response.data["csrfToken"]}


def assert_api_error(response, expected_status):
    assert response.status_code == expected_status
    assert "error" in response.data
    assert response.data["error"]["status"] == expected_status


@pytest.mark.django_db
def test_registration_creates_custom_user_with_hashed_password_and_session():
    client, response = register()

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data["user"]["email"] == "ananya@example.test"
    assert response.data["user"]["full_name"] == "Ananya Sharma"
    assert response.data["csrfToken"]
    user = User.objects.get(email="ananya@example.test")
    assert user.check_password(REGISTER_DATA["password"])
    assert user.password != REGISTER_DATA["password"]
    assert client.get(f"{BASE}me/").status_code == status.HTTP_200_OK


@pytest.mark.django_db
def test_registration_rejects_mismatched_weak_and_oversized_passwords():
    _, mismatch = register(password_confirm="Different!Password2026")
    _, weak = register(email="weak@example.test", password="123", password_confirm="123")
    oversized_password = "OnePay!" + "x" * 260
    _, oversized = register(
        email="oversized@example.test",
        password=oversized_password,
        password_confirm=oversized_password,
    )

    assert_api_error(mismatch, status.HTTP_400_BAD_REQUEST)
    assert "password_confirm" in mismatch.data["error"]["details"]
    assert_api_error(weak, status.HTTP_400_BAD_REQUEST)
    assert "password" in weak.data["error"]["details"]
    assert_api_error(oversized, status.HTTP_400_BAD_REQUEST)
    assert oversized_password not in str(oversized.data)


@pytest.mark.django_db
def test_registration_rejects_case_insensitive_duplicate_email():
    register()
    _, duplicate = register(email="ANANYA@EXAMPLE.TEST")

    assert_api_error(duplicate, status.HTTP_400_BAD_REQUEST)
    assert User.objects.filter(email__iexact="ananya@example.test").count() == 1


@pytest.mark.django_db
def test_login_accepts_valid_credentials_and_returns_current_user():
    client, registration = register()
    assert registration.status_code == status.HTTP_201_CREATED
    client.post(f"{BASE}logout/", {}, format="json")

    login_response = client.post(
        f"{BASE}login/",
        {"email": REGISTER_DATA["email"], "password": REGISTER_DATA["password"]},
        format="json",
    )
    current_user = client.get(f"{BASE}me/")

    assert login_response.status_code == status.HTTP_200_OK
    assert login_response.data["user"]["id"] == current_user.data["user"]["id"]
    assert current_user.data["user"]["full_name"] == "Ananya Sharma"


@pytest.mark.django_db
def test_login_rejects_invalid_credentials_without_leaking_account_existence():
    register()
    client = APIClient()
    csrf = csrf_headers(client)
    response = client.post(
        f"{BASE}login/",
        {"email": REGISTER_DATA["email"], "password": "wrong password"},
        format="json",
        **csrf,
    )

    assert_api_error(response, status.HTTP_401_UNAUTHORIZED)
    assert response.data["error"]["message"] == "Unable to log in with those credentials."
    missing_user = client.post(
        f"{BASE}login/",
        {"email": "missing@example.test", "password": "wrong password"},
        format="json",
        **csrf,
    )
    assert missing_user.data["error"]["message"] == response.data["error"]["message"]


@pytest.mark.django_db
def test_logout_invalidates_session_and_me_requires_authentication():
    client, response = register()
    assert response.status_code == status.HTTP_201_CREATED
    assert client.get(f"{BASE}me/").status_code == status.HTTP_200_OK

    logout_response = client.post(f"{BASE}logout/", {}, format="json")
    me_response = client.get(f"{BASE}me/")

    assert logout_response.status_code == status.HTTP_200_OK
    assert_api_error(me_response, status.HTTP_401_UNAUTHORIZED)
    assert_api_error(APIClient().patch(f"{BASE}profile/", {"full_name": "Not allowed"}, format="json"), status.HTTP_401_UNAUTHORIZED)


@pytest.mark.django_db
def test_expired_session_is_unauthorized():
    client, response = register()
    assert response.status_code == status.HTTP_201_CREATED
    session = client.session
    session.set_expiry(-1)
    session.save()

    response = client.get(f"{BASE}me/")
    assert_api_error(response, status.HTTP_401_UNAUTHORIZED)


@pytest.mark.django_db
def test_profile_update_changes_display_name_but_not_login_email():
    client, response = register()
    assert response.status_code == status.HTTP_201_CREATED

    update = client.patch(
        f"{BASE}profile/",
        {"full_name": "Ananya S.", "email": "other@example.test"},
        format="json",
    )
    user = User.objects.get(pk=response.data["user"]["id"])

    assert update.status_code == status.HTTP_200_OK
    assert update.data["user"]["full_name"] == "Ananya S."
    assert update.data["user"]["email"] == "ananya@example.test"
    assert user.full_name == "Ananya S."
    assert user.email == "ananya@example.test"


@pytest.mark.django_db
def test_profile_update_validates_server_side():
    client, response = register()
    assert response.status_code == status.HTTP_201_CREATED

    response = client.patch(f"{BASE}profile/", {"full_name": " "}, format="json")
    assert_api_error(response, status.HTTP_400_BAD_REQUEST)
    assert "full_name" in response.data["error"]["details"]


@pytest.mark.django_db
def test_password_reset_request_is_non_enumerating_and_confirm_changes_password():
    with override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"):
        register()
        client = APIClient()
        known = client.post(f"{BASE}password-reset/", {"email": REGISTER_DATA["email"]}, format="json")
        unknown = client.post(f"{BASE}password-reset/", {"email": "unknown@example.test"}, format="json")

    assert known.status_code == unknown.status_code == status.HTTP_200_OK
    assert known.data == unknown.data
    assert len(mail.outbox) == 1
    reset_url = next(line for line in mail.outbox[0].body.splitlines() if line.startswith("http://"))
    query = parse_qs(urlparse(reset_url).query)
    reset = client.post(
        f"{BASE}password-reset/confirm/",
        {
            "uid": query["uid"][0],
            "token": query["token"][0],
            "new_password": "OnePay!ChangedPassword2026",
            "confirm_password": "OnePay!ChangedPassword2026",
        },
        format="json",
    )
    assert reset.status_code == status.HTTP_200_OK

    login_response = client.post(
        f"{BASE}login/",
        {"email": REGISTER_DATA["email"], "password": "OnePay!ChangedPassword2026"},
        format="json",
    )
    assert login_response.status_code == status.HTTP_200_OK

    reused = client.post(
        f"{BASE}password-reset/confirm/",
        {
            "uid": query["uid"][0],
            "token": query["token"][0],
            "new_password": "OnePay!ChangedAgain2026",
            "confirm_password": "OnePay!ChangedAgain2026",
        },
        format="json",
    )
    assert_api_error(reused, status.HTTP_400_BAD_REQUEST)


@pytest.mark.django_db
def test_login_throttle_limits_repeated_attempts():
    client = APIClient()
    csrf = csrf_headers(client)
    responses = [
        client.post(
            f"{BASE}login/",
            {"email": "nobody@example.test", "password": "invalid password"},
            format="json",
            REMOTE_ADDR="198.51.100.21",
            **csrf,
        )
        for _ in range(6)
    ]

    assert [response.status_code for response in responses[:5]] == [401, 401, 401, 401, 401]
    assert_api_error(responses[5], status.HTTP_429_TOO_MANY_REQUESTS)


@pytest.mark.django_db
def test_login_and_registration_enforce_csrf_token():
    client = APIClient(enforce_csrf_checks=True)
    csrf_response = client.get(f"{BASE}csrf/")
    csrf_token = csrf_response.data["csrfToken"]
    assert csrf_token
    assert "csrftoken" in client.cookies

    missing_header = client.post(f"{BASE}register/", REGISTER_DATA, format="json")
    assert missing_header.status_code == status.HTTP_403_FORBIDDEN
    assert "CSRF validation failed" in missing_header.json()["error"]["message"]

    valid = client.post(
        f"{BASE}register/",
        REGISTER_DATA,
        format="json",
        HTTP_X_CSRFTOKEN=csrf_token,
    )
    assert valid.status_code == status.HTTP_201_CREATED
    assert client.cookies["sessionid"]["httponly"] is True

    missing_login_header = client.post(
        f"{BASE}login/",
        {"email": REGISTER_DATA["email"], "password": REGISTER_DATA["password"]},
        format="json",
    )
    assert missing_login_header.status_code == status.HTTP_403_FORBIDDEN

    valid_login = client.post(
        f"{BASE}login/",
        {"email": REGISTER_DATA["email"], "password": REGISTER_DATA["password"]},
        format="json",
        HTTP_X_CSRFTOKEN=valid.data["csrfToken"],
    )
    assert valid_login.status_code == status.HTTP_200_OK
