from itertools import islice

from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Exists, OuterRef, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Notification, NotificationState
from .serializers import NotificationListQuerySerializer, NotificationSerializer


class NotificationQueryMixin:
    permission_classes = (IsAuthenticated,)

    def visible_notifications(self, user):
        states = NotificationState.objects.filter(notification_id=OuterRef("pk"), user_id=user.pk)
        return (
            Notification.objects.filter(
                Q(recipient=user) | Q(recipient__isnull=True, is_announcement=True)
            )
            .select_related("related_transaction")
            .annotate(
                is_read=Exists(states.filter(read_at__isnull=False)),
                is_dismissed=Exists(states.filter(dismissed_at__isnull=False)),
            )
        )

    def unread_count(self, user):
        return self.visible_notifications(user).filter(is_read=False, is_dismissed=False).count()

    def get_notification(self, user, notification_id):
        return get_object_or_404(self.visible_notifications(user), pk=notification_id)

    def serialize_notification(self, user, notification_id):
        notification = self.get_notification(user, notification_id)
        return NotificationSerializer(notification).data


class NotificationListView(NotificationQueryMixin, APIView):
    def get(self, request):
        query = NotificationListQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        filters = query.validated_data
        queryset = self.visible_notifications(request.user)

        if not filters["include_dismissed"]:
            queryset = queryset.filter(is_dismissed=False)
        if "category" in filters:
            queryset = queryset.filter(category=filters["category"])
        if filters.get("read") is not None:
            queryset = queryset.filter(is_read=filters["read"])
        if filters.get("date_from"):
            queryset = queryset.filter(created_at__date__gte=filters["date_from"])
        if filters.get("date_to"):
            queryset = queryset.filter(created_at__date__lte=filters["date_to"])

        paginator = Paginator(queryset, filters["page_size"])
        total_pages = paginator.num_pages if paginator.count else 0
        page_number = filters["page"]
        if page_number > max(total_pages, 1):
            raise NotFound("The requested notification page does not exist.")
        page = paginator.page(page_number)
        return Response({
            "count": paginator.count,
            "page": page.number,
            "page_size": filters["page_size"],
            "total_pages": total_pages,
            "has_next": page.has_next(),
            "has_previous": page.has_previous(),
            "results": NotificationSerializer(page.object_list, many=True).data,
        })


class NotificationUnreadCountView(NotificationQueryMixin, APIView):
    def get(self, request):
        return Response({"unread_count": self.unread_count(request.user)})


class NotificationReadView(NotificationQueryMixin, APIView):
    def post(self, request, notification_id):
        with transaction.atomic():
            notification = self.get_notification(request.user, notification_id)
            state, _ = NotificationState.objects.select_for_update().get_or_create(
                notification=notification,
                user=request.user,
            )
            if state.read_at is None:
                state.read_at = timezone.now()
                state.save(update_fields=("read_at", "updated_at"))
        return Response({
            "notification": self.serialize_notification(request.user, notification_id),
            "unread_count": self.unread_count(request.user),
        })


class NotificationDismissView(NotificationQueryMixin, APIView):
    def post(self, request, notification_id):
        with transaction.atomic():
            notification = self.get_notification(request.user, notification_id)
            state, _ = NotificationState.objects.select_for_update().get_or_create(
                notification=notification,
                user=request.user,
            )
            if state.dismissed_at is None:
                state.dismissed_at = timezone.now()
                state.save(update_fields=("dismissed_at", "updated_at"))
        return Response({
            "dismissed": True,
            "unread_count": self.unread_count(request.user),
        })


class NotificationBulkStateView(NotificationQueryMixin, APIView):
    state_field = ""

    def post(self, request):
        now = timezone.now()
        with transaction.atomic():
            active = self.visible_notifications(request.user).filter(is_dismissed=False).order_by()
            notification_ids = active.values_list("pk", flat=True)
            existing_state_ids = NotificationState.objects.filter(
                user=request.user,
                notification_id__in=notification_ids,
            ).values("notification_id")
            missing_ids = active.exclude(pk__in=existing_state_ids).values_list("pk", flat=True).iterator(chunk_size=500)
            created_count = 0
            while True:
                chunk = list(islice(missing_ids, 500))
                if not chunk:
                    break
                states = [
                    NotificationState(
                        notification_id=notification_id,
                        user=request.user,
                        **{self.state_field: now},
                    )
                    for notification_id in chunk
                ]
                NotificationState.objects.bulk_create(states, ignore_conflicts=True, batch_size=500)
                created_count += len(chunk)

            state_queryset = NotificationState.objects.filter(
                user=request.user,
                notification_id__in=notification_ids,
                **{f"{self.state_field}__isnull": True},
            )
            changed_count = state_queryset.update(**{self.state_field: now, "updated_at": now})

        return Response({
            "updated": created_count + changed_count,
            "unread_count": self.unread_count(request.user),
        })


class NotificationMarkAllReadView(NotificationBulkStateView):
    state_field = "read_at"


class NotificationDismissAllView(NotificationBulkStateView):
    state_field = "dismissed_at"
