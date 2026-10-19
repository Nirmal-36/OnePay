"""Authenticated, owner-scoped analytics API endpoints."""

from __future__ import annotations

from django.db import IntegrityError
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .budgets import build_budget_overview, goal_payload, recommended_budgets
from .cache import cached_payload
from .forecasting import build_anomalies, build_forecast
from .models import SavingsGoal, SpendingBudget
from .periods import parse_month, report_month_bounds, resolve_period
from .reports import available_report_months, build_monthly_report, build_period_csv, report_csv
from .serializers import (
    BudgetUpdateSerializer,
    BudgetWriteSerializer,
    CategoryCorrectionWriteSerializer,
    GoalUpdateSerializer,
    GoalWriteSerializer,
    PreferenceWriteSerializer,
)
from .services import (
    build_category_analytics,
    build_merchant_analytics,
    build_meta,
    build_spending_summary,
    build_trends,
    delete_transaction_category,
    get_preferences,
    list_corrections,
    list_spending_transactions,
    save_transaction_category,
    transaction_category,
    update_preferences,
)


class SpendingSummaryView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return Response(build_spending_summary(request.user, request.query_params))


class SpendingTransactionsView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return Response(list_spending_transactions(request.user, request.query_params))


class CategoryAnalyticsView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return Response(build_category_analytics(request.user, request.query_params))


class TrendAnalyticsView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return Response(build_trends(request.user, request.query_params))


class MerchantAnalyticsView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return Response(build_merchant_analytics(request.user, request.query_params))


class InsightListView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        period = resolve_period(request.query_params)
        payload = cached_payload(
            request.user.pk,
            "insights",
            {"period": period.key, "start": period.start.isoformat(), "end": period.end_exclusive.isoformat()},
            lambda: _insights_payload(request.user, period),
        )
        return Response(payload)


def _insights_payload(user, period):
    from .insights import build_insights

    return build_insights(user, period)


class ForecastView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        today = timezone.localdate()
        payload = cached_payload(
            request.user.pk,
            "forecast",
            {"as_of": today.isoformat()},
            lambda: build_forecast(request.user, today=today),
        )
        return Response(payload)


class AnomalyView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        period = resolve_period(request.query_params)
        payload = cached_payload(
            request.user.pk,
            "anomalies",
            {"period": period.key, "start": period.start.isoformat(), "end": period.end_exclusive.isoformat()},
            lambda: build_anomalies(request.user, period),
        )
        return Response(payload)


class ReportMonthsView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return Response({"months": available_report_months(request.user)})


class MonthlyReportView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request, year: int, month: int):
        month_start = _report_month(year, month)
        payload = cached_payload(
            request.user.pk,
            "report",
            {"month": month_start.strftime("%Y-%m")},
            lambda: build_monthly_report(request.user, month_start),
        )
        return Response(payload)


class MonthlyReportExportView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request, year: int, month: int):
        month_start = _report_month(year, month)
        report = cached_payload(
            request.user.pk,
            "report",
            {"month": month_start.strftime("%Y-%m")},
            lambda: build_monthly_report(request.user, month_start),
        )
        csv_text = report_csv(report)
        filename = f"onepay-spending-report-{month_start.strftime('%Y-%m')}.csv"
        response = HttpResponse(csv_text, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        response["Cache-Control"] = "private, no-store"
        return response


def _report_month(year: int, month: int):
    if not 1 <= month <= 12:
        raise ValidationError({"month": ["Choose a month between 1 and 12."]})
    try:
        parsed = parse_month(f"{year:04d}-{month:02d}")
    except ValidationError as exc:
        raise ValidationError({"month": ["Choose a valid month."]}) from exc
    report_month_bounds(parsed)  # raises for future months
    return parsed


class CustomRangeReportExportView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        if (request.query_params.get("period") or "").strip() != "custom":
            raise ValidationError({"period": ["Use period=custom with date_from and date_to."]})
        period = resolve_period(request.query_params)
        csv_text = build_period_csv(request.user, period)
        filename = (
            f"onepay-spending-report-{period.start.isoformat()}-to-"
            f"{period.end_inclusive.isoformat()}.csv"
        )
        response = HttpResponse(csv_text, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        response["Cache-Control"] = "private, no-store"
        return response


class BudgetCollectionView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        month_param = (request.query_params.get("month") or "").strip()
        month = parse_month(month_param) if month_param else timezone.localdate().replace(day=1)
        overview = build_budget_overview(request.user, month)
        return Response(
            {
                **overview,
                "recommendation": recommended_budgets(request.user),
                "available_categories": _budget_categories(),
            }
        )

    def post(self, request):
        serializer = BudgetWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        budget, created = SpendingBudget.objects.update_or_create(
            user=request.user,
            month=data["month"],
            category=data.get("category", ""),
            defaults={"limit_minor": data["limit_minor"]},
        )
        overview = build_budget_overview(request.user, budget.month)
        return Response(
            {
                "budget": _budget_dict(budget),
                "overview": overview,
                "created": created,
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class BudgetDetailView(APIView):
    permission_classes = (IsAuthenticated,)

    def patch(self, request, pk: int):
        budget = get_object_or_404(SpendingBudget, user=request.user, pk=pk)
        serializer = BudgetUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        new_month = data.get("month", budget.month)
        new_category = data.get("category", budget.category)
        if (
            SpendingBudget.objects.filter(user=request.user, month=new_month, category=new_category)
            .exclude(pk=budget.pk)
            .exists()
        ):
            raise ValidationError({"budget": ["A budget already exists for that month and category."]})
        budget.month = new_month
        budget.category = new_category
        if "limit_minor" in data:
            budget.limit_minor = data["limit_minor"]
        budget.save()
        return Response({"budget": _budget_dict(budget), "overview": build_budget_overview(request.user, budget.month)})

    def delete(self, request, pk: int):
        budget = get_object_or_404(SpendingBudget, user=request.user, pk=pk)
        month = budget.month
        budget.delete()
        return Response(
            {"deleted": True, "overview": build_budget_overview(request.user, month)},
            status=status.HTTP_200_OK,
        )


def _budget_dict(budget: SpendingBudget) -> dict:
    return {
        "id": budget.pk,
        "month": budget.month.strftime("%Y-%m"),
        "category": budget.category,
        "category_label": budget.category or "Overall",
        "limit_minor": budget.limit_minor,
        "created_at": budget.created_at,
        "updated_at": budget.updated_at,
    }


def _budget_categories() -> list[dict]:
    from .categories import CATEGORY_NAMES, CATEGORY_SUBCATEGORIES, NON_CONSUMPTION_CATEGORIES

    return [
        {
            "name": category,
            "subcategories": list(CATEGORY_SUBCATEGORIES[category]),
            "budgetable": category not in NON_CONSUMPTION_CATEGORIES,
        }
        for category in CATEGORY_NAMES
        if category not in NON_CONSUMPTION_CATEGORIES
    ]


class GoalCollectionView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        include_archived = (request.query_params.get("include_archived") or "").lower() in {"1", "true", "yes"}
        goals = SavingsGoal.objects.filter(user=request.user)
        if not include_archived:
            goals = goals.filter(is_archived=False)
        payloads = [goal_payload(goal) for goal in goals]
        return Response(
            {
                "count": len(payloads),
                "goals": payloads,
                "summary": {
                    "active_goal_count": sum(1 for goal in payloads if not goal["is_archived"]),
                    "total_target_minor": sum(goal["target_amount_minor"] for goal in payloads),
                    "total_saved_minor": sum(goal["saved_amount_minor"] for goal in payloads),
                    "completed_count": sum(1 for goal in payloads if goal["is_complete"]),
                },
                "note": "Goal progress uses amounts you record. OnePay does not infer a real bank balance.",
            }
        )

    def post(self, request):
        serializer = GoalWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        goal = SavingsGoal.objects.create(user=request.user, **data)
        return Response({"goal": goal_payload(goal)}, status=status.HTTP_201_CREATED)


class GoalDetailView(APIView):
    permission_classes = (IsAuthenticated,)

    def patch(self, request, pk: int):
        goal = get_object_or_404(SavingsGoal, user=request.user, pk=pk)
        serializer = GoalUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        for field, value in serializer.validated_data.items():
            setattr(goal, field, value)
        goal.save()
        return Response({"goal": goal_payload(goal)})

    def delete(self, request, pk: int):
        goal = get_object_or_404(SavingsGoal, user=request.user, pk=pk)
        goal.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TransactionCategoryView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request, reference: str):
        return Response(transaction_category(request.user, reference))

    def post(self, request, reference: str):
        serializer = CategoryCorrectionWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(save_transaction_category(request.user, reference, serializer.validated_data))

    def delete(self, request, reference: str):
        delete_transaction_category(request.user, reference)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CorrectionListView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return Response(list_corrections(request.user))


class PreferenceView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return Response(get_preferences(request.user))

    def patch(self, request):
        raw = (request.data or {}).get("external_ai_consent")
        if not isinstance(raw, bool):
            raise ValidationError({"external_ai_consent": ["Provide true or false."]})
        serializer = PreferenceWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(update_preferences(request.user, serializer.validated_data))


class AnalyticsMetaView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return Response(build_meta(request.user))
