from rest_framework import serializers

from .models import Notification


class NotificationListQuerySerializer(serializers.Serializer):
    page = serializers.IntegerField(min_value=1, max_value=1_000_000, required=False, default=1)
    page_size = serializers.IntegerField(min_value=1, max_value=50, required=False, default=20)
    category = serializers.ChoiceField(choices=Notification.Category.choices, required=False)
    read = serializers.BooleanField(required=False, allow_null=True, default=None)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    include_dismissed = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        date_from = attrs.get("date_from")
        date_to = attrs.get("date_to")
        if date_from and date_to and date_from > date_to:
            raise serializers.ValidationError({"date_to": ["The end date must be on or after the start date."]})
        return attrs


class NotificationSerializer(serializers.ModelSerializer):
    read = serializers.BooleanField(source="is_read", read_only=True)
    dismissed = serializers.BooleanField(source="is_dismissed", read_only=True)
    related_transaction_reference = serializers.SerializerMethodField()
    navigation_target = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = (
            "id",
            "category",
            "event_type",
            "title",
            "message",
            "related_transaction_reference",
            "navigation_target",
            "read",
            "dismissed",
            "created_at",
        )
        read_only_fields = fields

    def get_related_transaction_reference(self, notification):
        transaction_obj = getattr(notification, "related_transaction", None)
        return transaction_obj.reference if transaction_obj is not None else None

    def get_navigation_target(self, notification):
        from .navigation import is_safe_navigation_target, is_transaction_navigation_target

        target = notification.navigation_target
        if not is_safe_navigation_target(target):
            return ""
        if is_transaction_navigation_target(target) and notification.related_transaction_id is None:
            return ""
        return target
