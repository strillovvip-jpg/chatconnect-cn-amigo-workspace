import numpy as np
import pytest

from app.config import Settings
from app.providers.frame import FrameProcessingContext, create_frame_provider


@pytest.mark.asyncio
async def test_passthrough_provider_is_replaceable_and_does_not_mutate_frame() -> None:
    provider = create_frame_provider(Settings(frame_provider="passthrough"))
    frame = np.zeros((8, 8, 4), dtype=np.uint8)
    result = await provider.process(
        frame,
        FrameProcessingContext(
            room_name="room",
            participant_identity="user",
            frame_number=1,
            tracks=(),
        ),
    )
    assert provider.name == "passthrough"
    assert result is frame
