from app.config import Settings
from app.providers.frame.base import FrameProvider
from app.providers.frame.passthrough import PassthroughFrameProvider


def create_frame_provider(settings: Settings) -> FrameProvider:
    if settings.frame_provider == "passthrough":
        return PassthroughFrameProvider()
    raise RuntimeError(f"未知的视频帧提供程序：{settings.frame_provider}")
