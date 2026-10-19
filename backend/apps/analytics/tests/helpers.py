"""Shared factories for analytics tests (demo transactions only)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from apps.payments.models import PaymentTransaction

User = get_user_model()


def make_user(email: str | None = None, full_name: str = "Analytics Tester"):
    email = email or f"analytics-{uuid.uuid4().hex[:10]}@example.test"
    return User.objects.create_user(email=email, password="OnePay!SecurePass2026", full_name=full_name)


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _as_datetime(value):
    if value is None:
        return timezone.now()
    if isinstance(value, datetime):
        if timezone.is_naive(value):
            return timezone.make_aware(value, timezone.get_current_timezone())
        return value
    if isinstance(value, date):
        return timezone.make_aware(
            datetime.combine(value, time(hour=12)), timezone.get_current_timezone()
        )
    return value


def make_transaction(
    user,
    *,
    amount: int = 10_000,
    kind: str = PaymentTransaction.Kind.TRANSFER,
    status: str = PaymentTransaction.Status.SUCCESSFUL,
    note: str = "",
    recipient_name: str = "Demo Merchant",
    recipient_identifier: str | None = None,
    service: str = "",
    created_at=None,
    reference: str | None = None,
    recipient=None,
):
    if recipient_identifier is None:
        recipient_identifier = f"merchant-{uuid.uuid4().hex[:8]}@mock"
    transaction = PaymentTransaction.objects.create(
        **({"reference": reference} if reference else {}),
        sender=user,
        sender_name=user.full_name,
        recipient=recipient,
        recipient_name=recipient_name,
        recipient_identifier=recipient_identifier,
        kind=kind,
        service=service,
        note=note,
        amount_minor=amount,
        currency="INR",
        status=PaymentTransaction.Status.PENDING,
        idempotency_key=f"test-{uuid.uuid4().hex}",
        request_fingerprint=uuid.uuid4().hex,
        created_at=_as_datetime(created_at),
    )
    if status == PaymentTransaction.Status.SUCCESSFUL:
        transaction.record_status_transition(PaymentTransaction.Status.SUCCESSFUL, actor=user, reason="test")
    elif status == PaymentTransaction.Status.FAILED:
        transaction.record_status_transition(PaymentTransaction.Status.FAILED, actor=user, reason="test")
    elif status == PaymentTransaction.Status.REVERSED:
        transaction.record_status_transition(PaymentTransaction.Status.SUCCESSFUL, actor=user, reason="test")
        transaction.refresh_from_db()
        transaction.record_status_transition(PaymentTransaction.Status.REVERSED, actor=user, reason="test reversal")
    return transaction


def this_month_day(day: int = 5):
    today = timezone.localdate()
    safe_day = min(day, today.day) if today.month else day
    return today.replace(day=max(1, safe_day))


def previous_month_day(day: int = 5):
    today = timezone.localdate()
    first = today.replace(day=1)
    previous = (first - timedelta(days=1)).replace(day=1)
    max_day = (first - previous).days
    return previous.replace(day=max(1, min(day, max_day)))
