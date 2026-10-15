import pytest

from apps.accounts.admin import UserChangeForm, UserCreationForm
from apps.accounts.models import User


@pytest.mark.django_db
def test_custom_user_admin_forms_create_and_edit_email_users():
    form = UserCreationForm(data={
        "email": "admin-created@example.test",
        "full_name": "Admin Created",
        "password1": "OnePay!AdminPass2026",
        "password2": "OnePay!AdminPass2026",
        "is_staff": False,
        "is_superuser": False,
    })

    assert form.is_valid(), form.errors
    user = form.save()
    assert isinstance(user, User)
    assert user.check_password("OnePay!AdminPass2026")

    change_form = UserChangeForm(instance=user)
    assert "email" in change_form.fields
    assert "full_name" in change_form.fields
    assert "username" not in change_form.fields
