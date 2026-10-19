from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .services import build_spending_summary, list_spending_transactions


class SpendingSummaryView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return Response(build_spending_summary(request.user, request.query_params))


class SpendingTransactionsView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return Response(list_spending_transactions(request.user, request.query_params))
