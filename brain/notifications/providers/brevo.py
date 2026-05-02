import httpx
from providers.base import EmailProvider, EmailResult
from config import get_settings
from typing import Optional


class BrevoProvider(EmailProvider):
    API_URL = "https://api.brevo.com/v3/smtp/email"

    def __init__(self):
        self._settings = get_settings()

    @property
    def name(self) -> str:
        return "brevo"

    async def send_email(
        self,
        to: str,
        subject: str,
        html: str,
        text: str,
        from_name: Optional[str] = None,
        from_email: Optional[str] = None,
    ) -> EmailResult:
        api_key = self._settings.brevo_api_key
        if not api_key:
            return EmailResult(success=False, error="BREVO_API_KEY not configured")

        payload = {
            "sender": {
                "name": from_name or self._settings.brevo_sender_name,
                "email": from_email or self._settings.brevo_sender_email,
            },
            "to": [{"email": to}],
            "subject": subject,
            "htmlContent": html,
            "textContent": text,
        }

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    self.API_URL,
                    json=payload,
                    headers={
                        "api-key": api_key,
                        "Content-Type": "application/json",
                        "accept": "application/json",
                    },
                )
            if resp.status_code in (200, 201):
                body = resp.json()
                return EmailResult(success=True, message_id=body.get("messageId"))
            return EmailResult(
                success=False,
                error=f"Brevo {resp.status_code}: {resp.text[:300]}",
            )
        except Exception as e:
            return EmailResult(success=False, error=str(e))
