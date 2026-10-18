import logging
import uuid

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.payments.models import PaymentTransaction

from .models import EVENT_CATEGORY, Notification, NotificationState

logger = logging.getLogger(__name__)


class UnsupportedNotificationEvent(ValueError):
    pass


def _persist_notification(notification, *, state_user=None):
    """Persist one notification and its per-user state idempotently in one DB transaction."""
    with transaction.atomic():
        stored, created = Notification.objects.get_or_create(
            event_key=notification.event_key,
            defaults={
                "recipient": notification.recipient,
                "category": notification.category,
                "event_type": notification.event_type,
                "title": notification.title,
                "message": notification.message,
                "related_transaction": notification.related_transaction,
                "navigation_target": notification.navigation_target,
                "is_announcement": notification.is_announcement,
                "created_by": notification.created_by,
            },
        )
        if not created and (
            stored.recipient_id != notification.recipient_id
            or stored.event_type != notification.event_type
            or stored.category != notification.category
        ):
            raise UnsupportedNotificationEvent("An event key cannot be reused for a different notification.")
        if state_user is not None:
            NotificationState.objects.get_or_create(notification=stored, user=state_user)
    return stored


def create_notification(
    *,
    recipient,
    category,
    event_type,
    title,
    message,
    event_key,
    related_transaction=None,
    navigation_target="",
):
    """Create a validated, recipient-specific notification for an application event."""
    expected_category = EVENT_CATEGORY.get(event_type)
    if expected_category is None or category != expected_category or event_type == Notification.EventType.SYSTEM_ANNOUNCEMENT:
        raise UnsupportedNotificationEvent("Unsupported or mismatched in-app notification event.")
    if recipient is None or not getattr(recipient, "is_authenticated", False):
        raise UnsupportedNotificationEvent("An app-event notification requires an authenticated recipient.")

    event_key = (event_key or "").strip()
    if not event_key:
        raise UnsupportedNotificationEvent("A stable notification event key is required.")
    notification = Notification(
        recipient=recipient,
        category=category,
        event_type=event_type,
        title=(title or "").strip(),
        message=(message or "").strip(),
        related_transaction=related_transaction,
        navigation_target=navigation_target or "",
        event_key=event_key,
    )
    notification.full_clean(validate_unique=False, validate_constraints=False)
    return _persist_notification(notification, state_user=recipient)


def create_notification_safely(**kwargs):
    """Make in-app alerts best-effort without failing a completed business operation."""
    try:
        return create_notification(**kwargs)
    except Exception:
        logger.exception(
            "Could not persist OnePay in-app notification for event_type=%s",
            kwargs.get("event_type", "unknown"),
        )
        return None


def notify_transaction_status(transaction_obj, status_value):
    """Notify the transaction owner only after a real status event has been recorded."""
    if transaction_obj.kind == PaymentTransaction.Kind.TOPUP:
        if status_value != PaymentTransaction.Status.SUCCESSFUL:
            return None
        category = Notification.Category.WALLET
        event_type = Notification.EventType.WALLET_TOPUP_SUCCESSFUL
        title = "Demo funds added"
        message = f"{_format_amount(transaction_obj.amount_minor)} in simulated funds was added to your OnePay wallet. No money was collected."
    else:
        category_by_kind = {
            PaymentTransaction.Kind.TRANSFER: Notification.Category.PAYMENT,
            PaymentTransaction.Kind.BILL: Notification.Category.BILL,
            PaymentTransaction.Kind.RECHARGE: Notification.Category.RECHARGE,
        }
        category = category_by_kind.get(transaction_obj.kind)
        if category is None:
            return None
        event_type = f"{category}.{status_value}"
        if event_type not in Notification.EventType.values:
            return None
        noun = {
            Notification.Category.PAYMENT: "Payment",
            Notification.Category.BILL: "Bill payment",
            Notification.Category.RECHARGE: "Recharge",
        }[category]
        target = transaction_obj.recipient_name or "your recipient"
        amount = _format_amount(transaction_obj.amount_minor)
        if status_value == PaymentTransaction.Status.SUCCESSFUL:
            title = f"{noun} completed"
            message = f"Your simulated {noun.lower()} of {amount} to {target} completed. No real money moved."
        elif status_value == PaymentTransaction.Status.FAILED:
            title = f"{noun} failed"
            message = f"Your simulated {noun.lower()} to {target} was declined; the demo debit was refunded. No provider was contacted."
        elif status_value == PaymentTransaction.Status.PENDING:
            title = f"{noun} pending"
            message = f"Your simulated {noun.lower()} to {target} remains pending. The local simulator has not returned a final result."
        elif status_value == PaymentTransaction.Status.REVERSED:
            title = f"{noun} reversed"
            message = f"Your simulated {noun.lower()} to {target} was reversed and the demo balance was credited back."
        else:
            return None

    return create_notification_safely(
        recipient=transaction_obj.sender,
        category=category,
        event_type=event_type,
        title=title,
        message=message,
        event_key=f"transaction:{transaction_obj.pk}:{status_value}",
        related_transaction=transaction_obj,
        navigation_target=f"/transactions/{transaction_obj.reference}",
    )


def notify_recipient_change(user, action, event_key):
    event_types = {
        "created": (Notification.EventType.RECIPIENT_CREATED, "Recipient added", "A saved recipient was added to your OnePay account."),
        "updated": (Notification.EventType.RECIPIENT_UPDATED, "Recipient updated", "A saved recipient in your OnePay account was updated."),
        "removed": (Notification.EventType.RECIPIENT_REMOVED, "Recipient removed", "A saved recipient was removed from your active OnePay contacts."),
    }
    event = event_types.get(action)
    if event is None:
        return None
    event_type, title, message = event
    return create_notification_safely(
        recipient=user,
        category=Notification.Category.RECIPIENT,
        event_type=event_type,
        title=title,
        message=message,
        event_key=event_key,
        navigation_target="/recipients",
    )


def notify_login(user):
    return create_notification_safely(
        recipient=user,
        category=Notification.Category.SECURITY,
        event_type=Notification.EventType.SECURITY_LOGIN_SUCCESSFUL,
        title="Successful sign-in to OnePay",
        message="Your OnePay account was signed in successfully. If this was not you, reset your password.",
        event_key=f"security:login:{user.pk}:{uuid.uuid4().hex}",
        navigation_target="/profile",
    )


def notify_profile_updated(user):
    return create_notification_safely(
        recipient=user,
        category=Notification.Category.ACCOUNT,
        event_type=Notification.EventType.ACCOUNT_PROFILE_UPDATED,
        title="Profile updated",
        message="Your OnePay account display name was updated.",
        event_key=f"account:profile:{user.pk}:{uuid.uuid4().hex}",
        navigation_target="/profile",
    )


def notify_password_changed(user):
    return create_notification_safely(
        recipient=user,
        category=Notification.Category.SECURITY,
        event_type=Notification.EventType.SECURITY_PASSWORD_CHANGED,
        title="Password updated",
        message="Your OnePay account password was changed. If you did not make this change, contact OnePay support.",
        event_key=f"security:password:{user.pk}:{uuid.uuid4().hex}",
        navigation_target="/profile",
    )


def create_system_announcement(*, created_by, title, message, navigation_target="", event_key=None):
    """Create a single broadcast announcement; per-user read state is stored separately."""
    if created_by is None or not getattr(created_by, "is_staff", False):
        raise PermissionError("Only an authorized OnePay staff member may publish an announcement.")
    key = (event_key or f"announcement:{uuid.uuid4().hex}").strip()
    notification = Notification(
        recipient=None,
        category=Notification.Category.SYSTEM,
        event_type=Notification.EventType.SYSTEM_ANNOUNCEMENT,
        title=(title or "").strip(),
        message=(message or "").strip(),
        related_transaction=None,
        navigation_target=navigation_target or "",
        event_key=key,
        is_announcement=True,
        created_by=created_by,
    )
    notification.full_clean(validate_unique=False, validate_constraints=False)
    return _persist_notification(notification)


def _format_amount(amount_minor):
    return f"₹{amount_minor // 100:,}.{amount_minor % 100:02d}"
