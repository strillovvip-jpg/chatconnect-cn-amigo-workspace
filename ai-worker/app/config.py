from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    ai_provider: Literal["mock", "livekit_worker"] = "mock"
    worker_api_token: str = ""
    livekit_url: str = ""
    livekit_api_key: str = ""
    livekit_api_secret: str = ""
    livekit_agent_name: str = "chatconnect-cn-frame-echo"
    video_processing_mode: Literal["echo", "face_detect", "face_track"] = "face_track"
    face_detection_interval: int = 2
    face_detection_scale: float = 0.5
    face_track_timeout_seconds: float = 3.0
    face_track_max_missed_detections: int = 45
    frame_provider: str = "passthrough"

    @property
    def livekit_configured(self) -> bool:
        return bool(self.livekit_url and self.livekit_api_key and self.livekit_api_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()
