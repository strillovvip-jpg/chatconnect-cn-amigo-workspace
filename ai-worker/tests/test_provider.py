import pytest

from app.models import SwapRequest
from app.providers.mock import MockProvider


@pytest.mark.asyncio
async def test_mock_provider_never_processes_frames() -> None:
    result = await MockProvider().start(
        SwapRequest(room_name="room-1", participant_identity="user-1")
    )

    assert result.success is True
    assert result.mode == "mock"
    assert result.processed is False
