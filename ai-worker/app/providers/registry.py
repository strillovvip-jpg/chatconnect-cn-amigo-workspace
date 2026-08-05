from functools import lru_cache

from app.config import get_settings
from app.providers.base import Provider
from app.providers.livekit_worker import LiveKitWorkerProvider
from app.providers.mock import MockProvider


@lru_cache
def get_provider() -> Provider:
    settings = get_settings()
    if settings.ai_provider == "livekit_worker":
        return LiveKitWorkerProvider(settings)
    return MockProvider()
