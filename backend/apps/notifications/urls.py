from django.urls import path

from .views import (
    NotificationDismissAllView,
    NotificationDismissView,
    NotificationListView,
    NotificationMarkAllReadView,
    NotificationReadView,
    NotificationUnreadCountView,
)

app_name = "notifications"

urlpatterns = [
    path("", NotificationListView.as_view(), name="list"),
    path("unread-count/", NotificationUnreadCountView.as_view(), name="unread-count"),
    path("read-all/", NotificationMarkAllReadView.as_view(), name="read-all"),
    path("dismiss-all/", NotificationDismissAllView.as_view(), name="dismiss-all"),
    path("<uuid:notification_id>/read/", NotificationReadView.as_view(), name="read"),
    path("<uuid:notification_id>/dismiss/", NotificationDismissView.as_view(), name="dismiss"),
]
