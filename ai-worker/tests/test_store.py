import pytest

from app.models import FaceCreate
from app.store import FaceStore


@pytest.mark.asyncio
async def test_face_store_add_list_delete() -> None:
    store = FaceStore()
    face = FaceCreate(face_id="FACE-TOM", name="Tom", image_url="https://example.com/tom.jpg")

    created = await store.put(face)
    assert created.face_id == "FACE-TOM"
    assert await store.list() == [created]
    assert await store.delete("FACE-TOM") is True
    assert await store.delete("FACE-TOM") is False
