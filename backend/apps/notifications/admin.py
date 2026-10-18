import uuid

from django.contrib import admin
from django.core.exceptions import PermissionDenied

from .forms import SystemAnnouncementForm
from .models import Notification, NotificationState


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("title", "category", "event_type", "recipient", "is_announcement", "created_at")
    list_filter = ("category", "event_type", "is_announcement", "created_at")
    search_fields = ("title", "message", "event_key", "recipient__email")
    ordering = ("-created_at",)
    form = SystemAnnouncementForm

    def get_fields(self, request, obj=None):
        if obj is None:
            return ("title", "message", "navigation_target")
        return (
            "id",
            "recipient",
            "category",
            "event_type",
            "title",
            "message",
            "related_transaction",
            "navigation_target",
            "event_key",
            "is_announcement",
            "created_by",
            "created_at",
        )

    def get_readonly_fields(self, request, obj=None):
        return self.get_fields(request, obj) if obj is not None else ()

    def has_add_permission(self, request):
        return request.user.is_staff

    def has_view_permission(self, request, obj=None):
        return request.user.is_staff

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        if change or not request.user.is_staff:
            raise PermissionDenied("Only staff may publish a new system announcement.")
        obj.recipient = None
        obj.category = Notification.Category.SYSTEM
        obj.event_type = Notification.EventType.SYSTEM_ANNOUNCEMENT
        obj.related_transaction = None
        obj.is_announcement = True
        obj.created_by = request.user
        obj.event_key = f"announcement:{uuid.uuid4().hex}"
        obj.full_clean()
        super().save_model(request, obj, form, change)


@admin.register(NotificationState)
class NotificationStateAdmin(admin.ModelAdmin):
    list_display = ("notification", "user", "read_at", "dismissed_at", "updated_at")
    list_filter = ("read_at", "dismissed_at", "updated_at")
    search_fields = ("user__email", "notification__title", "notification__event_key")
    readonly_fields = ("notification", "user", "read_at", "dismissed_at", "created_at", "updated_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
