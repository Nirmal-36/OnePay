from django.contrib import admin

from .models import AuditEvent, PaymentTransaction, Recipient, TransactionStatusHistory, Wallet, WalletLedgerEntry


class ReadOnlyAdmin(admin.ModelAdmin):
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
