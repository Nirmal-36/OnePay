from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    RecipientViewSet,
    TransactionCollectionView,
    TransactionDetailView,
    TransactionReceiptView,
    TransactionReverseView,
    TransactionStatusView,
    WalletTopupView,
    WalletView,
)

router = DefaultRouter()
router.register("recipients", RecipientViewSet, basename="recipient")

urlpatterns = [
    path("wallet/", WalletView.as_view(), name="wallet"),
    path("wallet/topups/", WalletTopupView.as_view(), name="wallet-topups"),
    path("transactions/", TransactionCollectionView.as_view(), name="transactions"),
    path("transactions/<str:reference>/", TransactionDetailView.as_view(), name="transaction-detail"),
    path("transactions/<str:reference>/status/", TransactionStatusView.as_view(), name="transaction-status"),
    path("transactions/<str:reference>/receipt/", TransactionReceiptView.as_view(), name="transaction-receipt"),
    path("transactions/<str:reference>/reverse/", TransactionReverseView.as_view(), name="transaction-reverse"),
    path("", include(router.urls)),
]
