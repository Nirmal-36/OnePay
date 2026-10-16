import hashlib
import json
import re
import threading
from collections import defaultdict
from contextlib import contextmanager

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connection, transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac
from rest_framework.exceptions import APIException, NotFound, ValidationError

from .models import (
    AuditEvent,
    PaymentTransaction,
    Recipient,
    TransactionStatusHistory,
    Wallet,
    WalletLedgerEntry,
)

INITIAL_BALANCE_MINOR = 2_458_000  # INR 24,580.00; demo funds only.
MAX_PAYMENT_MINOR = 5_000_000  # INR 50,000.00 per simulated operation.
TOPUP_AMOUNTS_MINOR = (10_000, 25_000, 50_000, 100_000, 250_000)

DEFAULT_RECIPIENTS = (
    ("Rohan Mehta", "rohan@okaxis"),
    ("Kavya Iyer", "kavya@okhdfcbank"),
    ("Arjun Rao", "arjun@okicici"),
    ("Meera Nair", "meera@oksbi"),
    ("Dev Patel", "dev@okaxis"),
)
DEFAULT_RECIPIENT_NAMES = {upi_id: name for name, upi_id in DEFAULT_RECIPIENTS}
MOCK_HANDLE_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,47}@[a-z0-9][a-z0-9.-]{1,23}$")
IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")

SERVICE_RECIPIENT_NAMES = {
    "mobile": "Demo Mobile",
    "dth": "Demo DTH",
    "electricity": "Demo Electricity",
    "water": "Demo Water",
    "gas": "Demo Gas",
    "broadband": "Demo Broadband",
}

_wallet_mutexes = defaultdict(threading.Lock)


class IdempotencyConflict(APIException):
    status_code = 409
    default_detail = "This Idempotency-Key was already used for a different request."
    default_code = "idempotency_conflict"


class PaymentConflict(APIException):
    status_code = 409
    default_detail = "This payment cannot be changed in its current state."
    default_code = "payment_conflict"


class PaymentNetworkError(Exception):
    """A simulated processor outage; no external payment network is contacted."""


@contextmanager
def _serialize_wallet_operations(user_id):
    """SQLite ignores select_for_update, so serialize same-user operations in-process there."""
    if connection.vendor == "sqlite":
        lock = _wallet_mutexes[user_id]
        lock.acquire()
        try:
            yield
        finally:
            lock.release()
    else:
        yield


def validate_mock_upi_id(value):
    value = (value or "").strip().lower()
    if not MOCK_HANDLE_RE.fullmatch(value):
        raise ValidationError({"upi_id": ["Enter a valid mock UPI ID."]})
    domain = value.rsplit("@", 1)[1]
    if value not in DEFAULT_RECIPIENT_NAMES and domain not in {"onepay", "mock"}:
        raise ValidationError({"upi_id": ["Only OnePay demo handles and listed mock UPI IDs are supported."]})
    return value


def _idempotency_key(value):
    key = (value or "").strip()
    if not IDEMPOTENCY_KEY_RE.fullmatch(key):
        raise ValidationError({"Idempotency-Key": ["Send an 8–128 character Idempotency-Key using letters, numbers, '.', '_', ':' or '-'."]})
    return key


def _fingerprint(payload):
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _lock_wallet_for_user(user):
    # Locking the user row serializes first-wallet creation as well as subsequent
    # balance operations on databases that implement SELECT ... FOR UPDATE.
    user_model = get_user_model()
    user_model.objects.select_for_update().get(pk=user.pk)
    wallet, created = Wallet.objects.get_or_create(
        user_id=user.pk,
        defaults={
            "balance_minor": INITIAL_BALANCE_MINOR,
            "currency": "INR",
        },
    )
    wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
    if created or not wallet.ledger_entries.filter(entry_type=WalletLedgerEntry.EntryType.OPENING).exists():
        opening_amount = wallet.balance_minor
        if opening_amount:
            WalletLedgerEntry.objects.create(
                wallet=wallet,
                entry_type=WalletLedgerEntry.EntryType.OPENING,
                amount_minor=opening_amount,
                balance_after_minor=wallet.balance_minor,
                currency=wallet.currency,
            )
    return wallet


def _ensure_default_recipients(user):
    # Seed once. Inactive (soft-deleted) defaults still count, so deletion does
    # not make a contact reappear on the next list or payment request.
    if Recipient.objects.filter(user_id=user.pk).exists():
        return
    for display_name, upi_id in DEFAULT_RECIPIENTS:
        Recipient.objects.get_or_create(
            user_id=user.pk,
            upi_id=upi_id,
            defaults={"display_name": display_name, "is_default": True},
        )


def get_or_create_wallet(user):
    with _serialize_wallet_operations(user.pk):
        with transaction.atomic():
            wallet = _lock_wallet_for_user(user)
            _ensure_default_recipients(user)
            return wallet


def list_recipients(user):
    get_or_create_wallet(user)
    return Recipient.objects.filter(user=user, is_active=True)


def lookup_recipient(user, identifier):
    get_or_create_wallet(user)
    identifier = (identifier or "").strip()
    if not identifier:
        raise ValidationError({"identifier": ["Enter a recipient ID or mock UPI ID."]})
    if identifier.isdecimal():
        try:
            return Recipient.objects.get(user=user, pk=int(identifier), is_active=True)
        except (Recipient.DoesNotExist, ValueError):
            raise NotFound("No active recipient matches that ID.")

    upi_id = validate_mock_upi_id(identifier)
    recipient = Recipient.objects.filter(user=user, upi_id=upi_id, is_active=True).first()
    if recipient:
        return recipient
    display_name = DEFAULT_RECIPIENT_NAMES.get(upi_id)
    if display_name:
        # Defaults are normally seeded above; create a missing row without ever
        # resolving through a real UPI directory.
        recipient, _ = Recipient.objects.get_or_create(
            user=user,
            upi_id=upi_id,
            defaults={"display_name": display_name, "is_default": True},
        )
        if recipient.is_active:
            return recipient
        raise NotFound("No active recipient matches that UPI ID.")
    if upi_id.endswith(("@onepay", "@mock")):
        local_part = upi_id.split("@", 1)[0]
        display_name = " ".join(part.capitalize() for part in re.split(r"[._-]+", local_part) if part)
        return {
            "id": None,
            "display_name": display_name or "OnePay demo recipient",
            "upi_id": upi_id,
            "is_active": True,
            "is_default": False,
        }
    raise NotFound("No active recipient matches that mock UPI ID.")


def _resolve_payment_recipient(user, payload):
    recipient_id = payload.get("recipient_id")
    upi_id = payload.get("upi_id")
    if recipient_id is not None:
        recipient = Recipient.objects.filter(user=user, pk=recipient_id, is_active=True).first()
        if recipient is None:
            raise ValidationError({"recipient_id": ["This recipient is not available in your OnePay account."]})
        return recipient, recipient.display_name, recipient.upi_id
    if not upi_id:
        raise ValidationError({"recipient_id": ["Choose a saved recipient or provide a mock UPI ID."]})

    upi_id = validate_mock_upi_id(upi_id)
    recipient = Recipient.objects.filter(user=user, upi_id=upi_id, is_active=True).first()
    if recipient:
        return recipient, recipient.display_name, recipient.upi_id
    display_name = DEFAULT_RECIPIENT_NAMES.get(upi_id)
    if display_name:
        recipient, _ = Recipient.objects.get_or_create(
            user=user,
            upi_id=upi_id,
            defaults={"display_name": display_name, "is_default": True},
        )
        if recipient.is_active:
            return recipient, recipient.display_name, recipient.upi_id
        raise ValidationError({"upi_id": ["This recipient is inactive."]})
    local_part = upi_id.split("@", 1)[0]
    display_name = " ".join(part.capitalize() for part in re.split(r"[._-]+", local_part) if part)
    return None, display_name or "OnePay demo recipient", upi_id


def _mask_identifier(value):
    digits = "".join(character for character in (value or "") if character.isdigit())
    if not digits:
        return ""
    return f"Ending {digits[-4:]}"


def _private_identifier_fingerprint(value):
    if not value:
        return ""
    return salted_hmac(
        "onepay.payment.recipient_identifier",
        str(value).strip().lower(),
        algorithm="sha256",
    ).hexdigest()


def _existing_idempotent_transaction(user, key, fingerprint):
    existing = PaymentTransaction.objects.select_for_update().filter(
        sender=user,
        idempotency_key=key,
    ).first()
    if existing is None:
        return None
    if existing.request_fingerprint != fingerprint:
        raise IdempotencyConflict()
    return existing


def _record_status(transaction_obj, to_status, *, actor=None, reason=""):
    from_status = transaction_obj.status
    transaction_obj.status = to_status
    if to_status in {PaymentTransaction.Status.SUCCESSFUL, PaymentTransaction.Status.FAILED, PaymentTransaction.Status.REVERSED}:
        transaction_obj.completed_at = timezone.now()
    transaction_obj.save(update_fields=("status", "completed_at", "updated_at"))
    TransactionStatusHistory.objects.create(
        transaction=transaction_obj,
        from_status=from_status,
        to_status=to_status,
        actor=actor,
        reason=reason[:120],
    )


def _audit(*, actor, action, wallet=None, transaction_obj=None, metadata=None):
    AuditEvent.objects.create(
        actor=actor,
        action=action,
        wallet=wallet,
        transaction=transaction_obj,
        metadata=metadata or {},
    )


def simulate_payment(transaction_obj):
    """Deterministic local processor; no request leaves OnePay."""
    identifier = transaction_obj.recipient_identifier.lower()
    if identifier in {"fail@onepay", "decline@onepay", "failed@mock"}:
        return PaymentTransaction.Status.FAILED
    if identifier in {"pending@onepay", "timeout@mock"}:
        raise PaymentNetworkError("The local simulator is temporarily unavailable.")
    return PaymentTransaction.Status.SUCCESSFUL


def _settle_pending_transaction(transaction_id, actor):
    # The lock ensures two idempotent retries cannot execute two simulator
    # outcomes or refund/debit a wallet twice.
    with _serialize_wallet_operations(actor.pk):
        with transaction.atomic():
            user_model = get_user_model()
            user_model.objects.select_for_update().get(pk=actor.pk)
            transaction_obj = PaymentTransaction.objects.select_for_update().filter(
                pk=transaction_id,
                sender=actor,
            ).first()
            if transaction_obj is None:
                raise NotFound("Transaction not found.")
            if transaction_obj.status != PaymentTransaction.Status.PENDING:
                return transaction_obj
            wallet = Wallet.objects.select_for_update().get(user=actor)
            try:
                outcome = simulate_payment(transaction_obj)
            except PaymentNetworkError:
                _audit(
                    actor=actor,
                    action="payment.processor_pending",
                    wallet=wallet,
                    transaction_obj=transaction_obj,
                    metadata={"status": PaymentTransaction.Status.PENDING},
                )
                return transaction_obj

            if outcome == PaymentTransaction.Status.FAILED:
                wallet.balance_minor += transaction_obj.amount_minor
                wallet.save(update_fields=("balance_minor", "updated_at"))
                WalletLedgerEntry.objects.create(
                    wallet=wallet,
                    transaction=transaction_obj,
                    entry_type=WalletLedgerEntry.EntryType.FAILED_REFUND,
                    amount_minor=transaction_obj.amount_minor,
                    balance_after_minor=wallet.balance_minor,
                    currency=transaction_obj.currency,
                )
                _record_status(
                    transaction_obj,
                    PaymentTransaction.Status.FAILED,
                    actor=actor,
                    reason="The OnePay demo simulator declined this payment; the demo debit was refunded.",
                )
                _audit(
                    actor=actor,
                    action="payment.failed_refund",
                    wallet=wallet,
                    transaction_obj=transaction_obj,
                    metadata={"amount_minor": transaction_obj.amount_minor, "currency": transaction_obj.currency},
                )
            else:
                _record_status(
                    transaction_obj,
                    PaymentTransaction.Status.SUCCESSFUL,
                    actor=actor,
                    reason="Completed by the local OnePay demo simulator.",
                )
                _audit(
                    actor=actor,
                    action="payment.successful",
                    wallet=wallet,
                    transaction_obj=transaction_obj,
                    metadata={"amount_minor": transaction_obj.amount_minor, "currency": transaction_obj.currency},
                )
            transaction_obj.refresh_from_db()
            return transaction_obj


def initiate_payment(user, payload, idempotency_key):
    key = _idempotency_key(idempotency_key)
    payload = dict(payload)
    kind = payload["kind"]
    amount_minor = payload["amount_minor"]
    if amount_minor > MAX_PAYMENT_MINOR:
        raise ValidationError({"amount_minor": ["The maximum simulated payment is INR 50,000.00."]})

    if kind == PaymentTransaction.Kind.TRANSFER:
        normalized_upi = validate_mock_upi_id(payload["upi_id"]) if payload.get("upi_id") else None
        fingerprint_payload = {
            "kind": kind,
            "amount_minor": amount_minor,
            "recipient_id": payload.get("recipient_id"),
            "upi_id": normalized_upi,
            "note": payload.get("note", ""),
        }
    else:
        service_name = payload.get("service") or ""
        raw_identifier = payload.get("recipient_reference", "")
        fingerprint_payload = {
            "kind": kind,
            "service": service_name,
            "amount_minor": amount_minor,
            "recipient_reference": _mask_identifier(raw_identifier),
            "recipient_reference_tag": _private_identifier_fingerprint(raw_identifier),
            "note": payload.get("note", ""),
        }
    fingerprint = _fingerprint(fingerprint_payload)

    with _serialize_wallet_operations(user.pk):
        with transaction.atomic():
            wallet = _lock_wallet_for_user(user)
            _ensure_default_recipients(user)
            existing = _existing_idempotent_transaction(user, key, fingerprint)
            if existing is not None:
                transaction_id = existing.pk
            else:
                if kind == PaymentTransaction.Kind.TRANSFER:
                    recipient, recipient_name, recipient_identifier = _resolve_payment_recipient(user, payload)
                    service_name = ""
                else:
                    recipient = None
                    service_name = payload["service"]
                    recipient_name = SERVICE_RECIPIENT_NAMES[service_name]
                    recipient_identifier = _mask_identifier(payload.get("recipient_reference", ""))
                if wallet.balance_minor < amount_minor:
                    raise ValidationError({"amount_minor": ["Your OnePay demo balance is too low for this payment."]})

                transaction_obj = PaymentTransaction.objects.create(
                    sender=user,
                    sender_name=user.full_name,
                    recipient=recipient,
                    recipient_name=recipient_name,
                    recipient_identifier=recipient_identifier,
                    kind=kind,
                    service=service_name,
                    note=payload.get("note", ""),
                    amount_minor=amount_minor,
                    currency=wallet.currency,
                    status=PaymentTransaction.Status.PENDING,
                    idempotency_key=key,
                    request_fingerprint=fingerprint,
                )
                wallet.balance_minor -= amount_minor
                wallet.save(update_fields=("balance_minor", "updated_at"))
                WalletLedgerEntry.objects.create(
                    wallet=wallet,
                    transaction=transaction_obj,
                    entry_type=WalletLedgerEntry.EntryType.DEBIT,
                    amount_minor=-amount_minor,
                    balance_after_minor=wallet.balance_minor,
                    currency=wallet.currency,
                )
                TransactionStatusHistory.objects.create(
                    transaction=transaction_obj,
                    from_status=None,
                    to_status=PaymentTransaction.Status.PENDING,
                    actor=user,
                    reason="Payment accepted for local demo processing.",
                )
                _audit(
                    actor=user,
                    action="payment.initiated",
                    wallet=wallet,
                    transaction_obj=transaction_obj,
                    metadata={
                        "amount_minor": amount_minor,
                        "currency": wallet.currency,
                        "kind": kind,
                    },
                )
                transaction_id = transaction_obj.pk

    transaction_obj = PaymentTransaction.objects.get(pk=transaction_id, sender=user)
    if transaction_obj.status == PaymentTransaction.Status.PENDING:
        transaction_obj = _settle_pending_transaction(transaction_id, user)
    return transaction_obj


def create_topup(user, amount_minor, idempotency_key):
    key = _idempotency_key(idempotency_key)
    if amount_minor not in TOPUP_AMOUNTS_MINOR:
        raise ValidationError({"amount_minor": ["Choose one of the available OnePay demo top-up amounts."]})
    fingerprint = _fingerprint({"kind": PaymentTransaction.Kind.TOPUP, "amount_minor": amount_minor})

    with _serialize_wallet_operations(user.pk):
        with transaction.atomic():
            wallet = _lock_wallet_for_user(user)
            _ensure_default_recipients(user)
            transaction_obj = _existing_idempotent_transaction(user, key, fingerprint)
            if transaction_obj is None:
                transaction_obj = PaymentTransaction.objects.create(
                    sender=user,
                    sender_name=user.full_name,
                    recipient_name="OnePay Demo Wallet",
                    recipient_identifier="",
                    kind=PaymentTransaction.Kind.TOPUP,
                    amount_minor=amount_minor,
                    currency=wallet.currency,
                    status=PaymentTransaction.Status.PENDING,
                    idempotency_key=key,
                    request_fingerprint=fingerprint,
                )
                TransactionStatusHistory.objects.create(
                    transaction=transaction_obj,
                    from_status=None,
                    to_status=PaymentTransaction.Status.PENDING,
                    actor=user,
                    reason="Demo top-up accepted for local processing.",
                )
                wallet.balance_minor += amount_minor
                wallet.save(update_fields=("balance_minor", "updated_at"))
                WalletLedgerEntry.objects.create(
                    wallet=wallet,
                    transaction=transaction_obj,
                    entry_type=WalletLedgerEntry.EntryType.TOPUP_CREDIT,
                    amount_minor=amount_minor,
                    balance_after_minor=wallet.balance_minor,
                    currency=wallet.currency,
                )
                _record_status(
                    transaction_obj,
                    PaymentTransaction.Status.SUCCESSFUL,
                    actor=user,
                    reason="Demo funds credited; no money was collected.",
                )
                _audit(
                    actor=user,
                    action="wallet.demo_topup",
                    wallet=wallet,
                    transaction_obj=transaction_obj,
                    metadata={"amount_minor": amount_minor, "currency": wallet.currency},
                )
            transaction_obj.refresh_from_db()
            return transaction_obj


def reverse_transaction(user, reference, idempotency_key):
    key = _idempotency_key(idempotency_key)
    fingerprint = _fingerprint({"action": "reverse", "reference": reference})
    with _serialize_wallet_operations(user.pk):
        with transaction.atomic():
            get_user_model().objects.select_for_update().get(pk=user.pk)
            previous = PaymentTransaction.objects.select_for_update().filter(
                sender=user,
                reversal_idempotency_key=key,
            ).first()
            if previous is not None:
                if previous.reversal_fingerprint != fingerprint:
                    raise IdempotencyConflict()
                return previous

            transaction_obj = PaymentTransaction.objects.select_for_update().filter(
                sender=user,
                reference=reference,
            ).first()
            if transaction_obj is None:
                raise NotFound("Transaction not found.")
            if transaction_obj.status == PaymentTransaction.Status.REVERSED:
                raise PaymentConflict("This transaction has already been reversed.")
            if transaction_obj.status != PaymentTransaction.Status.SUCCESSFUL:
                raise PaymentConflict("Only a successful transaction can be reversed.")
            if transaction_obj.kind == PaymentTransaction.Kind.TOPUP:
                raise PaymentConflict("A demo wallet top-up cannot be reversed as a payment.")

            wallet = Wallet.objects.select_for_update().get(user=user)
            transaction_obj.reversal_idempotency_key = key
            transaction_obj.reversal_fingerprint = fingerprint
            transaction_obj.save(update_fields=("reversal_idempotency_key", "reversal_fingerprint", "updated_at"))
            wallet.balance_minor += transaction_obj.amount_minor
            wallet.save(update_fields=("balance_minor", "updated_at"))
            WalletLedgerEntry.objects.create(
                wallet=wallet,
                transaction=transaction_obj,
                entry_type=WalletLedgerEntry.EntryType.REVERSAL_CREDIT,
                amount_minor=transaction_obj.amount_minor,
                balance_after_minor=wallet.balance_minor,
                currency=transaction_obj.currency,
            )
            _record_status(
                transaction_obj,
                PaymentTransaction.Status.REVERSED,
                actor=user,
                reason="The successful demo transaction was reversed and the simulated debit was credited back.",
            )
            _audit(
                actor=user,
                action="payment.reversed",
                wallet=wallet,
                transaction_obj=transaction_obj,
                metadata={"amount_minor": transaction_obj.amount_minor, "currency": transaction_obj.currency},
            )
            transaction_obj.refresh_from_db()
            return transaction_obj
