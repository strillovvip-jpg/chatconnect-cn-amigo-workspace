import json

from livekit import api

from app.config import Settings
from app.models import SwapRequest, SwapResponse


class LiveKitWorkerProvider:
    name = "livekit_worker"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def start(self, request: SwapRequest) -> SwapResponse:
        if not self._settings.livekit_configured:
            raise RuntimeError("尚未配置 LiveKit 环境变量")

        client = api.LiveKitAPI(
            self._settings.livekit_url,
            self._settings.livekit_api_key,
            self._settings.livekit_api_secret,
        )
        try:
            dispatch = await client.agent_dispatch.create_dispatch(
                api.CreateAgentDispatchRequest(
                    agent_name=self._settings.livekit_agent_name,
                    room=request.room_name,
                    metadata=json.dumps(
                        {
                            "participant_identity": request.participant_identity,
                            "face_id": request.face_id,
                            "enabled": request.enabled,
                            "processing": "frame_echo",
                        }
                    ),
                )
            )
        finally:
            await client.aclose()

        return SwapResponse(
            provider=self.name,
            mode="frame_echo",
            room_name=request.room_name,
            participant_identity=request.participant_identity,
            dispatch_id=dispatch.id,
            message="视频回传 Worker 已派发，未启用任何换脸模型。",
        )
