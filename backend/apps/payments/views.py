from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle, UserRateThrottle
from rest_framework.views import APIView

from .models import AuditEvent, PaymentTransaction, Recipient
from .serializers import (
    MockRecipientLookupSerializer,
    PaymentInitiationSerializer,
    PaymentTransactionSerializer,
    RecipientSerializer,
    TopupSerializer,
    WalletSerializer,
)
from .services import (
    create_topup,
    get_or_create_wallet,
    initiate_payment,
    list_recipients,
    lookup_recipient,
    reverse_transaction,
)


class WalletView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        wallet = get_or_create_wallet(request.user)
        return Response(WalletSerializer(wallet).data)


class WalletTopupView(APIView):
    permission_classes = (IsAuthenticated,)
    throttle_classes = (AnonRateThrottle, UserRateThrottle, ScopedRateThrottle)
    throttle_scope = "payment_create"

    def post(self, request):
        serializer = TopupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        transaction_obj = create_topup(
            request.user,
            serializer.validated_data["amount_minor"],
            request.headers.get("Idempotency-Key", ""),
        )
        return Response(PaymentTransactionSerializer(transaction_obj).data, status=status.HTTP_200_OK)


class RecipientViewSet(viewsets.ModelViewSet):
    serializer_class = RecipientSerializer
    permission_classes = (IsAuthenticated,)
    http_method_names = ("get", "post", "put", "patch", "delete", "head", "options")

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        get_or_create_wallet(request.user)

    def get_queryset(self):
        return list_recipients(self.request.user)

    def perform_create(self, serializer):
        wallet = get_or_create_wallet(self.request.user)
        recipient = serializer.save(user=self.request.user)
        AuditEvent.objects.create(
            actor=self.request.user,
            wallet=wallet,
            action="recipient.created",
            metadata={"recipient_id": recipient.pk},
        )

    def perform_update(self, serializer):
        wallet = get_or_create_wallet(self.request.user)
        recipient = serializer.save()
        AuditEvent.objects.create(
            actor=self.request.user,
            wallet=wallet,
            action="recipient.updated",
            metadata={"recipient_id": recipient.pk},
        )

    def perform_destroy(self, instance):
        # Soft deletion preserves default-contact suppression and transaction history.
        instance.is_active = False
        instance.save(update_fields=("is_active", "updated_at"))
        AuditEvent.objects.create(
            actor=self.request.user,
            wallet=get_or_create_wallet(self.request.user),
            action="recipient.removed",
            metadata={"recipient_id": instance.pk},
        )

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        return Response(self.get_serializer(queryset, many=True).data)

    def retrieve(self, request, *args, **kwargs):
        instance = get_object_or_404(self.get_queryset(), pk=kwargs["pk"])
        return Response(self.get_serializer(instance).data)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = get_object_or_404(self.get_queryset(), pk=kwargs["pk"])
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        instance = get_object_or_404(self.get_queryset(), pk=kwargs["pk"])
        self.perform_destroy(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=("get",), url_path="lookup")
    def lookup(self, request):
        recipient = lookup_recipient(request.user, request.query_params.get("identifier", ""))
        if isinstance(recipient, Recipient):
            return Response(RecipientSerializer(recipient).data)
        return Response(MockRecipientLookupSerializer(recipient).data)


class TransactionCollectionView(APIView):
    permission_classes = (IsAuthenticated,)
    throttle_classes = (AnonRateThrottle, UserRateThrottle, ScopedRateThrottle)
    throttle_scope = "payment_create"

    def get(self, request):
        try:
            limit = int(request.query_params.get("limit", "50"))
        except ValueError as exc:
            raise ValidationError({"limit": ["Enter a whole number between 1 and 100."]}) from exc
        if not 1 <= limit <= 100:
            raise ValidationError({"limit": ["Enter a whole number between 1 and 100."]})
        queryset = PaymentTransaction.objects.filter(sender=request.user).prefetch_related("status_history")[:limit]
        return Response(PaymentTransactionSerializer(queryset, many=True).data)

    def post(self, request):
        serializer = PaymentInitiationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        transaction_obj = initiate_payment(
            request.user,
            serializer.validated_data,
            request.headers.get("Idempotency-Key", ""),
        )
        return Response(PaymentTransactionSerializer(transaction_obj).data, status=status.HTTP_200_OK)


class TransactionDetailView(APIView):
    permission_classes = (IsAuthenticated,)

    def get_object(self, request, reference):
        return get_object_or_404(
            PaymentTransaction.objects.prefetch_related("status_history"),
            sender=request.user,
            reference=reference,
        )

    def get(self, request, reference):
        return Response(PaymentTransactionSerializer(self.get_object(request, reference)).data)


class TransactionStatusView(TransactionDetailView):
    def get(self, request, reference):
        transaction_obj = self.get_object(request, reference)
        return Response({
            "reference": transaction_obj.reference,
            "status": transaction_obj.status,
            "updated_at": transaction_obj.updated_at,
            "completed_at": transaction_obj.completed_at,
        })


class TransactionReceiptView(TransactionDetailView):
    def get(self, request, reference):
        transaction_obj = self.get_object(request, reference)
        return Response({
            "transaction": PaymentTransactionSerializer(transaction_obj).data,
            "notice": "This is a OnePay simulated transaction receipt. No real money was transferred.",
        })


class TransactionReverseView(APIView):
    permission_classes = (IsAuthenticated,)
    throttle_classes = (AnonRateThrottle, UserRateThrottle, ScopedRateThrottle)
    throttle_scope = "payment_create"

    def post(self, request, reference):
        transaction_obj = reverse_transaction(
            request.user,
            reference,
            request.headers.get("Idempotency-Key", ""),
        )
        transaction_obj = PaymentTransaction.objects.prefetch_related("status_history").get(pk=transaction_obj.pk)
        return Response(PaymentTransactionSerializer(transaction_obj).data)
