import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from .navigation import is_safe_navigation_target


class Notification(models.Model):
    class Category(models.TextChoices):
        PAYMENT = "payment", "Payment"
        WALLET = "wallet", "Wallet"
        BILL = "bill", "Bill payment"
        RECHARGE = "recharge", "Recharge"
        RECIPIENT = "recipient", "Recipient"
        ACCOUNT = "account", "Account"
        SECURITY = "security", "Security"
        SYSTEM = "system", "System"

    class EventType(models.TextChoices):
        PAYMENT_PENDING = "payment.pending", "Payment pending"
        PAYMENT_SUCCESSFUL = "payment.successful", "Payment successful"
        PAYMENT_FAILED = "payment.failed", "Payment failed"
        PAYMENT_REVERSED = "payment.reversed", "Payment reversed"
        WALLET_TOPUP_SUCCESSFUL = "wallet.topup_successful", "Wallet top-up successful"
        BILL_PENDING = "bill.pending", "Bill payment pending"
        BILL_SUCCESSFUL = "bill.successful", "Bill payment successful"
        BILL_FAILED = "bill.failed", "Bill payment failed"
        RECHARGE_PENDING = "recharge.pending", "Recharge pending"
        RECHARGE_SUCCESSFUL = "recharge.successful", "Recharge successful"
        RECHARGE_FAILED = "recharge.failed", "Recharge failed"
        RECIPIENT_CREATED = "recipient.created", "Recipient added"
        RECIPIENT_UPDATED = "recipient.updated", "Recipient updated"
        RECIPIENT_REMOVED = "recipient.removed", "Recipient removed"
        ACCOUNT_PROFILE_UPDATED = "account.profile_updated", "Profile updated"
        SECURITY_LOGIN_SUCCESSFUL = "security.login_successful", "Successful sign-in"
        SECURITY_PASSWORD_CHANGED = "security.password_changed", "Password changed"
        SYSTEM_ANNOUNCEMENT = "system.announcement", "System announcement"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="onepay_notifications",
    )
    category = models.CharField(max_length=16, choices=Category.choices)
    event_type = models.CharField(max_length=48, choices=EventType.choices)
    title = models.CharField(max_length=140)
    message = models.CharField(max_length=500)
    related_transaction = models.ForeignKey(
        "payments.PaymentTransaction",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="notifications",
    )
    navigation_target = models.CharField(max_length=255, blank=True)
    event_key = models.CharField(max_length=180, unique=True, editable=False)
    is_announcement = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="onepay_created_announcements",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(fields=("recipient", "-created_at"), name="notif_owner_created_idx"),
            models.Index(fields=("category", "-created_at"), name="notif_cat_created_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(
                        is_announcement=True,
                        recipient__isnull=True,
                        category="system",
                        event_type="system.announcement",
                        related_transaction__isnull=True,
                    )
                    | Q(
                        is_announcement=False,
                        recipient__isnull=False,
                        category__in=(
                            "payment",
                            "wallet",
                            "bill",
                            "recharge",
                            "recipient",
                            "account",
                            "security",
                        ),
                        event_type__in=(
                            "payment.pending",
                            "payment.successful",
                            "payment.failed",
                            "payment.reversed",
                            "wallet.topup_successful",
                            "bill.pending",
                            "bill.successful",
                            "bill.failed",
                            "recharge.pending",
                            "recharge.successful",
                            "recharge.failed",
                            "recipient.created",
                            "recipient.updated",
                            "recipient.removed",
                            "account.profile_updated",
                            "security.login_successful",
                            "security.password_changed",
                        ),
                    )
                ),
                name="notif_scope_valid_check",
            ),
        ]

    def clean(self):
        super().clean()
        errors = {}
        expected_category = EVENT_CATEGORY.get(self.event_type)
        if expected_category is None:
            errors["event_type"] = "Choose a supported OnePay notification event."
        elif self.category != expected_category:
            errors["category"] = "The category must match the notification event type."

        if self.is_announcement:
            if self.recipient_id is not None or self.category != self.Category.SYSTEM:
                errors["recipient"] = "System announcements must be unaddressed and use the system category."
            if self.event_type != self.EventType.SYSTEM_ANNOUNCEMENT or self.related_transaction_id is not None:
                errors["event_type"] = "System announcements cannot reference a transaction."
        elif self.recipient_id is None or self.category == self.Category.SYSTEM:
            errors["recipient"] = "An app-event notification must have an authenticated recipient."

        if (
            not self.is_announcement
            and self.related_transaction_id is not None
            and self.related_transaction.sender_id != self.recipient_id
        ):
            errors["related_transaction"] = "A notification may only reference a transaction owned by its recipient."

        if not is_safe_navigation_target(self.navigation_target):
            errors["navigation_target"] = "Use an existing internal OnePay route."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.event_type} for {self.recipient_id or 'all users'}"


EVENT_CATEGORY = {
    Notification.EventType.PAYMENT_PENDING: Notification.Category.PAYMENT,
    Notification.EventType.PAYMENT_SUCCESSFUL: Notification.Category.PAYMENT,
    Notification.EventType.PAYMENT_FAILED: Notification.Category.PAYMENT,
    Notification.EventType.PAYMENT_REVERSED: Notification.Category.PAYMENT,
    Notification.EventType.WALLET_TOPUP_SUCCESSFUL: Notification.Category.WALLET,
    Notification.EventType.BILL_PENDING: Notification.Category.BILL,
    Notification.EventType.BILL_SUCCESSFUL: Notification.Category.BILL,
    Notification.EventType.BILL_FAILED: Notification.Category.BILL,
    Notification.EventType.RECHARGE_PENDING: Notification.Category.RECHARGE,
    Notification.EventType.RECHARGE_SUCCESSFUL: Notification.Category.RECHARGE,
    Notification.EventType.RECHARGE_FAILED: Notification.Category.RECHARGE,
    Notification.EventType.RECIPIENT_CREATED: Notification.Category.RECIPIENT,
    Notification.EventType.RECIPIENT_UPDATED: Notification.Category.RECIPIENT,
    Notification.EventType.RECIPIENT_REMOVED: Notification.Category.RECIPIENT,
    Notification.EventType.ACCOUNT_PROFILE_UPDATED: Notification.Category.ACCOUNT,
    Notification.EventType.SECURITY_LOGIN_SUCCESSFUL: Notification.Category.SECURITY,
    Notification.EventType.SECURITY_PASSWORD_CHANGED: Notification.Category.SECURITY,
    Notification.EventType.SYSTEM_ANNOUNCEMENT: Notification.Category.SYSTEM,
}


class NotificationState(models.Model):
    notification = models.ForeignKey(Notification, on_delete=models.CASCADE, related_name="user_states")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="onepay_notification_states",
    )
    read_at = models.DateTimeField(null=True, blank=True)
    dismissed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("notification", "user"), name="notif_state_unique"),
        ]
        indexes = [
            models.Index(fields=("user", "notification"), name="notif_state_user_notif_idx"),
            models.Index(fields=("user", "read_at", "dismissed_at"), name="notif_state_user_read_idx"),
        ]

    def __str__(self):
        return f"Notification state for user {self.user_id}"
