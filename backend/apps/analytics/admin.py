from django.contrib import admin

from .models import AnalyticsPreference, SavingsGoal, SpendingBudget, TransactionCategoryCorrection


@admin.register(SpendingBudget)
class SpendingBudgetAdmin(admin.ModelAdmin):
    list_display = ("user", "month", "category", "limit_minor", "updated_at")
    list_filter = ("month", "category")
    search_fields = ("user__email", "category")
    ordering = ("-month", "user__email")


@admin.register(SavingsGoal)
class SavingsGoalAdmin(admin.ModelAdmin):
    list_display = ("user", "name", "target_amount_minor", "saved_amount_minor", "target_date", "is_archived")
    list_filter = ("is_archived",)
    search_fields = ("user__email", "name")


@admin.register(TransactionCategoryCorrection)
class TransactionCategoryCorrectionAdmin(admin.ModelAdmin):
    list_display = ("user", "merchant_label", "category", "subcategory", "apply_to_future", "updated_at")
    list_filter = ("category", "apply_to_future")
    search_fields = ("user__email", "merchant_key", "merchant_label")
    readonly_fields = ("created_at", "updated_at")


@admin.register(AnalyticsPreference)
class AnalyticsPreferenceAdmin(admin.ModelAdmin):
    list_display = ("user", "external_ai_consent", "consent_updated_at", "updated_at")
    list_filter = ("external_ai_consent",)
    search_fields = ("user__email",)
