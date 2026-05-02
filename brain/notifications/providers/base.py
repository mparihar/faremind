from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class EmailResult:
    success: bool
    message_id: Optional[str] = None
    error: Optional[str] = None


class EmailProvider(ABC):
    """Abstract email provider. Implement this to add new providers."""

    @abstractmethod
    async def send_email(
        self,
        to: str,
        subject: str,
        html: str,
        text: str,
        from_name: Optional[str] = None,
        from_email: Optional[str] = None,
    ) -> EmailResult:
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        ...
