import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
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
            models.CheckConstraint(
                condition=Q(currency="INR"),
                name="payments_wallet_currency_inr",
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


class PaymentTransactionQuerySet(models.QuerySet):
    """Disallow status writes that would bypass the transition/audit service."""

    def update(self, **kwargs):
        if "status" in kwargs:
            raise ValidationError("Use PaymentTransaction.record_status_transition() to change a transaction status.")
        return super().update(**kwargs)

    def bulk_update(self, objs, fields, batch_size=None):
        if "status" in fields:
            raise ValidationError("Bulk status changes are not permitted; record each audited transition.")
        return super().bulk_update(objs, fields, batch_size=batch_size)

    def bulk_create(self, objs, **kwargs):
        objects = list(objs)
        if any(obj.status != PaymentTransaction.Status.PENDING for obj in objects):
            raise ValidationError("A payment transaction must be created as pending and settled through the transition service.")
        return super().bulk_create(objects, **kwargs)


class PaymentTransaction(models.Model):
    objects = PaymentTransactionQuerySet.as_manager()

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
            models.CheckConstraint(
                condition=Q(kind__in=("transfer", "bill", "recharge", "topup")),
                name="payments_transaction_kind_valid",
            ),
            models.CheckConstraint(
                condition=Q(status__in=("pending", "successful", "failed", "reversed")),
                name="payments_transaction_status_valid",
            ),
            models.CheckConstraint(
                condition=~Q(kind="topup", status="reversed"),
                name="payments_topup_not_reversed",
            ),
            models.CheckConstraint(
                condition=Q(currency="INR"),
                name="payments_transaction_currency_inr",
            ),
            models.CheckConstraint(
                condition=~Q(idempotency_key="") & ~Q(request_fingerprint=""),
                name="payments_transaction_idempotency_nonempty",
            ),
        ]
        indexes = [
            models.Index(fields=("sender", "-created_at"), name="payments_tx_sender_created_idx"),
            models.Index(fields=("status", "created_at"), name="payments_tx_status_created_idx"),
        ]

    def save(self, *args, **kwargs):
        if self._state.adding:
            if self.status != self.Status.PENDING:
                raise ValidationError("Transactions must be created as pending and settled through an audited transition.")
        elif not getattr(self, "_allow_status_transition", False):
            update_fields = kwargs.get("update_fields")
            if update_fields is None or "status" in update_fields:
                previous_status = type(self).objects.filter(pk=self.pk).values_list("status", flat=True).first()
                if previous_status is not None and previous_status != self.status:
                    raise ValidationError("Use PaymentTransaction.record_status_transition() to change a transaction status.")
        super().save(*args, **kwargs)

    def record_status_transition(self, to_status, *, actor=None, reason=""):
        """Atomically persist a supported status transition and its immutable history row."""
        allowed_transitions = {
            self.Status.PENDING: {self.Status.SUCCESSFUL, self.Status.FAILED},
            self.Status.SUCCESSFUL: {self.Status.REVERSED},
        }
        if self.pk is None:
            raise ValidationError("An unsaved transaction cannot have a status transition.")

        with transaction.atomic():
            stored = type(self).objects.select_for_update().get(pk=self.pk)
            if stored.status != self.status:
                raise ValidationError("The transaction status changed; reload it before recording another transition.")
            if to_status not in allowed_transitions.get(stored.status, set()) or (
                stored.kind == self.Kind.TOPUP and to_status == self.Status.REVERSED
            ):
                raise ValidationError("This transaction status transition is not permitted.")
            from_status = stored.status
            stored.status = to_status
            if to_status in {self.Status.SUCCESSFUL, self.Status.FAILED, self.Status.REVERSED}:
                stored.completed_at = timezone.now()
            stored._allow_status_transition = True
            try:
                stored.save(update_fields=("status", "completed_at", "updated_at"))
            finally:
                del stored._allow_status_transition
            history = TransactionStatusHistory.objects.create(
                transaction=stored,
                from_status=from_status,
                to_status=to_status,
                actor=actor,
                reason=(reason or "")[:120],
            )
            self.status = stored.status
            self.completed_at = stored.completed_at
            self.updated_at = stored.updated_at
            return history

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
            models.CheckConstraint(
                condition=Q(currency="INR"),
                name="payments_ledger_currency_inr",
            ),
            models.CheckConstraint(
                condition=(
                    Q(entry_type="debit", amount_minor__lt=0)
                    | Q(entry_type__in=("opening", "failed_refund", "reversal_credit", "topup_credit"), amount_minor__gt=0)
                ),
                name="payments_ledger_entry_sign_valid",
            ),
            models.CheckConstraint(
                condition=Q(entry_type__in=("opening", "debit", "failed_refund", "reversal_credit", "topup_credit")),
                name="payments_ledger_entry_type_valid",
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


class AppendOnlyEventQuerySet(models.QuerySet):
    """Prevent ORM edits/deletes to audit evidence while allowing SET_NULL cleanup."""

    def update(self, **kwargs):
        nullable_references = {"actor", "actor_id", "transaction", "transaction_id", "wallet", "wallet_id"}
        if kwargs and set(kwargs) <= nullable_references and all(value is None for value in kwargs.values()):
            return super().update(**kwargs)
        raise ValidationError("Audit and status-history events are append-only.")

    def bulk_update(self, objs, fields, batch_size=None):
        raise ValidationError("Audit and status-history events are append-only.")

    def delete(self):
        raise ValidationError("Audit and status-history events cannot be deleted through the ORM.")


class TransactionStatusHistory(models.Model):
    objects = AppendOnlyEventQuerySet.as_manager()

    transaction = models.ForeignKey(
        PaymentTransaction,
        on_delete=models.PROTECT,
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
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(from_status__isnull=True, to_status="pending")
                    | Q(from_status="pending", to_status__in=("successful", "failed"))
                    | Q(from_status="successful", to_status="reversed")
                ),
                name="payments_status_transition_valid",
            ),
            models.UniqueConstraint(
                fields=("transaction", "to_status"),
                name="payments_tx_status_once_unique",
            ),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("Transaction status history is append-only.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Transaction status history cannot be deleted.")


class AuditEvent(models.Model):
    objects = AppendOnlyEventQuerySet.as_manager()
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
        constraints = [
            models.CheckConstraint(
                condition=~Q(action=""),
                name="payments_audit_action_nonempty",
            ),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("Audit events are append-only.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Audit events cannot be deleted.")

    def __str__(self):
        return self.action
