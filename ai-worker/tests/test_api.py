import httpx
import pytest

from app.main import app


@pytest.mark.asyncio
async def test_health_faces_and_mock_swap() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        health = await client.get("/health")
        assert health.status_code == 200
        assert health.json()["processing"] == "frame_echo"

        mobile_test = await client.get("/mobile-echo-test")
        assert mobile_test.status_code == 200
        assert "视频回传移动端测试" in mobile_test.text
        assert "echo-" in mobile_test.text

        created = await client.post(
            "/faces",
            json={
                "face_id": "FACE-API",
                "name": "API Test",
                "image_url": "https://example.com/face.jpg",
            },
        )
        assert created.status_code == 201

        faces = await client.get("/faces")
        assert faces.status_code == 200
        assert any(face["face_id"] == "FACE-API" for face in faces.json())

        swap = await client.post(
            "/swap",
            json={"room_name": "room-1", "participant_identity": "user-1"},
        )
        assert swap.status_code == 200
        assert swap.json()["processed"] is False
        assert swap.json()["mode"] == "mock"

        deleted = await client.delete("/faces/FACE-API")
        assert deleted.status_code == 204
