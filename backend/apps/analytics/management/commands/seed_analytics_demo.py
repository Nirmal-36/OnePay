"""Seed clearly simulated OnePay activity so analytics can be explored locally.

This command never contacts a bank or payment network. Every created record is a
OnePay demo transaction. It is intended for local preview deployments only.
"""

from __future__ import annotations

import random
import uuid
from datetime import datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.analytics.models import SavingsGoal, SpendingBudget
from apps.analytics.periods import month_end_exclusive, shift_month
from apps.payments.models import PaymentTransaction
from apps.payments.services import get_or_create_wallet

SEED_PREFIX = "seed-analytics-"

MERCHANTS = (
    ("Swiggy", "swiggy@mock", "Swiggy dinner", 24_000, 72_000),
    ("Zomato", "zomato@mock", "Zomato lunch", 18_000, 55_000),
    ("Local Cafe", "cafe@mock", "Cafe coffee", 8_000, 24_000),
    ("BigBasket", "bigbasket@mock", "BigBasket groceries", 65_000, 180_000),
    ("Blinkit", "blinkit@mock", "Blinkit groceries", 35_000, 95_000),
    ("Uber", "uber@mock", "Uber ride", 12_000, 42_000),
    ("Amazon", "amazon@mock", "Amazon shopping", 45_000, 220_000),
    ("Myntra", "myntra@mock", "Myntra clothing", 60_000, 180_000),
    ("Netflix", "netflix@mock", "Netflix subscription", 19_900, 19_900),
    ("Apollo Pharmacy", "apollo@mock", "Pharmacy medicine", 15_000, 70_000),
    ("Local Salon", "salon@mock", "Salon haircut", 30_000, 60_000),
    ("IndiGo", "indigo@mock", "IndiGo flight", 250_000, 480_000),
)
BILLS = (
    ("electricity", "OnePay Mock Electricity", "electricity bill", 90_000, 210_000),
    ("water", "OnePay Mock Water", "water bill", 25_000, 60_000),
    ("broadband", "OnePay Mock Broadband", "broadband bill", 70_000, 110_000),
)


def _aware(day, hour=13, minute=0):
    return timezone.make_aware(
        datetime.combine(day, time(hour=hour, minute=minute)), timezone.get_current_timezone()
    )


class Command(BaseCommand):
    help = "Create simulated OnePay users, transactions, budgets, and goals for analytics previews."

    def add_arguments(self, parser):
        parser.add_argument("--email", default="demo@onepay.test")
        parser.add_argument("--password", default="OnePay!Demo2026")
        parser.add_argument("--full-name", default="Demo Analyst")
        parser.add_argument("--months", type=int, default=4)
        parser.add_argument("--force", action="store_true", help="Add another batch even if seed data exists.")

    def handle(self, *args, **options):
        User = get_user_model()
        email = options["email"].strip().lower()
        months = max(2, min(int(options["months"]), 12))
        with transaction.atomic():
            user, created = User.objects.get_or_create(
                email=email,
                defaults={"full_name": options["full_name"]},
            )
            if created or options["force"]:
                user.set_password(options["password"])
                user.full_name = options["full_name"]
                user.save()
            get_or_create_wallet(user)

            already_seeded = PaymentTransaction.objects.filter(
                sender=user, idempotency_key__startswith=SEED_PREFIX
            ).exists()
            if already_seeded and not options["force"]:
                self.stdout.write(self.style.WARNING("Seed transactions already exist; skipping."))
            else:
                self._seed_transactions(user, months)

            self._seed_budgets_and_goals(user)
        self.stdout.write(
            self.style.SUCCESS(
                f"Demo analytics ready for {email}. {PaymentTransaction.objects.filter(sender=user).count()} demo "
                "transactions are available. This command never moves real money."
            )
        )

    def _seed_transactions(self, user, months):
        rng = random.Random(20261019)
        today = timezone.localdate()
        current_month = today.replace(day=1)
        batch = uuid.uuid4().hex[:8]
        counter = 0
        for month_offset in range(months - 1, -1, -1):
            month = shift_month(current_month, -month_offset)
            last_day = (month_end_exclusive(month) - timedelta(days=1)).day
            if month == current_month:
                last_day = min(last_day, today.day)
            entries = []
            for label, identifier, note, low, high in MERCHANTS:
                if label in {"IndiGo", "Local Salon"} and rng.random() < 0.55:
                    continue
                entry_count = 2 if label in {"Swiggy", "BigBasket", "Uber"} else 1
                for _ in range(entry_count):
                    entries.append(
                        (
                            rng.randint(1, max(1, last_day)),
                            rng.randint(low, high),
                            PaymentTransaction.Kind.TRANSFER,
                            "",
                            label,
                            identifier,
                            note,
                        )
                    )
            for service, provider, note, low, high in BILLS:
                if rng.random() < 0.35:
                    continue
                entries.append(
                    (
                        rng.randint(1, max(1, last_day)),
                        rng.randint(low, high),
                        PaymentTransaction.Kind.BILL,
                        service,
                        provider,
                        "",
                        note,
                    )
                )
            entries.append(
                (
                    rng.randint(1, max(1, last_day)),
                    rng.choice((19_900, 29_900)),
                    PaymentTransaction.Kind.RECHARGE,
                    "mobile",
                    "OnePay Mock Mobile Alpha",
                    "",
                    "Prepaid recharge",
                )
            )
            entries.sort(key=lambda item: item[0])
            for day, amount, kind, service, recipient_name, recipient_identifier, note in entries:
                counter += 1
                status = PaymentTransaction.Status.SUCCESSFUL
                if month_offset == 0 and counter % 17 == 0:
                    status = PaymentTransaction.Status.PENDING
                created_at = _aware(month.replace(day=day), hour=10 + counter % 10)
                self._create_transaction(
                    user,
                    amount=amount,
                    kind=kind,
                    service=service,
                    recipient_name=recipient_name,
                    recipient_identifier=recipient_identifier,
                    note=note,
                    created_at=created_at,
                    status=status,
                    key=f"{SEED_PREFIX}{batch}-{counter}",
                )

            # Keep one local failed and one reversed outcome for exclusion testing.
            if month_offset in {0, 1}:
                self._create_transaction(
                    user,
                    amount=45_000,
                    kind=PaymentTransaction.Kind.TRANSFER,
                    recipient_name="Failed Demo Merchant",
                    recipient_identifier="decline@onepay",
                    note="Declined demo payment",
                    created_at=_aware(month.replace(day=max(1, last_day - 1))),
                    status=PaymentTransaction.Status.FAILED,
                    key=f"{SEED_PREFIX}{batch}-failed-{month_offset}",
                )
                self._create_transaction(
                    user,
                    amount=75_000,
                    kind=PaymentTransaction.Kind.TRANSFER,
                    recipient_name="Reversed Demo Merchant",
                    recipient_identifier="reversed-demo@mock",
                    note="Reversed demo payment",
                    created_at=_aware(month.replace(day=max(1, last_day - 2))),
                    status=PaymentTransaction.Status.REVERSED,
                    key=f"{SEED_PREFIX}{batch}-reversed-{month_offset}",
                )
            self._create_transaction(
                user,
                amount=100_000,
                kind=PaymentTransaction.Kind.TOPUP,
                recipient_name="OnePay Demo Wallet",
                recipient_identifier="topup@onepay",
                note="Simulated demo funds",
                created_at=_aware(month.replace(day=max(1, min(2, last_day)))),
                status=PaymentTransaction.Status.SUCCESSFUL,
                key=f"{SEED_PREFIX}{batch}-topup-{month_offset}",
            )

    def _create_transaction(
        self,
        user,
        *,
        amount,
        kind,
        recipient_name,
        recipient_identifier,
        note,
        created_at,
        status,
        key,
        service="",
    ):
        transaction = PaymentTransaction.objects.create(
            sender=user,
            sender_name=user.full_name,
            recipient_name=recipient_name,
            recipient_identifier=recipient_identifier,
            kind=kind,
            service=service,
            note=note,
            amount_minor=amount,
            currency="INR",
            status=PaymentTransaction.Status.PENDING,
            idempotency_key=key,
            request_fingerprint=uuid.uuid4().hex,
            created_at=created_at,
        )
        if status == PaymentTransaction.Status.FAILED:
            transaction.record_status_transition(PaymentTransaction.Status.FAILED, actor=user, reason="seeded demo")
        elif status == PaymentTransaction.Status.REVERSED:
            transaction.record_status_transition(PaymentTransaction.Status.SUCCESSFUL, actor=user, reason="seeded demo")
            transaction.refresh_from_db()
            transaction.record_status_transition(PaymentTransaction.Status.REVERSED, actor=user, reason="seeded demo")
        elif status == PaymentTransaction.Status.SUCCESSFUL:
            transaction.record_status_transition(PaymentTransaction.Status.SUCCESSFUL, actor=user, reason="seeded demo")

    def _seed_budgets_and_goals(self, user):
        month = timezone.localdate().replace(day=1)
        budget_values = {
            "": 4_500_000,
            "Food and Dining": 900_000,
            "Groceries": 1_200_000,
            "Shopping": 800_000,
            "Bills and Utilities": 700_000,
            "Transport and Fuel": 450_000,
            "Subscriptions": 120_000,
        }
        for category, limit in budget_values.items():
            SpendingBudget.objects.update_or_create(
                user=user,
                month=month,
                category=category,
                defaults={"limit_minor": limit},
            )
        SavingsGoal.objects.get_or_create(
            user=user,
            name="Emergency fund",
            defaults={
                "target_amount_minor": 10_000_000,
                "saved_amount_minor": 2_500_000,
                "target_date": timezone.localdate() + timedelta(days=180),
                "note": "User-recorded demo savings progress.",
            },
        )
