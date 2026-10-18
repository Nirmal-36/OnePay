from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.contrib.auth.forms import UserChangeForm as DjangoUserChangeForm
from django.contrib.auth.forms import UserCreationForm as DjangoUserCreationForm

from apps.payments.models import AuditEvent

from .models import User


class UserCreationForm(DjangoUserCreationForm):
    class Meta(DjangoUserCreationForm.Meta):
        model = User
        fields = ("email", "full_name", "is_active", "is_staff", "is_superuser")


class UserChangeForm(DjangoUserChangeForm):
    class Meta(DjangoUserChangeForm.Meta):
        model = User
        fields = "__all__"


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    form = UserChangeForm
    add_form = UserCreationForm
    ordering = ("email",)
    list_display = ("email", "full_name", "is_staff", "is_active", "date_joined")
    search_fields = ("email", "full_name")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Profile", {"fields": ("full_name",)}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("email", "full_name", "password1", "password2", "is_active", "is_staff", "is_superuser"),
        }),
    )
    readonly_fields = ("date_joined", "last_login")
    filter_horizontal = ("groups", "user_permissions")
    protected_permission_fields = {"is_active", "is_staff", "is_superuser", "groups", "user_permissions"}

    def get_fieldsets(self, request, obj=None):
        fieldsets = super().get_fieldsets(request, obj)
        if request.user.is_superuser:
            return fieldsets
        restricted = []
        for name, options in fieldsets:
            fields = tuple(field for field in options["fields"] if field not in self.protected_permission_fields)
            if fields:
                restricted.append((name, {**options, "fields": fields}))
        return tuple(restricted)

    def save_model(self, request, obj, form, change):
        before = User.objects.get(pk=obj.pk) if change else None
        super().save_model(request, obj, form, change)
        if not change and (obj.is_staff or obj.is_superuser):
            AuditEvent.objects.create(
                actor=request.user,
                action="admin.user.privileged_created",
                metadata={"target_user_id": obj.pk, "changed_fields": ["is_staff", "is_superuser"]},
            )
        elif before is not None:
            changed_fields = [
                field
                for field in ("is_active", "is_staff", "is_superuser")
                if getattr(before, field) != getattr(obj, field)
            ]
            if changed_fields:
                AuditEvent.objects.create(
                    actor=request.user,
                    action="admin.user.permissions_changed",
                    metadata={"target_user_id": obj.pk, "changed_fields": changed_fields},
                )

    def save_related(self, request, form, formsets, change):
        user = form.instance
        before_groups = set(user.groups.values_list("pk", flat=True))
        before_permissions = set(user.user_permissions.values_list("pk", flat=True))
        super().save_related(request, form, formsets, change)
        changed_fields = []
        if before_groups != set(user.groups.values_list("pk", flat=True)):
            changed_fields.append("groups")
        if before_permissions != set(user.user_permissions.values_list("pk", flat=True)):
            changed_fields.append("user_permissions")
        if changed_fields:
            AuditEvent.objects.create(
                actor=request.user,
                action="admin.user.permissions_changed",
                metadata={"target_user_id": user.pk, "changed_fields": changed_fields},
            )
