from providers.base import EmailProvider
from providers.brevo import BrevoProvider
from providers.sendgrid import SendGridProvider
from config import get_settings


def get_email_provider() -> EmailProvider:
    settings = get_settings()
    providers = {
        "brevo": BrevoProvider,
        "sendgrid": SendGridProvider,
    }
    cls = providers.get(settings.email_provider.lower(), BrevoProvider)
    return cls()
