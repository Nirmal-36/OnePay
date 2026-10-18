from datetime import date

from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle, UserRateThrottle
from rest_framework.views import APIView

from apps.notifications.services import notify_recipient_change

from .models import AuditEvent, PaymentTransaction, Recipient
from .serializers import (
    DemoQrGeneratedSerializer,
    DemoQrResolutionSerializer,
    DemoQrResolveSerializer,
    MockRecipientLookupSerializer,
    PaymentInitiationSerializer,
    PaymentTransactionSerializer,
    RecipientSerializer,
    TopupSerializer,
    WalletSerializer,
)
from .services import (
    create_demo_payment_qr,
    create_topup,
    get_or_create_wallet,
    initiate_payment,
    list_recipients,
    lookup_recipient,
    profile_upi_id,
    resolve_demo_payment_qr,
)


class WalletView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        wallet = get_or_create_wallet(request.user)
        return Response(WalletSerializer(wallet).data)


class DemoQrGenerateView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        upi_id = profile_upi_id(request.user)
        result = DemoQrGeneratedSerializer({
            "qr_content": create_demo_payment_qr(request.user),
            "display_name": request.user.full_name,
            "upi_id": upi_id,
            "currency": "INR",
            "mode": "demo",
        })
        return Response(result.data, status=status.HTTP_200_OK)


class DemoQrResolveView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        serializer = DemoQrResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        resolution = resolve_demo_payment_qr(request.user, serializer.validated_data["qr_content"])
        return Response(DemoQrResolutionSerializer(resolution).data, status=status.HTTP_200_OK)


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
        with transaction.atomic():
            wallet = get_or_create_wallet(self.request.user)
            recipient = serializer.save(user=self.request.user)
            audit = AuditEvent.objects.create(
                actor=self.request.user,
                wallet=wallet,
                action="recipient.created",
                metadata={"recipient_id": recipient.pk},
            )
            notify_recipient_change(
                self.request.user,
                "created",
                f"recipient:{recipient.pk}:audit:{audit.pk}",
            )

    def perform_update(self, serializer):
        instance = serializer.instance
        has_changes = any(
            getattr(instance, field) != value
            for field, value in serializer.validated_data.items()
        )
        if not has_changes:
            return
        with transaction.atomic():
            wallet = get_or_create_wallet(self.request.user)
            recipient = serializer.save()
            audit = AuditEvent.objects.create(
                actor=self.request.user,
                wallet=wallet,
                action="recipient.updated",
                metadata={"recipient_id": recipient.pk},
            )
            notify_recipient_change(
                self.request.user,
                "updated",
                f"recipient:{recipient.pk}:audit:{audit.pk}",
            )

    def perform_destroy(self, instance):
        # Soft deletion preserves default-contact suppression and transaction history.
        with transaction.atomic():
            instance.is_active = False
            instance.save(update_fields=("is_active", "updated_at"))
            audit = AuditEvent.objects.create(
                actor=self.request.user,
                wallet=get_or_create_wallet(self.request.user),
                action="recipient.removed",
                metadata={"recipient_id": instance.pk},
            )
            notify_recipient_change(
                self.request.user,
                "removed",
                f"recipient:{instance.pk}:audit:{audit.pk}",
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


class TransactionHistoryView(APIView):
    """Return a filtered, paginated view of the caller's own demo ledger."""

    permission_classes = (IsAuthenticated,)

    def get(self, request):
        params = request.query_params
        queryset = PaymentTransaction.objects.filter(sender=request.user).prefetch_related("status_history")

        search = params.get("search", "").strip()
        if len(search) > 100:
            raise ValidationError({"search": ["Use at most 100 characters."]})
        if search:
            queryset = queryset.filter(
                Q(reference__icontains=search)
                | Q(recipient_name__icontains=search)
                | Q(recipient_identifier__icontains=search)
                | Q(note__icontains=search)
                | Q(service__icontains=search)
            )

        status_filter = params.get("status", "").strip()
        if status_filter:
            if status_filter not in PaymentTransaction.Status.values:
                raise ValidationError({"status": ["Choose pending, successful, failed, or reversed."]})
            queryset = queryset.filter(status=status_filter)

        category = params.get("category", "").strip()
        if category:
            if category not in PaymentTransaction.Kind.values:
                raise ValidationError({"category": ["Choose transfer, bill, recharge, or topup."]})
            queryset = queryset.filter(kind=category)

        direction = params.get("direction", "").strip()
        if direction == "credit":
            queryset = queryset.filter(Q(kind=PaymentTransaction.Kind.TOPUP) | Q(status=PaymentTransaction.Status.REVERSED))
        elif direction == "debit":
            queryset = queryset.exclude(kind=PaymentTransaction.Kind.TOPUP).exclude(status=PaymentTransaction.Status.REVERSED)
        elif direction:
            raise ValidationError({"direction": ["Choose debit or credit."]})

        parsed_dates = {}
        for parameter, lookup in (("date_from", "created_at__date__gte"), ("date_to", "created_at__date__lte")):
            raw_value = params.get(parameter, "").strip()
            if not raw_value:
                continue
            try:
                parsed_dates[parameter] = date.fromisoformat(raw_value)
            except ValueError as exc:
                raise ValidationError({parameter: ["Use a date in YYYY-MM-DD format."]}) from exc
            queryset = queryset.filter(**{lookup: parsed_dates[parameter]})
        if parsed_dates.get("date_from") and parsed_dates.get("date_to") and parsed_dates["date_from"] > parsed_dates["date_to"]:
            raise ValidationError({"date_to": ["The end date must be on or after the start date."]})

        amount_filters = {}
        for parameter, lookup in (("min_amount_minor", "amount_minor__gte"), ("max_amount_minor", "amount_minor__lte")):
            raw_value = params.get(parameter, "").strip()
            if not raw_value:
                continue
            try:
                amount = int(raw_value)
            except ValueError as exc:
                raise ValidationError({parameter: ["Enter a whole number of INR paise."]}) from exc
            if amount < 0:
                raise ValidationError({parameter: ["The amount cannot be negative."]})
            amount_filters[parameter] = amount
            queryset = queryset.filter(**{lookup: amount})
        if (
            amount_filters.get("min_amount_minor") is not None
            and amount_filters.get("max_amount_minor") is not None
            and amount_filters["min_amount_minor"] > amount_filters["max_amount_minor"]
        ):
            raise ValidationError({"max_amount_minor": ["The maximum amount must be at least the minimum amount."]})

        def positive_integer(name, default, maximum):
            raw_value = params.get(name, "").strip()
            if not raw_value:
                return default
            try:
                value = int(raw_value)
            except ValueError as exc:
                raise ValidationError({name: ["Enter a whole number."]}) from exc
            if not 1 <= value <= maximum:
                raise ValidationError({name: [f"Enter a number between 1 and {maximum}."]})
            return value

        page_number = positive_integer("page", 1, 1_000_000)
        page_size = positive_integer("page_size", 10, 50)
        paginator = Paginator(queryset, page_size)
        total_pages = paginator.num_pages if paginator.count else 0
        if page_number > max(total_pages, 1):
            raise NotFound("The requested transaction-history page does not exist.")
        page = paginator.page(page_number)
        return Response({
            "count": paginator.count,
            "page": page.number,
            "page_size": page_size,
            "total_pages": total_pages,
            "has_next": page.has_next(),
            "has_previous": page.has_previous(),
            "results": PaymentTransactionSerializer(page.object_list, many=True).data,
        })


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
    """Keep the legacy URL explicit, but never reverse a customer transaction here."""

    permission_classes = (IsAuthenticated,)
    throttle_classes = (AnonRateThrottle, UserRateThrottle, ScopedRateThrottle)
    throttle_scope = "payment_create"

    def post(self, request, reference):
        # Reversal is an internal ledger operation only. Do not inspect client-supplied
        # ownership, status, amount, or idempotency data, and never call that service
        # from a customer-facing request. Returning 403 also avoids reference probing.
        return Response(
            {"detail": "Customer-initiated transaction reversals are not permitted."},
            status=status.HTTP_403_FORBIDDEN,
        )
