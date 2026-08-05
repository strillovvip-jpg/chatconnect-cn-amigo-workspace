from dataclasses import dataclass
from typing import Protocol

import numpy as np

from app.face_tracking import FaceTrack


@dataclass(frozen=True, slots=True)
class FrameProcessingContext:
    room_name: str
    participant_identity: str
    frame_number: int
    tracks: tuple[FaceTrack, ...]


class FrameProvider(Protocol):
    """Replaceable boundary for any future per-frame model or remote inference service."""

    name: str

    async def process(
        self,
        rgba: np.ndarray,
        context: FrameProcessingContext,
    ) -> np.ndarray: ...
