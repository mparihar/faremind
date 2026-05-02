import httpx
from providers.base import EmailProvider, EmailResult
from config import get_settings
from typing import Optional


class SendGridProvider(EmailProvider):
    API_URL = "https://api.sendgrid.com/v3/mail/send"

    def __init__(self):
        self._settings = get_settings()

    @property
    def name(self) -> str:
        return "sendgrid"

    async def send_email(
        self,
        to: str,
        subject: str,
        html: str,
        text: str,
        from_name: Optional[str] = None,
        from_email: Optional[str] = None,
    ) -> EmailResult:
        api_key = self._settings.sendgrid_api_key
        if not api_key:
            return EmailResult(success=False, error="SENDGRID_API_KEY not configured")

        payload = {
            "personalizations": [{"to": [{"email": to}]}],
            "from": {
                "email": from_email or self._settings.brevo_sender_email,
                "name": from_name or self._settings.brevo_sender_name,
            },
            "subject": subject,
            "content": [
                {"type": "text/plain", "value": text},
                {"type": "text/html", "value": html},
            ],
        }

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    self.API_URL,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                )
            if resp.status_code == 202:
                return EmailResult(
                    success=True,
                    message_id=resp.headers.get("X-Message-Id"),
                )
            return EmailResult(
                success=False,
                error=f"SendGrid {resp.status_code}: {resp.text[:300]}",
            )
        except Exception as e:
            return EmailResult(success=False, error=str(e))
