from app.models import SwapRequest, SwapResponse


class MockProvider:
    name = "mock"

    async def start(self, request: SwapRequest) -> SwapResponse:
        return SwapResponse(
            provider=self.name,
            mode="mock",
            room_name=request.room_name,
            participant_identity=request.participant_identity,
            message="当前为模拟模式，未处理任何视频帧。",
        )
