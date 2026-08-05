"""End-to-end LiveKit frame echo smoke test with synthetic video frames."""

import asyncio
import json
import os
import time
import uuid
from contextlib import suppress

from livekit import api, rtc

WIDTH = 320
HEIGHT = 240
FPS = 15
MIN_ECHO_FRAMES = 10


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def participant_token(
    api_key: str,
    api_secret: str,
    room_name: str,
    identity: str,
) -> str:
    return (
        api.AccessToken(api_key, api_secret)
        .with_identity(identity)
        .with_name(identity)
        .with_grants(api.VideoGrants(room_join=True, room=room_name))
        .to_jwt()
    )


async def run() -> None:
    livekit_url = require_env("LIVEKIT_URL")
    api_key = require_env("LIVEKIT_API_KEY")
    api_secret = require_env("LIVEKIT_API_SECRET")
    agent_name = os.getenv("LIVEKIT_AGENT_NAME", "chatconnect-cn-frame-echo")
    processing_mode = os.getenv("VIDEO_PROCESSING_MODE", "echo")
    room_name = f"frame-echo-{uuid.uuid4().hex[:12]}"
    publisher_identity = f"echo-source-{uuid.uuid4().hex[:8]}"
    receiver_identity = f"echo-receiver-{uuid.uuid4().hex[:8]}"

    publisher = rtc.Room()
    receiver = rtc.Room()
    echo_ready = asyncio.Event()
    received_frames = 0
    first_echo_at: float | None = None
    echo_task: asyncio.Task[None] | None = None

    async def receive_echo(track: rtc.Track) -> None:
        nonlocal received_frames, first_echo_at
        stream = rtc.VideoStream(track)
        try:
            async for event in stream:
                if event.frame.width != WIDTH or event.frame.height != HEIGHT:
                    raise RuntimeError(
                        f"Unexpected echo size {event.frame.width}x{event.frame.height}"
                    )
                if first_echo_at is None:
                    first_echo_at = time.monotonic()
                received_frames += 1
                if received_frames >= MIN_ECHO_FRAMES:
                    echo_ready.set()
                    return
        finally:
            await stream.aclose()

    @receiver.on("track_subscribed")
    def on_track_subscribed(
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        _participant: rtc.RemoteParticipant,
    ) -> None:
        nonlocal echo_task
        if track.kind == rtc.TrackKind.KIND_VIDEO and publication.name.startswith("echo-"):
            echo_task = asyncio.create_task(receive_echo(track))

    await receiver.connect(
        livekit_url,
        participant_token(api_key, api_secret, room_name, receiver_identity),
    )
    await publisher.connect(
        livekit_url,
        participant_token(api_key, api_secret, room_name, publisher_identity),
    )

    source = rtc.VideoSource(WIDTH, HEIGHT)
    camera_track = rtc.LocalVideoTrack.create_video_track("synthetic-camera", source)
    await publisher.local_participant.publish_track(
        camera_track,
        rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_CAMERA, simulcast=False),
    )

    client = api.LiveKitAPI(livekit_url, api_key, api_secret)
    dispatch_started_at = time.monotonic()
    try:
        dispatch = await client.agent_dispatch.create_dispatch(
            api.CreateAgentDispatchRequest(
                agent_name=agent_name,
                room=room_name,
                metadata=json.dumps(
                    {
                        "participant_identity": publisher_identity,
                        "processing": "frame_echo",
                    }
                ),
            )
        )
    finally:
        await client.aclose()

    async def publish_frames() -> None:
        frame_number = 0
        while not echo_ready.is_set():
            # The changing colour proves that a live sequence, not a still frame, is echoed.
            value = frame_number % 256
            rgba = bytes((value, 255 - value, 96, 255)) * (WIDTH * HEIGHT)
            source.capture_frame(rtc.VideoFrame(WIDTH, HEIGHT, rtc.VideoBufferType.RGBA, rgba))
            frame_number += 1
            await asyncio.sleep(1 / FPS)

    publish_task = asyncio.create_task(publish_frames())
    try:
        await asyncio.wait_for(echo_ready.wait(), timeout=30)
        if first_echo_at is None:
            raise RuntimeError("回传轨道已连接，但没有收到视频帧")
        print(
            json.dumps(
                {
                    "success": True,
                    "room": room_name,
                    "dispatch_id": dispatch.id,
                    "echo_frames": received_frames,
                    "resolution": f"{WIDTH}x{HEIGHT}",
                    "dispatch_to_first_frame_ms": round(
                        (first_echo_at - dispatch_started_at) * 1000, 1
                    ),
                    "processed": processing_mode != "echo",
                    "processing_mode": processing_mode,
                }
            )
        )
    finally:
        publish_task.cancel()
        with suppress(asyncio.CancelledError):
            await publish_task
        if echo_task is not None and not echo_task.done():
            echo_task.cancel()
            with suppress(asyncio.CancelledError):
                await echo_task
        await publisher.disconnect()
        await receiver.disconnect()


if __name__ == "__main__":
    asyncio.run(run())
