from datetime import UTC, datetime
from typing import Literal

from pydantic import AnyHttpUrl, BaseModel, Field


class HealthResponse(BaseModel):
    success: bool = True
    status: Literal["ok"] = "ok"
    provider: str
    livekit_configured: bool
    processing: Literal["frame_echo"] = "frame_echo"


class FaceCreate(BaseModel):
    face_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=100)
    image_url: AnyHttpUrl


class FaceRecord(FaceCreate):
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class SwapRequest(BaseModel):
    room_name: str = Field(min_length=1, max_length=128)
    participant_identity: str = Field(min_length=1, max_length=128)
    face_id: str | None = Field(default=None, max_length=128)
    enabled: bool = True


class SwapResponse(BaseModel):
    success: bool = True
    provider: str
    mode: Literal["mock", "frame_echo"]
    processed: bool = False
    room_name: str
    participant_identity: str
    dispatch_id: str | None = None
    message: str
