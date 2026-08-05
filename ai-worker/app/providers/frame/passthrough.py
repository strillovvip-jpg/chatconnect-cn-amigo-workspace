import numpy as np

from app.providers.frame.base import FrameProcessingContext


class PassthroughFrameProvider:
    name = "passthrough"

    async def process(
        self,
        rgba: np.ndarray,
        context: FrameProcessingContext,
    ) -> np.ndarray:
        del context
        return rgba
