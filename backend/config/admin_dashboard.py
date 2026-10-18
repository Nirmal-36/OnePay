import re
from datetime import timedelta

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.db.models import Count, Sum
from django.http import HttpResponseForbidden
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.http import require_GET

from apps.payments.models import AuditEvent, PaymentTransaction, WalletLedgerEntry


TRANSACTION_REFERENCE_RE = re.compile(r"^OPW-[A-F0-9]{32}$")
REQUIRED_OPERATIONS_PERMISSIONS = (
    "accounts.view_user",
    "payments.view_paymenttransaction",
    "payments.view_auditevent",
    "payments.view_transactionstatushistory",
    "payments.view_walletledgerentry",
)
SAFE_AUDIT_METADATA_KEYS = {
    "amount_minor",
    "currency",
    "kind",
    "service",
    "status",
    "status_code",
    "error_type",
    "route",
    "method",
    "request_id",
    "found",
    "changed_fields",
    "target_user_id",
    "notification_id",
}


def _has_operations_access(user):
    return bool(
        user.is_authenticated
        and user.is_active
        and user.is_staff
        and (
            user.is_superuser
            or all(user.has_perm(permission) for permission in REQUIRED_OPERATIONS_PERMISSIONS)
        )
    )


def _record_admin_action(request, action, *, transaction_obj=None, metadata=None):
    AuditEvent.objects.create(
        actor=request.user,
        transaction=transaction_obj,
        action=action,
        metadata={"request_id": getattr(request, "request_id", ""), **(metadata or {})},
    )


def _safe_metadata(metadata):
    if not isinstance(metadata, dict):
        return {}
    return {key: value for key, value in metadata.items() if key in SAFE_AUDIT_METADATA_KEYS}


def _status_history(transaction_obj):
    return transaction_obj.status_history.select_related("actor").order_by("created_at", "id")


@require_GET
def operations_dashboard(request):
    if not _has_operations_access(request.user):
        return HttpResponseForbidden("You do not have permission to view OnePay operations.")

    now = timezone.now()
    User = get_user_model()
    status_counts = {
        row["status"]: row["count"]
        for row in PaymentTransaction.objects.values("status").annotate(count=Count("id"))
    }
    status_order = (
        PaymentTransaction.Status.PENDING,
        PaymentTransaction.Status.SUCCESSFUL,
        PaymentTransaction.Status.FAILED,
        PaymentTransaction.Status.REVERSED,
    )
    status_rows = [{"status": value, "count": status_counts.get(value, 0)} for value in status_order]
    volume = PaymentTransaction.objects.filter(
        status=PaymentTransaction.Status.SUCCESSFUL,
        kind__in=(PaymentTransaction.Kind.TRANSFER, PaymentTransaction.Kind.BILL, PaymentTransaction.Kind.RECHARGE),
    ).aggregate(total=Sum("amount_minor"))["total"] or 0
    topup_volume = PaymentTransaction.objects.filter(
        status=PaymentTransaction.Status.SUCCESSFUL,
        kind=PaymentTransaction.Kind.TOPUP,
    ).aggregate(total=Sum("amount_minor"))["total"] or 0

    recent_errors_qs = AuditEvent.objects.filter(
        action="system.api_error",
        created_at__gte=now - timedelta(hours=24),
    ).order_by("-created_at", "-id")
    recent_errors = [
        {
            "created_at": event.created_at,
            "route": event.metadata.get("route", "unresolved"),
            "status_code": event.metadata.get("status_code", ""),
            "error_type": event.metadata.get("error_type", ""),
            "request_id": event.metadata.get("request_id", ""),
        }
        for event in recent_errors_qs[:10]
    ]
    recent_payment_incidents_qs = AuditEvent.objects.filter(
        action__in=("payment.processor_pending", "payment.failed_refund"),
        created_at__gte=now - timedelta(hours=24),
    ).select_related("transaction").order_by("-created_at", "-id")
    recent_payment_incidents = [
        {
            "created_at": event.created_at,
            "action": event.action,
            "reference": event.transaction.reference if event.transaction_id else "—",
            "amount_minor": event.metadata.get("amount_minor", "—"),
            "currency": event.metadata.get("currency", "INR"),
        }
        for event in recent_payment_incidents_qs[:10]
    ]

    reference = request.GET.get("reference", "").strip().upper()
    search_error = ""
    investigated_transaction = None
    history = []
    ledger_entries = []
    transaction_audit = []
    if reference:
        if len(reference) > 40 or not TRANSACTION_REFERENCE_RE.fullmatch(reference):
            search_error = "Enter a valid OnePay transaction reference."
        else:
            investigated_transaction = (
                PaymentTransaction.objects.select_related("sender")
                .filter(reference=reference)
                .first()
            )
            _record_admin_action(
                request,
                "admin.transaction.investigated",
                transaction_obj=investigated_transaction,
                metadata={"found": investigated_transaction is not None},
            )
            if investigated_transaction is not None:
                history = list(_status_history(investigated_transaction))
                ledger_entries = list(
                    WalletLedgerEntry.objects.filter(transaction=investigated_transaction).order_by("created_at", "id")
                )
                transaction_audit = list(
                    AuditEvent.objects.filter(transaction=investigated_transaction)
                    .order_by("-created_at", "-id")[:20]
                )

    if not reference:
        _record_admin_action(request, "admin.dashboard.viewed")

    context = {
        **admin.site.each_context(request),
        "title": "OnePay operations dashboard",
        "generated_at": now,
        "user_count": User.objects.count(),
        "active_user_count": User.objects.filter(is_active=True).count(),
        "transaction_count": PaymentTransaction.objects.count(),
        "successful_volume_minor": volume,
        "successful_topup_volume_minor": topup_volume,
        "status_rows": status_rows,
        "error_count_24h": recent_errors_qs.count(),
        "recent_errors": recent_errors,
        "payment_incident_count_24h": recent_payment_incidents_qs.count(),
        "recent_payment_incidents": recent_payment_incidents,
        "reference": reference,
        "search_error": search_error,
        "investigated_transaction": investigated_transaction,
        "history": history,
        "ledger_entries": ledger_entries,
        "transaction_audit": transaction_audit,
    }
    return render(request, "admin/ops_dashboard.html", context)


@require_GET
def audit_log_review(request):
    if not _has_operations_access(request.user):
        return HttpResponseForbidden("You do not have permission to review OnePay audit events.")

    action_filter = request.GET.get("action", "").strip()
    if len(action_filter) > 48:
        action_filter = ""
    events = AuditEvent.objects.select_related("actor", "transaction", "wallet").all()
    if action_filter:
        events = events.filter(action=action_filter)
    try:
        page_number = int(request.GET.get("page", "1"))
    except (TypeError, ValueError):
        page_number = 1
    page_number = min(max(page_number, 1), 1_000_000)
    page_size = 50
    offset = (page_number - 1) * page_size
    total = events.count()
    page_number = min(page_number, max((total + page_size - 1) // page_size, 1))
    offset = (page_number - 1) * page_size
    events_page = list(events[offset:offset + page_size])
    _record_admin_action(request, "admin.audit_log.reviewed", metadata={"filtered": bool(action_filter)})

    rows = [
        {
            "event": event,
            "safe_metadata": _safe_metadata(event.metadata),
        }
        for event in events_page
    ]
    context = {
        **admin.site.each_context(request),
        "title": "OnePay audit log",
        "rows": rows,
        "action_filter": action_filter,
        "page_number": page_number,
        "page_size": page_size,
        "total": total,
        "has_previous": page_number > 1,
        "has_next": offset + page_size < total,
        "previous_page": page_number - 1,
        "next_page": page_number + 1,
    }
    return render(request, "admin/audit_log_review.html", context)
