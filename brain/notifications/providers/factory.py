from providers.base import EmailProvider
from providers.brevo import BrevoProvider


def get_email_provider() -> EmailProvider:
    return BrevoProvider()
