import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


def make_payment_reference():
    return f"OPW-{uuid.uuid4().hex.upper()}"


class Wallet(models.Model):
    """A demo-only INR wallet. Its balance is changed only by payment services."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="onepay_wallet",
    )
    balance_minor = models.PositiveBigIntegerField(default=0)
    currency = models.CharField(max_length=3, default="INR")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(balance_minor__gte=0),
                name="payments_wallet_balance_nonnegative",
            ),
        ]

    def __str__(self):
        return f"OnePay demo wallet for user {self.user_id}"


class Recipient(models.Model):
    """A user's saved mock recipient. No bank or real UPI directory is queried."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="onepay_recipients",
    )
    display_name = models.CharField(max_length=80)
    upi_id = models.CharField(max_length=64)
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("display_name", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "upi_id"),
                name="payments_recipient_owner_upi_unique",
            ),
        ]
        indexes = [models.Index(fields=("user", "is_active"), name="pmt_recipient_owner_active_idx")]

    def save(self, *args, **kwargs):
        self.display_name = self.display_name.strip()
        self.upi_id = self.upi_id.strip().lower()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.display_name} ({self.upi_id})"


class PaymentTransaction(models.Model):
    class Kind(models.TextChoices):
        TRANSFER = "transfer", "Person to person"
        BILL = "bill", "Bill payment"
        RECHARGE = "recharge", "Mobile recharge"
        TOPUP = "topup", "Demo wallet top-up"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCESSFUL = "successful", "Successful"
        FAILED = "failed", "Failed"
        REVERSED = "reversed", "Reversed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reference = models.CharField(max_length=40, unique=True, default=make_payment_reference, editable=False)
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="onepay_transactions",
    )
    sender_name = models.CharField(max_length=120)
    recipient = models.ForeignKey(
        Recipient,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
    )
    recipient_name = models.CharField(max_length=120)
    recipient_identifier = models.CharField(max_length=120, blank=True)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    service = models.CharField(max_length=24, blank=True)
    note = models.CharField(max_length=80, blank=True)
    amount_minor = models.PositiveBigIntegerField()
    currency = models.CharField(max_length=3, default="INR")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    idempotency_key = models.CharField(max_length=128)
    request_fingerprint = models.CharField(max_length=64)
    reversal_idempotency_key = models.CharField(max_length=128, null=True, blank=True)
    reversal_fingerprint = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at", "-reference")
        constraints = [
            models.UniqueConstraint(
                fields=("sender", "idempotency_key"),
                name="payments_sender_idempotency_unique",
            ),
            models.UniqueConstraint(
                fields=("sender", "reversal_idempotency_key"),
                condition=Q(reversal_idempotency_key__isnull=False),
                name="payments_reversal_idem_unique",
            ),
            models.CheckConstraint(
                condition=Q(amount_minor__gt=0),
                name="payments_transaction_amount_positive",
            ),
        ]
        indexes = [
            models.Index(fields=("sender", "-created_at"), name="payments_tx_sender_created_idx"),
            models.Index(fields=("status", "created_at"), name="payments_tx_status_created_idx"),
        ]

    def __str__(self):
        return f"{self.reference} ({self.status})"


class WalletLedgerEntry(models.Model):
    class EntryType(models.TextChoices):
        OPENING = "opening", "Demo opening balance"
        DEBIT = "debit", "Payment debit"
        FAILED_REFUND = "failed_refund", "Failed payment refund"
        REVERSAL_CREDIT = "reversal_credit", "Reversal credit"
        TOPUP_CREDIT = "topup_credit", "Demo top-up credit"

    wallet = models.ForeignKey(Wallet, on_delete=models.PROTECT, related_name="ledger_entries")
    transaction = models.ForeignKey(
        PaymentTransaction,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="ledger_entries",
    )
    entry_type = models.CharField(max_length=24, choices=EntryType.choices)
    amount_minor = models.BigIntegerField()
    balance_after_minor = models.PositiveBigIntegerField()
    currency = models.CharField(max_length=3, default="INR")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at", "id")
        constraints = [
            models.CheckConstraint(
                condition=~Q(amount_minor=0),
                name="payments_ledger_amount_nonzero",
            ),
            models.CheckConstraint(
                condition=Q(balance_after_minor__gte=0),
                name="payments_ledger_balance_nonnegative",
            ),
            models.UniqueConstraint(
                fields=("transaction", "entry_type"),
                condition=Q(transaction__isnull=False),
                name="payments_transaction_ledger_type_unique",
            ),
            models.UniqueConstraint(
                fields=("wallet",),
                condition=Q(entry_type="opening"),
                name="payments_wallet_opening_unique",
            ),
        ]

    def __str__(self):
        return f"{self.entry_type} {self.amount_minor} {self.currency}"


class TransactionStatusHistory(models.Model):
    transaction = models.ForeignKey(
        PaymentTransaction,
        on_delete=models.CASCADE,
        related_name="status_history",
    )
    from_status = models.CharField(max_length=16, choices=PaymentTransaction.Status.choices, null=True, blank=True)
    to_status = models.CharField(max_length=16, choices=PaymentTransaction.Status.choices)
    reason = models.CharField(max_length=120, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="onepay_transaction_status_events",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at", "id")


class AuditEvent(models.Model):
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="onepay_audit_events",
    )
    transaction = models.ForeignKey(
        PaymentTransaction,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_events",
    )
    wallet = models.ForeignKey(
        Wallet,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_events",
    )
    action = models.CharField(max_length=48)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-id")
        indexes = [models.Index(fields=("action", "-created_at"), name="pmt_audit_action_created_idx")]

    def __str__(self):
        return self.action
