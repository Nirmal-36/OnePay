from django.contrib.auth.tokens import PasswordResetTokenGenerator


class AccountPasswordResetTokenGenerator(PasswordResetTokenGenerator):
    key_salt = "onepay.accounts.password_reset"


password_reset_token_generator = AccountPasswordResetTokenGenerator()
