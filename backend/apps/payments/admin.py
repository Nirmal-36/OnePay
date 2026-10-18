from django.contrib import admin

from .models import AuditEvent, PaymentTransaction, Recipient, TransactionStatusHistory, Wallet, WalletLedgerEntry


class ReadOnlyAdmin(admin.ModelAdmin):
    def _record_read(self, request, action, *, transaction_obj=None):
        AuditEvent.objects.create(
            actor=request.user,
            transaction=transaction_obj,
            action=action,
            metadata={"request_id": getattr(request, "request_id", "")},
        )

    def changelist_view(self, request, extra_context=None):
        if request.method == "GET" and self.has_view_permission(request):
            self._record_read(request, f"admin.{self.model._meta.model_name}.list_viewed")
        return super().changelist_view(request, extra_context=extra_context)

    def change_view(self, request, object_id, form_url="", extra_context=None):
        if request.method == "GET" and self.has_view_permission(request):
            obj = self.get_object(request, object_id)
            transaction_obj = obj if isinstance(obj, PaymentTransaction) else None
            self._record_read(
                request,
                f"admin.{self.model._meta.model_name}.detail_viewed",
                transaction_obj=transaction_obj,
            )
        return super().change_view(request, object_id, form_url=form_url, extra_context=extra_context)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Wallet)
class WalletAdmin(ReadOnlyAdmin):
    list_display = ("user", "balance_minor", "currency", "updated_at")
    search_fields = ("user__email", "user__full_name")


@admin.register(PaymentTransaction)
class PaymentTransactionAdmin(ReadOnlyAdmin):
    change_list_template = "admin/payments/paymenttransaction/change_list.html"
    list_display = ("reference", "sender", "recipient_name", "amount_minor", "currency", "status", "created_at")
    list_filter = ("status", "kind", "currency", "created_at")
    search_fields = ("reference", "sender__email", "recipient_name", "recipient_identifier")


@admin.register(Recipient)
class RecipientAdmin(ReadOnlyAdmin):
    list_display = ("display_name", "upi_id", "user", "is_active", "is_default")
    search_fields = ("display_name", "upi_id", "user__email")
    list_filter = ("is_active", "is_default")


@admin.register(WalletLedgerEntry)
class WalletLedgerEntryAdmin(ReadOnlyAdmin):
    list_display = ("wallet", "transaction", "entry_type", "amount_minor", "balance_after_minor", "created_at")
    list_filter = ("entry_type", "currency", "created_at")
    search_fields = ("transaction__reference", "wallet__user__email")


@admin.register(TransactionStatusHistory)
class TransactionStatusHistoryAdmin(ReadOnlyAdmin):
    list_display = ("transaction", "from_status", "to_status", "actor", "created_at")
    list_filter = ("to_status", "created_at")
    search_fields = ("transaction__reference", "actor__email")


@admin.register(AuditEvent)
class AuditEventAdmin(ReadOnlyAdmin):
    list_display = ("action", "actor", "transaction", "wallet", "created_at")
    list_filter = ("action", "created_at")
    search_fields = ("action", "actor__email", "transaction__reference")
