"""Validation serializers for analytics-owned mutations."""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from .categories import CATEGORY_SET, NON_CONSUMPTION_CATEGORIES
from .models import SavingsGoal, SpendingBudget

MAX_MONEY_MINOR = 100_000_000_000  # INR 1,000,000,000.00


def _month_bounds():
    today = timezone.localdate().replace(day=1)
    return today - timedelta(days=31 * 36), today + timedelta(days=366)


class BudgetWriteSerializer(serializers.Serializer):
    month = serializers.RegexField(r"^\d{4}-(0[1-9]|1[0-2])$")
    category = serializers.CharField(required=False, allow_blank=True, default="", max_length=40)
    limit_minor = serializers.IntegerField(min_value=1, max_value=MAX_MONEY_MINOR)

    def validate_month(self, value):
        from .periods import parse_month

        month = parse_month(value)
        earliest, latest = _month_bounds()
        if month < earliest or month > latest:
            raise serializers.ValidationError("Choose a month within three years of today.")
        return month

    def validate_category(self, value):
        value = (value or "").strip()
        if value and value not in CATEGORY_SET:
            raise serializers.ValidationError("Choose a supported category.")
        if value in NON_CONSUMPTION_CATEGORIES:
            raise serializers.ValidationError(
                "Transfers, income, and refunds are excluded from consumption budgets."
            )
        return value


class BudgetUpdateSerializer(serializers.Serializer):
    month = serializers.RegexField(r"^\d{4}-(0[1-9]|1[0-2])$", required=False)
    category = serializers.CharField(required=False, allow_blank=True, max_length=40)
    limit_minor = serializers.IntegerField(required=False, min_value=1, max_value=MAX_MONEY_MINOR)

    def validate_month(self, value):
        from .periods import parse_month

        month = parse_month(value)
        earliest, latest = _month_bounds()
        if month < earliest or month > latest:
            raise serializers.ValidationError("Choose a month within three years of today.")
        return month

    def validate_category(self, value):
        value = (value or "").strip()
        if value and value not in CATEGORY_SET:
            raise serializers.ValidationError("Choose a supported category.")
        if value in NON_CONSUMPTION_CATEGORIES:
            raise serializers.ValidationError(
                "Transfers, income, and refunds are excluded from consumption budgets."
            )
        return value


class BudgetSerializer(serializers.ModelSerializer):
    month = serializers.SerializerMethodField()
    category_label = serializers.SerializerMethodField()

    class Meta:
        model = SpendingBudget
        fields = ("id", "month", "category", "category_label", "limit_minor", "created_at", "updated_at")

    def get_month(self, obj):
        return obj.month.strftime("%Y-%m")

    def get_category_label(self, obj):
        return obj.category or "Overall"


class GoalWriteSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=2, max_length=80)
    target_amount_minor = serializers.IntegerField(min_value=1, max_value=MAX_MONEY_MINOR)
    saved_amount_minor = serializers.IntegerField(required=False, min_value=0, max_value=MAX_MONEY_MINOR, default=0)
    target_date = serializers.DateField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, max_length=200, default="")
    is_archived = serializers.BooleanField(required=False, default=False)


class GoalUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(required=False, min_length=2, max_length=80)
    target_amount_minor = serializers.IntegerField(required=False, min_value=1, max_value=MAX_MONEY_MINOR)
    saved_amount_minor = serializers.IntegerField(required=False, min_value=0, max_value=MAX_MONEY_MINOR)
    target_date = serializers.DateField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, max_length=200)
    is_archived = serializers.BooleanField(required=False)


class GoalSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavingsGoal
        fields = (
            "id",
            "name",
            "target_amount_minor",
            "saved_amount_minor",
            "target_date",
            "note",
            "is_archived",
            "created_at",
            "updated_at",
        )


class PreferenceWriteSerializer(serializers.Serializer):
    external_ai_consent = serializers.BooleanField()


class CategoryCorrectionWriteSerializer(serializers.Serializer):
    category = serializers.CharField(max_length=40)
    subcategory = serializers.CharField(required=False, allow_blank=True, max_length=80, default="")
    apply_to_future = serializers.BooleanField(required=False, default=True)

    def validate_category(self, value):
        if value not in CATEGORY_SET:
            raise serializers.ValidationError("Choose a supported category.")
        return value
