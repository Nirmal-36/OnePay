from django.urls import path

from .views import SpendingSummaryView, SpendingTransactionsView

urlpatterns = [
    path("summary/", SpendingSummaryView.as_view(), name="spending-summary"),
    path("transactions/", SpendingTransactionsView.as_view(), name="spending-transactions"),
]
