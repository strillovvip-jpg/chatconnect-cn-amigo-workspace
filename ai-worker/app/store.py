import asyncio

from app.models import FaceCreate, FaceRecord


class FaceStore:
    """Phase-two metadata store. ChatConnect remains the image source of truth."""

    def __init__(self) -> None:
        self._faces: dict[str, FaceRecord] = {}
        self._lock = asyncio.Lock()

    async def list(self) -> list[FaceRecord]:
        async with self._lock:
            return sorted(self._faces.values(), key=lambda face: face.created_at)

    async def put(self, value: FaceCreate) -> FaceRecord:
        async with self._lock:
            record = FaceRecord(**value.model_dump())
            self._faces[value.face_id] = record
            return record

    async def delete(self, face_id: str) -> bool:
        async with self._lock:
            return self._faces.pop(face_id, None) is not None


face_store = FaceStore()
