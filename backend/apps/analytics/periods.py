"""Consistent calendar and timezone handling for analytics.

OnePay calculates days in the deployment's local timezone (Asia/Kolkata by
default). Date filters are inclusive of the end date; internal query bounds use
an exclusive local-midnight timestamp to avoid off-by-one errors.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from django.utils import timezone
from rest_framework.exceptions import ValidationError

PERIOD_CHOICES = ("this_month", "last_month", "last_3_months", "last_6_months", "this_year", "custom")
MAX_CUSTOM_DAYS = 366
PERIOD_LABELS = {
    "this_month": "This month",
    "last_month": "Last month",
    "last_3_months": "Last 3 months",
    "last_6_months": "Last 6 months",
    "this_year": "This year",
    "custom": "Custom range",
}
MONTH_ABBREVIATIONS = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)


@dataclass(frozen=True)
class Period:
    key: str
    start: date
    end_exclusive: date
    label: str
    is_partial_month: bool = False

    @property
    def end_inclusive(self) -> date:
        return self.end_exclusive - timedelta(days=1)

    @property
    def days(self) -> int:
        return max(1, (self.end_exclusive - self.start).days)

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "start_date": self.start.isoformat(),
            "end_date": self.end_inclusive.isoformat(),
            "days": self.days,
            "is_partial_month": self.is_partial_month,
        }


def month_start(value: date) -> date:
    return value.replace(day=1)


def shift_month(value: date, months: int) -> date:
    absolute_month = value.year * 12 + value.month - 1 + months
    year, month_index = divmod(absolute_month, 12)
    return date(year, month_index + 1, 1)


def month_end_exclusive(value: date) -> date:
    return shift_month(month_start(value), 1)


def parse_date(value: str, parameter: str) -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError({parameter: ["Use a date in YYYY-MM-DD format."]}) from exc


def parse_month(value: str, parameter: str = "month") -> date:
    raw = (value or "").strip()
    try:
        parsed = date.fromisoformat(f"{raw}-01")
    except (TypeError, ValueError) as exc:
        raise ValidationError({parameter: ["Use a month in YYYY-MM format."]}) from exc
    if parsed.strftime("%Y-%m") != raw:
        raise ValidationError({parameter: ["Use a month in YYYY-MM format."]})
    return parsed


def month_key(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def month_label(value: date) -> str:
    return f"{MONTH_ABBREVIATIONS[value.month - 1]} {value.year}"


def resolve_period(params, *, today: date | None = None) -> Period:
    today = today or timezone.localdate()
    key = (params.get("period") or "this_month").strip()
    if key not in PERIOD_CHOICES:
        raise ValidationError({"period": [f"Choose one of: {', '.join(PERIOD_CHOICES)}."]})

    current_month = month_start(today)
    if key == "this_month":
        start, end_exclusive = current_month, today + timedelta(days=1)
    elif key == "last_month":
        start, end_exclusive = shift_month(current_month, -1), current_month
    elif key == "last_3_months":
        start, end_exclusive = shift_month(current_month, -2), today + timedelta(days=1)
    elif key == "last_6_months":
        start, end_exclusive = shift_month(current_month, -5), today + timedelta(days=1)
    elif key == "this_year":
        start, end_exclusive = date(today.year, 1, 1), today + timedelta(days=1)
    else:
        raw_start = (params.get("date_from") or "").strip()
        raw_end = (params.get("date_to") or "").strip()
        if not raw_start or not raw_end:
            raise ValidationError({"date_range": ["Custom ranges require both date_from and date_to."]})
        start = parse_date(raw_start, "date_from")
        end = parse_date(raw_end, "date_to")
        if end < start:
            raise ValidationError({"date_to": ["The end date must be on or after the start date."]})
        if end > today:
            raise ValidationError({"date_to": ["The end date cannot be in the future."]})
        if (end - start).days + 1 > MAX_CUSTOM_DAYS:
            raise ValidationError(
                {"date_range": [f"Choose a custom range of at most {MAX_CUSTOM_DAYS} days."]}
            )
        end_exclusive = end + timedelta(days=1)

    is_partial = end_exclusive < month_end_exclusive(start) or (
        end_exclusive == month_end_exclusive(start) and start.month == today.month and start.year == today.year and end_exclusive <= today
    )
    if key in {"last_3_months", "last_6_months", "this_year"}:
        is_partial = True
    return Period(key, start, end_exclusive, PERIOD_LABELS[key], is_partial_month=is_partial)


def resolve_date_range(params, *, today: date | None = None):
    """Backward-compatible tuple form used by the original analytics tests."""
    period = resolve_period(params, today=today)
    return period.key, period.start, period.end_exclusive


def aware_midnight(value: date) -> datetime:
    return timezone.make_aware(datetime.combine(value, time.min), timezone.get_current_timezone())


def report_month_bounds(month: date, *, today: date | None = None) -> Period:
    """Full month for past months, month-to-date for the current month."""
    today = today or timezone.localdate()
    start = month_start(month)
    end_exclusive = month_end_exclusive(start)
    if start > month_start(today):
        raise ValidationError({"month": ["Reports are not available for future months."]})
    if start == month_start(today):
        end_exclusive = today + timedelta(days=1)
    return Period("month", start, end_exclusive, month_label(start), is_partial_month=start == month_start(today))


def comparison_period(period: Period, *, today: date | None = None) -> Period:
    """Return an equal-length preceding window for fair comparisons.

    For a partial current month we compare with the same elapsed days of the
    previous month, not a full previous month.
    """
    today = today or timezone.localdate()
    if period.key == "this_month":
        previous_month = shift_month(period.start, -1)
        elapsed_days = (period.end_exclusive - period.start).days
        previous_end = min(month_end_exclusive(previous_month), previous_month + timedelta(days=elapsed_days))
        return Period("comparison", previous_month, previous_end, "Same days last month")
    if period.key == "last_month":
        previous = shift_month(period.start, -1)
        return Period("comparison", previous, period.start, "Previous month")
    days = period.days
    previous_start = period.start - timedelta(days=days)
    return Period("comparison", previous_start, period.start, "Previous period")
