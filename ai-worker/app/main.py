from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Response, status
from fastapi.responses import FileResponse

from app.config import Settings, get_settings
from app.models import FaceCreate, FaceRecord, HealthResponse, SwapRequest, SwapResponse
from app.providers import get_provider
from app.store import face_store

app = FastAPI(
    title="ChatConnect 视频处理服务控制接口",
    version="0.1.0",
    description="无模型的视频回传控制服务，不执行 AI 推理。",
)


@app.get("/mobile-echo-test", include_in_schema=False)
async def mobile_echo_test() -> FileResponse:
    return FileResponse(Path(__file__).with_name("mobile_echo_test.html"))


def require_api_token(
    settings: Annotated[Settings, Depends(get_settings)],
    x_worker_token: Annotated[str | None, Header()] = None,
) -> None:
    if settings.worker_api_token and x_worker_token != settings.worker_api_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未获授权")


@app.get("/health", response_model=HealthResponse)
async def health(settings: Annotated[Settings, Depends(get_settings)]) -> HealthResponse:
    return HealthResponse(
        provider=settings.ai_provider,
        livekit_configured=settings.livekit_configured,
    )


@app.get("/faces", response_model=list[FaceRecord], dependencies=[Depends(require_api_token)])
async def list_faces() -> list[FaceRecord]:
    return await face_store.list()


@app.post(
    "/faces",
    response_model=FaceRecord,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_api_token)],
)
async def add_face(face: FaceCreate) -> FaceRecord:
    return await face_store.put(face)


@app.delete(
    "/faces/{face_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_api_token)],
)
async def delete_face(face_id: str) -> Response:
    if not await face_store.delete(face_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到人脸资料")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/swap", response_model=SwapResponse, dependencies=[Depends(require_api_token)])
async def swap(request: SwapRequest) -> SwapResponse:
    try:
        return await get_provider().start(request)
    except RuntimeError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error
