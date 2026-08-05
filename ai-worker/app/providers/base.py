from typing import Protocol

from app.models import SwapRequest, SwapResponse


class Provider(Protocol):
    name: str

    async def start(self, request: SwapRequest) -> SwapResponse: ...
