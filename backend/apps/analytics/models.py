"""User-owned analytics configuration and budgeting records.

The transaction ledger remains in ``apps.payments``. These models add only the
state analytics needs: categorization corrections, optional AI consent,
monthly budgets, and savings goals. Every row is scoped to one user.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from .categories import CATEGORY_NAMES, CATEGORY_SET, NON_CONSUMPTION_CATEGORIES, sanitize_subcategory

CATEGORY_CHOICES = tuple((name, name) for name in CATEGORY_NAMES)
BUDGETABLE_CATEGORY_CHOICES = tuple(
    (name, name) for name in CATEGORY_NAMES if name not in NON_CONSUMPTION_CATEGORIES
)


def _first_of_month(value):
    if value is None:
        return None
    return value.replace(day=1)


class AnalyticsPreference(models.Model):
    """Explicit, revocable consent for optional external classification."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="analytics_preferences",
    )
    external_ai_consent = models.BooleanField(default=False)
    consent_updated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if self.external_ai_consent and self.consent_updated_at is None:
            self.consent_updated_at = timezone.now()
        if not self.external_ai_consent:
            self.consent_updated_at = None
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Analytics preferences for user {self.user_id}"


class TransactionCategoryCorrection(models.Model):
    """A user's manual correction of one transaction, optionally reusable."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="analytics_category_corrections",
    )
    transaction = models.ForeignKey(
        "payments.PaymentTransaction",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="analytics_category_corrections",
    )
    merchant_key = models.CharField(max_length=200, db_index=True)
    merchant_label = models.CharField(max_length=120, blank=True)
    category = models.CharField(max_length=40, choices=CATEGORY_CHOICES)
    subcategory = models.CharField(max_length=80, blank=True)
    apply_to_future = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at", "-pk")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "transaction"),
                condition=models.Q(transaction__isnull=False),
                name="analytics_correction_user_transaction_unique",
            ),
        ]
        indexes = [
            models.Index(fields=("user", "merchant_key"), name="an_corr_user_merchant_idx"),
            models.Index(fields=("user", "-updated_at"), name="an_corr_user_updated_idx"),
        ]

    def clean(self):
        if self.category not in CATEGORY_SET:
            raise ValidationError({"category": "Choose a supported category."})
        if self.transaction_id is not None and self.transaction.sender_id != self.user_id:
            raise ValidationError({"transaction": "You can only correct your own transactions."})

    def save(self, *args, **kwargs):
        self.category = (self.category or "").strip()
        if self.category not in CATEGORY_SET:
            raise ValidationError("Choose a supported category.")
        self.subcategory = sanitize_subcategory(self.subcategory, self.category)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.merchant_key}: {self.category}"


class SpendingBudget(models.Model):
    """A monthly overall or category limit. Blank category means overall."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="analytics_budgets",
    )
    month = models.DateField(help_text="First day of the budget month.")
    category = models.CharField(max_length=40, blank=True, choices=(("", "Overall"), *BUDGETABLE_CATEGORY_CHOICES))
    limit_minor = models.PositiveBigIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("month", "category")
        constraints = [
            models.UniqueConstraint(
                fields=("user", "month", "category"),
                name="analytics_budget_user_month_category_unique",
            ),
            models.CheckConstraint(
                condition=models.Q(limit_minor__gt=0),
                name="analytics_budget_limit_positive",
            ),
        ]
        indexes = [models.Index(fields=("user", "month"), name="an_budget_user_month_idx")]

    def clean(self):
        if self.month is not None and self.month.day != 1:
            raise ValidationError({"month": "Budgets are stored by month; use the first day of the month."})
        if self.category and self.category not in CATEGORY_SET:
            raise ValidationError({"category": "Choose a supported category."})
        if self.category in NON_CONSUMPTION_CATEGORIES:
            raise ValidationError(
                {"category": "Transfers, income, and refunds are excluded from consumption budgets."}
            )

    def save(self, *args, **kwargs):
        self.month = _first_of_month(self.month)
        self.category = (self.category or "").strip()
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        label = self.category or "Overall"
        return f"{label} budget for {self.month:%Y-%m}"


class SavingsGoal(models.Model):
    """A user-declared savings target. Progress is user-recorded, not inferred."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="analytics_goals",
    )
    name = models.CharField(max_length=80)
    target_amount_minor = models.PositiveBigIntegerField()
    saved_amount_minor = models.PositiveBigIntegerField(default=0)
    target_date = models.DateField(null=True, blank=True)
    note = models.CharField(max_length=200, blank=True)
    is_archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("is_archived", "target_date", "pk")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(target_amount_minor__gt=0),
                name="analytics_goal_target_positive",
            ),
        ]
        indexes = [models.Index(fields=("user", "is_archived"), name="an_goal_user_active_idx")]

    def clean(self):
        if self.target_amount_minor <= 0:
            raise ValidationError({"target_amount_minor": "Set a savings target above zero."})
        if self.saved_amount_minor < 0:
            raise ValidationError({"saved_amount_minor": "Saved amount cannot be negative."})

    def save(self, *args, **kwargs):
        self.name = (self.name or "").strip()
        self.note = (self.note or "").strip()
        super().save(*args, **kwargs)

    @property
    def progress_percent(self) -> float:
        if not self.target_amount_minor:
            return 0.0
        return round(self.saved_amount_minor * 100 / self.target_amount_minor, 1)

    def __str__(self):
        return f"{self.name} ({self.progress_percent}%)"
