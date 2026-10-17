from rest_framework import serializers

from .models import PaymentTransaction, Recipient, TransactionStatusHistory, Wallet
from .services import (
    MAX_PAYMENT_MINOR,
    TOPUP_AMOUNTS_MINOR,
    parse_demo_payment_qr,
    validate_mock_upi_id,
)

BILL_SERVICES = ("electricity", "water", "gas", "broadband")
RECHARGE_SERVICES = ("mobile", "dth")
ALL_SERVICES = RECHARGE_SERVICES + BILL_SERVICES


class WalletSerializer(serializers.ModelSerializer):
    balance_minor = serializers.IntegerField(read_only=True)

    class Meta:
        model = Wallet
        fields = ("balance_minor", "currency", "updated_at")
        read_only_fields = fields


class RecipientSerializer(serializers.ModelSerializer):
    class Meta:
        model = Recipient
        fields = ("id", "display_name", "upi_id", "is_default", "created_at", "updated_at")
        read_only_fields = ("id", "is_default", "created_at", "updated_at")

    def validate_display_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Enter at least 2 characters.")
        return value

    def validate_upi_id(self, value):
        return validate_mock_upi_id(value)

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        upi_id = attrs.get("upi_id", getattr(self.instance, "upi_id", None))
        if user and upi_id:
            existing = Recipient.objects.filter(user=user, upi_id=upi_id)
            if self.instance:
                existing = existing.exclude(pk=self.instance.pk)
            if existing.exists():
                raise serializers.ValidationError({"upi_id": ["This mock UPI ID is already in your recipients."]})
        return attrs


class MockRecipientLookupSerializer(serializers.Serializer):
    id = serializers.IntegerField(allow_null=True)
    display_name = serializers.CharField()
    upi_id = serializers.CharField()
    is_active = serializers.BooleanField()
    is_default = serializers.BooleanField()


class DemoQrResolveSerializer(serializers.Serializer):
    qr_content = serializers.CharField(max_length=512, allow_blank=False, trim_whitespace=False)

    def validate_qr_content(self, value):
        parse_demo_payment_qr(value)
        return value


class DemoQrResolutionSerializer(serializers.Serializer):
    recipient_id = serializers.IntegerField(allow_null=True)
    display_name = serializers.CharField()
    upi_id = serializers.CharField()
    currency = serializers.CharField()
    mode = serializers.CharField()
    verified = serializers.BooleanField()


class DemoQrGeneratedSerializer(serializers.Serializer):
    qr_content = serializers.CharField()
    display_name = serializers.CharField()
    upi_id = serializers.CharField()
    currency = serializers.CharField()
    mode = serializers.CharField()


class PaymentInitiationSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(
        choices=(PaymentTransaction.Kind.TRANSFER, PaymentTransaction.Kind.BILL, PaymentTransaction.Kind.RECHARGE)
    )
    amount_minor = serializers.IntegerField(min_value=1, max_value=MAX_PAYMENT_MINOR)
    recipient_id = serializers.IntegerField(required=False, min_value=1)
    upi_id = serializers.CharField(required=False, max_length=64, allow_blank=False, trim_whitespace=True)
    qr_content = serializers.CharField(required=False, max_length=512, allow_blank=False, trim_whitespace=False)
    service = serializers.ChoiceField(choices=ALL_SERVICES, required=False)
    recipient_reference = serializers.CharField(required=False, max_length=64, allow_blank=True, trim_whitespace=True)
    note = serializers.CharField(required=False, max_length=80, allow_blank=True, trim_whitespace=True)

    def validate_upi_id(self, value):
        return validate_mock_upi_id(value)

    def validate(self, attrs):
        kind = attrs["kind"]
        if kind == PaymentTransaction.Kind.TRANSFER:
            recipient_choices = sum((
                attrs.get("recipient_id") is not None,
                attrs.get("upi_id") is not None,
                attrs.get("qr_content") is not None,
            ))
            if recipient_choices != 1:
                raise serializers.ValidationError({
                    "recipient_id": ["Choose exactly one saved recipient, mock UPI ID, or signed OnePay QR."],
                    "upi_id": ["Choose exactly one saved recipient, mock UPI ID, or signed OnePay QR."],
                    "qr_content": ["Choose exactly one saved recipient, mock UPI ID, or signed OnePay QR."],
                })
            if attrs.get("qr_content") is not None:
                parse_demo_payment_qr(attrs["qr_content"])
            if attrs.get("service") or attrs.get("recipient_reference"):
                raise serializers.ValidationError({"kind": ["Bill or recharge details are not valid for a transfer."]})
        else:
            if (
                attrs.get("recipient_id") is not None
                or attrs.get("upi_id") is not None
                or attrs.get("qr_content") is not None
            ):
                raise serializers.ValidationError({"recipient_id": ["Recipient IDs and OnePay QR data are only used for person-to-person transfers."]})
            service = attrs.get("service")
            if service is None:
                raise serializers.ValidationError({"service": ["Choose a supported demo bill or recharge service."]})
            if kind == PaymentTransaction.Kind.RECHARGE and service not in RECHARGE_SERVICES:
                raise serializers.ValidationError({"service": ["Choose Mobile or DTH for a recharge."]})
            if kind == PaymentTransaction.Kind.BILL and service not in BILL_SERVICES:
                raise serializers.ValidationError({"service": ["Choose an available utility bill service."]})
        if attrs.get("note"):
            attrs["note"] = attrs["note"].strip()
        if attrs.get("recipient_reference"):
            attrs["recipient_reference"] = attrs["recipient_reference"].strip()
        return attrs


class TopupSerializer(serializers.Serializer):
    amount_minor = serializers.ChoiceField(choices=tuple((amount, amount) for amount in TOPUP_AMOUNTS_MINOR))

    def to_internal_value(self, data):
        values = super().to_internal_value(data)
        values["amount_minor"] = int(values["amount_minor"])
        return values


class TransactionStatusHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = TransactionStatusHistory
        fields = ("from_status", "to_status", "reason", "created_at")
        read_only_fields = fields


class PaymentTransactionSerializer(serializers.ModelSerializer):
    recipient_id = serializers.IntegerField(read_only=True, allow_null=True)
    status_history = TransactionStatusHistorySerializer(many=True, read_only=True)

    class Meta:
        model = PaymentTransaction
        fields = (
            "id",
            "reference",
            "sender_name",
            "recipient_id",
            "recipient_name",
            "recipient_identifier",
            "kind",
            "service",
            "note",
            "amount_minor",
            "currency",
            "status",
            "created_at",
            "updated_at",
            "completed_at",
            "status_history",
        )
        read_only_fields = fields
