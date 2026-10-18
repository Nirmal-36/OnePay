import pytest
from django.contrib.admin.sites import AdminSite
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.test import RequestFactory
from django.utils import timezone
from rest_framework.test import APIClient

from apps.notifications.admin import NotificationAdmin
from apps.notifications.forms import SystemAnnouncementForm
from apps.notifications.models import Notification, NotificationState
from apps.notifications.services import create_notification, create_system_announcement
from apps.payments.models import AuditEvent, PaymentTransaction

User = get_user_model()
BASE = "/api/v1/notifications/"


def make_user(email="notice@example.test", *, is_staff=False):
    return User.objects.create_user(
        email=email,
        password="OnePay!SecurePass2026",
        full_name="Notification User",
        is_staff=is_staff,
    )


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def authorize_announcement_admin(user):
    permission = Permission.objects.get(content_type__app_label="notifications", codename="add_notification")
    user.user_permissions.add(permission)


def make_notification(user, *, event_type=Notification.EventType.PAYMENT_SUCCESSFUL, event_key="payment:event:one", target="/transactions"):
    return create_notification(
        recipient=user,
        category=Notification.Category.PAYMENT,
        event_type=event_type,
        title="Payment completed",
        message="A simulated payment completed.",
        event_key=event_key,
        navigation_target=target,
    )


@pytest.mark.django_db
def test_notification_listing_requires_authentication_and_isolated_by_owner():
    owner = make_user()
    other = make_user("other-notice@example.test")
    owner_notification = make_notification(owner, event_key="owner:payment:one")
    other_notification = make_notification(other, event_key="other:payment:one")

    anonymous = APIClient().get(BASE)
    owner_list = client_for(owner).get(BASE)
    other_list = client_for(other).get(BASE)
    owner_read_other = client_for(owner).post(f"{BASE}{other_notification.pk}/read/", {}, format="json")
    owner_dismiss_other = client_for(owner).post(f"{BASE}{other_notification.pk}/dismiss/", {}, format="json")

    assert anonymous.status_code == 401
    assert owner_list.status_code == other_list.status_code == 200
    assert owner_list.data["count"] == other_list.data["count"] == 1
    assert owner_list.data["results"][0]["id"] == str(owner_notification.pk)
    assert other_list.data["results"][0]["id"] == str(other_notification.pk)
    assert owner_read_other.status_code == owner_dismiss_other.status_code == 404
    assert not NotificationState.objects.filter(notification=other_notification, user=owner).exists()


@pytest.mark.django_db
def test_notification_filters_pagination_and_unread_count():
    user = make_user()
    client = client_for(user)
    payment_one = make_notification(user, event_key="filters:payment:one")
    payment_two = make_notification(user, event_key="filters:payment:two")
    security = create_notification(
        recipient=user,
        category=Notification.Category.SECURITY,
        event_type=Notification.EventType.SECURITY_LOGIN_SUCCESSFUL,
        title="Successful sign-in to OnePay",
        message="Your account was signed in successfully.",
        event_key="filters:security:one",
        navigation_target="/profile",
    )
    NotificationState.objects.filter(notification=security, user=user).update(read_at=timezone.now())

    first_page = client.get(f"{BASE}?page=1&page_size=1&category=payment")
    second_page = client.get(f"{BASE}?page=2&page_size=1&category=payment")
    read_only = client.get(f"{BASE}?read=true")
    unread_only = client.get(f"{BASE}?read=false")
    count = client.get(f"{BASE}unread-count/")
    invalid_category = client.get(f"{BASE}?category=made-up")
    invalid_boolean = client.get(f"{BASE}?read=perhaps")
    invalid_page = client.get(f"{BASE}?page=0")
    invalid_date_range = client.get(f"{BASE}?date_from=2026-10-20&date_to=2026-10-19")

    assert first_page.status_code == second_page.status_code == 200
    assert first_page.data["count"] == 2
    assert first_page.data["page"] == 1 and first_page.data["page_size"] == 1
    assert first_page.data["total_pages"] == 2 and first_page.data["has_next"] is True
    assert second_page.data["results"][0]["id"] != first_page.data["results"][0]["id"]
    assert read_only.data["count"] == 1
    assert read_only.data["results"][0]["id"] == str(security.pk)
    assert unread_only.data["count"] == 2
    assert count.data == {"unread_count": 2}
    assert invalid_category.status_code == invalid_boolean.status_code == 400
    assert invalid_page.status_code == invalid_date_range.status_code == 400
    assert payment_one.pk != payment_two.pk


@pytest.mark.django_db
def test_read_and_dismiss_mutations_persist_for_one_user_and_bulk_operations():
    user = make_user()
    client = client_for(user)
    first = make_notification(user, event_key="state:payment:first")
    second = make_notification(user, event_key="state:payment:second")
    third = make_notification(user, event_key="state:payment:third")

    marked = client.post(f"{BASE}{first.pk}/read/", {}, format="json")
    dismissed = client.post(f"{BASE}{second.pk}/dismiss/", {}, format="json")
    active_after_dismiss = client.get(BASE)
    archived = client.get(f"{BASE}?include_dismissed=true")
    bulk_read = client.post(f"{BASE}read-all/", {}, format="json")
    bulk_dismiss = client.post(f"{BASE}dismiss-all/", {}, format="json")
    empty = client.get(BASE)

    assert marked.status_code == dismissed.status_code == 200
    assert marked.data["notification"]["read"] is True
    assert dismissed.data["dismissed"] is True
    assert dismissed.data["unread_count"] == 1
    assert active_after_dismiss.data["count"] == 2, active_after_dismiss.data
    archived_by_id = {item["id"]: item for item in archived.data["results"]}
    assert archived_by_id[str(second.pk)]["dismissed"] is True
    assert bulk_read.status_code == bulk_dismiss.status_code == 200
    assert bulk_read.data["unread_count"] == 0
    assert bulk_dismiss.data["updated"] == 2
    assert empty.data["count"] == 0
    assert NotificationState.objects.get(notification=first, user=user).read_at is not None
    assert NotificationState.objects.get(notification=second, user=user).dismissed_at is not None
    assert NotificationState.objects.get(notification=third, user=user).dismissed_at is not None


@pytest.mark.django_db
def test_system_announcement_is_shared_once_with_independent_per_user_state():
    staff = make_user("staff-notice@example.test", is_staff=True)
    authorize_announcement_admin(staff)
    first_user = make_user("announcement-one@example.test")
    second_user = make_user("announcement-two@example.test")
    announcement = create_system_announcement(
        created_by=staff,
        title="Planned maintenance",
        message="OnePay demo history will be unavailable briefly for maintenance.",
        navigation_target="/help",
        event_key="announcement:maintenance:2026-10-18",
    )
    first_client = client_for(first_user)
    second_client = client_for(second_user)

    first_list = first_client.get(BASE)
    second_list = second_client.get(BASE)
    mark = first_client.post(f"{BASE}{announcement.pk}/read/", {}, format="json")
    dismiss = first_client.post(f"{BASE}{announcement.pk}/dismiss/", {}, format="json")
    first_after = first_client.get(BASE)
    second_after = second_client.get(BASE)
    with pytest.raises(PermissionError):
        create_system_announcement(created_by=first_user, title="No", message="Not authorized")

    assert first_list.data["results"][0]["id"] == second_list.data["results"][0]["id"] == str(announcement.pk)
    assert mark.data["notification"]["read"] is True
    assert dismiss.status_code == 200
    assert first_after.data["count"] == 0
    assert second_after.data["count"] == 1
    assert Notification.objects.filter(is_announcement=True).count() == 1
    assert NotificationState.objects.filter(notification=announcement).count() == 1
    assert not NotificationState.objects.filter(notification=announcement, user=second_user).exists()
    assert AuditEvent.objects.filter(action="admin.announcement.created", actor=staff).exists()


@pytest.mark.django_db
def test_invalid_navigation_targets_are_rejected_and_deleted_transactions_are_safe():
    user = make_user()
    with pytest.raises(DjangoValidationError):
        make_notification(user, event_key="invalid:navigation", target="https://attacker.example/collect")

    foreign_owner = make_user("foreign-transaction@example.test")
    foreign_transaction = PaymentTransaction.objects.create(
        sender=foreign_owner,
        sender_name=foreign_owner.full_name,
        recipient_name="Demo recipient",
        kind=PaymentTransaction.Kind.TRANSFER,
        amount_minor=100,
        idempotency_key="foreign-notification-transaction",
        request_fingerprint="b" * 64,
    )
    with pytest.raises(DjangoValidationError):
        create_notification(
            recipient=user,
            category=Notification.Category.PAYMENT,
            event_type=Notification.EventType.PAYMENT_PENDING,
            title="Payment pending",
            message="This demo operation is pending.",
            event_key="foreign-resource:pending",
            related_transaction=foreign_transaction,
            navigation_target=f"/transactions/{foreign_transaction.reference}",
        )

    transaction_obj = PaymentTransaction.objects.create(
        sender=user,
        sender_name=user.full_name,
        recipient_name="Demo recipient",
        kind=PaymentTransaction.Kind.TRANSFER,
        amount_minor=100,
        idempotency_key="notification-deleted-resource",
        request_fingerprint="a" * 64,
    )
    notification = create_notification(
        recipient=user,
        category=Notification.Category.PAYMENT,
        event_type=Notification.EventType.PAYMENT_PENDING,
        title="Payment pending",
        message="This demo operation is pending.",
        event_key="deleted-resource:pending",
        related_transaction=transaction_obj,
        navigation_target=f"/transactions/{transaction_obj.reference}",
    )
    notification_id = notification.pk
    reference = transaction_obj.reference
    transaction_obj.delete()
    response = client_for(user).get(BASE)

    assert response.status_code == 200
    item = response.data["results"][0]
    assert item["id"] == str(notification_id)
    assert item["related_transaction_reference"] is None
    assert item["navigation_target"] == ""
    assert reference not in item["navigation_target"]


@pytest.mark.django_db
def test_notification_created_inside_a_rolled_back_event_does_not_survive():
    user = make_user()
    with pytest.raises(RuntimeError):
        with transaction.atomic():
            make_notification(user, event_key="rollback:event:one")
            raise RuntimeError("simulate outer business transaction rollback")

    assert Notification.objects.filter(event_key="rollback:event:one").count() == 0
    assert NotificationState.objects.filter(user=user).count() == 0


@pytest.mark.django_db
def test_staff_without_announcement_permission_cannot_publish():
    staff = make_user("unprivileged-staff@example.test", is_staff=True)
    with pytest.raises(PermissionError):
        create_system_announcement(created_by=staff, title="No", message="Not authorized")

    request = RequestFactory().post("/admin/apps/notifications/notification/add/")
    request.user = staff
    model_admin = NotificationAdmin(Notification, AdminSite())
    assert model_admin.has_add_permission(request) is False


@pytest.mark.django_db
def test_public_notification_creation_is_not_exposed_and_staff_admin_creates_announcements():
    user = make_user()
    anonymous_create = APIClient().post(BASE, {"title": "Broadcast"}, format="json")
    customer_create = client_for(user).post(BASE, {"title": "Broadcast"}, format="json")
    assert anonymous_create.status_code == 401
    assert customer_create.status_code == 405
    assert not Notification.objects.exists()

    staff = make_user("announcement-admin@example.test", is_staff=True)
    authorize_announcement_admin(staff)
    form = SystemAnnouncementForm(data={
        "title": "Service update",
        "message": "OnePay demo maintenance is planned.",
        "navigation_target": "/help",
    })
    assert form.is_valid(), form.errors
    announcement = form.save(commit=False)
    request = RequestFactory().post("/admin/apps/notifications/notification/add/")
    request.user = staff
    NotificationAdmin(Notification, AdminSite()).save_model(request, announcement, form, change=False)

    assert announcement.is_announcement is True
    assert announcement.recipient_id is None
    assert announcement.category == Notification.Category.SYSTEM
    assert announcement.event_type == Notification.EventType.SYSTEM_ANNOUNCEMENT
    assert announcement.created_by_id == staff.pk
    assert client_for(user).get(BASE).data["results"][0]["title"] == "Service update"
