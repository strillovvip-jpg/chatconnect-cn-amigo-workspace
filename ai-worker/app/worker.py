import asyncio
import json
import logging
import time
from contextlib import suppress

import numpy as np
import psutil
from livekit import rtc
from livekit.agents import AgentServer, AutoSubscribe, JobContext, cli

from app.config import get_settings
from app.face_detection import CpuHaarFaceDetector, FaceDetection, draw_detections
from app.face_tracking import FaceTrack, FaceTrackManager, draw_tracks
from app.providers.frame import FrameProcessingContext, create_frame_provider

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chatconnect.frame_echo")

settings = get_settings()
server = AgentServer()


class FrameEchoSession:
    def __init__(self, room: rtc.Room) -> None:
        self.room = room
        self.tasks: set[asyncio.Task[None]] = set()
        self.closed = asyncio.Event()
        self.process = psutil.Process()
        self.detector = (
            CpuHaarFaceDetector()
            if settings.video_processing_mode in {"face_detect", "face_track"}
            else None
        )
        self.frame_provider = create_frame_provider(settings)

    def subscribe(self, track: rtc.Track, participant: rtc.RemoteParticipant) -> None:
        if track.kind != rtc.TrackKind.KIND_VIDEO:
            return
        task = asyncio.create_task(self.echo_video(track, participant))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def echo_video(
        self,
        track: rtc.Track,
        participant: rtc.RemoteParticipant,
    ) -> None:
        stream = rtc.VideoStream(track)
        source: rtc.VideoSource | None = None
        publication: rtc.LocalTrackPublication | None = None
        frames = 0
        interval_frames = 0
        interval_started_at = time.monotonic()
        processing_total_ms = 0.0
        detection_total_ms = 0.0
        detection_calls = 0
        detections: list[FaceDetection] = []
        tracking_total_ms = 0.0
        tracking_calls = 0
        tracks: list[FaceTrack] = []
        tracker = FaceTrackManager(
            timeout_seconds=settings.face_track_timeout_seconds,
            max_missed_detections=settings.face_track_max_missed_detections,
        )
        fps_window_started_at = time.monotonic()
        fps_window_frames = 0
        render_fps = 0.0
        self.process.cpu_percent(None)
        try:
            async for event in stream:
                received_at = time.perf_counter()
                frame = event.frame.convert(rtc.VideoBufferType.RGBA)
                if source is None:
                    source = rtc.VideoSource(frame.width, frame.height)
                    local_track = rtc.LocalVideoTrack.create_video_track(
                        f"echo-{participant.identity}", source
                    )
                    publication = await self.room.local_participant.publish_track(
                        local_track,
                        rtc.TrackPublishOptions(
                            source=rtc.TrackSource.SOURCE_CAMERA,
                            simulcast=False,
                        ),
                    )
                    logger.info("Published frame echo track %s", publication.sid)

                detection_ms = 0.0
                tracking_ms = 0.0
                output_frame = frame
                if self.detector is not None:
                    rgba = np.frombuffer(frame.data, dtype=np.uint8).reshape(
                        frame.height, frame.width, 4
                    )
                    detection_frame = frames % max(1, settings.face_detection_interval) == 0
                    if detection_frame:
                        detection_started_at = time.perf_counter()
                        detections = self.detector.detect(rgba, settings.face_detection_scale)
                        detection_ms = (time.perf_counter() - detection_started_at) * 1000
                        detection_calls += 1
                    fps_window_frames += 1
                    fps_elapsed = time.monotonic() - fps_window_started_at
                    if fps_elapsed >= 1:
                        render_fps = fps_window_frames / fps_elapsed
                        fps_window_started_at = time.monotonic()
                        fps_window_frames = 0
                    if settings.video_processing_mode == "face_track":
                        tracking_started_at = time.perf_counter()
                        tracks = tracker.update(
                            detections if detection_frame else None,
                            time.monotonic(),
                        )
                        tracking_ms = (time.perf_counter() - tracking_started_at) * 1000
                        tracking_calls += 1
                        provided = await self.frame_provider.process(
                            rgba,
                            FrameProcessingContext(
                                room_name=self.room.name,
                                participant_identity=participant.identity,
                                frame_number=frames,
                                tracks=tuple(tracks),
                            ),
                        )
                        annotated = draw_tracks(provided, tracks, render_fps)
                    else:
                        annotated = draw_detections(rgba, detections)
                    output_frame = rtc.VideoFrame(
                        frame.width,
                        frame.height,
                        rtc.VideoBufferType.RGBA,
                        annotated.tobytes(),
                    )
                source.capture_frame(output_frame)
                processing_ms = (time.perf_counter() - received_at) * 1000
                frames += 1
                interval_frames += 1
                processing_total_ms += processing_ms
                detection_total_ms += detection_ms
                tracking_total_ms += tracking_ms

                now = time.monotonic()
                elapsed = now - interval_started_at
                if elapsed >= 5:
                    logger.info(
                        "FRAME_ECHO_METRICS %s",
                        json.dumps(
                            {
                                "room": self.room.name,
                                "source_participant": participant.identity,
                                "track_sid": publication.sid if publication else None,
                                "frames_total": frames,
                                "fps": round(interval_frames / elapsed, 2),
                                "worker_frame_latency_ms_avg": round(
                                    processing_total_ms / interval_frames, 3
                                ),
                                "face_detection_latency_ms_avg": round(
                                    detection_total_ms / detection_calls, 3
                                )
                                if detection_calls
                                else 0.0,
                                "detect_fps": round(detection_calls / elapsed, 2),
                                "track_fps": round(tracking_calls / elapsed, 2),
                                "face_tracking_latency_ms_avg": round(
                                    tracking_total_ms / tracking_calls, 3
                                )
                                if tracking_calls
                                else 0.0,
                                "tracks": [
                                    {
                                        "face_id": face.track_id,
                                        "x": face.x,
                                        "y": face.y,
                                        "width": face.width,
                                        "height": face.height,
                                        "confidence": face.confidence,
                                        "missed_detections": face.missed_detections,
                                    }
                                    for face in tracks
                                ],
                                "cpu_percent": round(self.process.cpu_percent(None), 1),
                                "memory_rss_mb": round(
                                    self.process.memory_info().rss / 1024 / 1024, 1
                                ),
                                "resolution": f"{frame.width}x{frame.height}",
                                "mode": settings.video_processing_mode,
                                "frame_provider": self.frame_provider.name,
                            },
                            separators=(",", ":"),
                        ),
                    )
                    interval_frames = 0
                    processing_total_ms = 0.0
                    detection_total_ms = 0.0
                    detection_calls = 0
                    tracking_total_ms = 0.0
                    tracking_calls = 0
                    interval_started_at = now
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Frame echo stream failed for %s", participant.identity)
        finally:
            await stream.aclose()
            if publication is not None:
                with suppress(Exception):
                    await self.room.local_participant.unpublish_track(publication.sid)

    async def wait(self) -> None:
        await self.closed.wait()

    async def close(self) -> None:
        self.closed.set()
        for task in tuple(self.tasks):
            task.cancel()
        if self.tasks:
            await asyncio.gather(*self.tasks, return_exceptions=True)


@server.rtc_session(agent_name=settings.livekit_agent_name)
async def frame_echo_worker(ctx: JobContext) -> None:
    await ctx.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_ALL)
    session = FrameEchoSession(ctx.room)

    @ctx.room.on("track_subscribed")
    def on_track_subscribed(
        track: rtc.Track,
        _publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        session.subscribe(track, participant)

    @ctx.room.on("disconnected")
    def on_disconnected() -> None:
        session.closed.set()

    for participant in ctx.room.remote_participants.values():
        for publication in participant.track_publications.values():
            if publication.track is not None:
                session.subscribe(publication.track, participant)

    logger.info("Frame echo worker joined room %s", ctx.room.name)
    try:
        await session.wait()
    finally:
        await session.close()


if __name__ == "__main__":
    cli.run_app(server)
