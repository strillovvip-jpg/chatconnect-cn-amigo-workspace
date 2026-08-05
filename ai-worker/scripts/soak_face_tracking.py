"""Real-time FaceTrackManager soak test with CPU and memory reporting."""

import argparse
import json
import math
import time
import tracemalloc

import psutil

from app.face_detection import FaceDetection
from app.face_tracking import FaceTrackManager


def run(duration_seconds: int, fps: int) -> None:
    tracker = FaceTrackManager(timeout_seconds=3.0, max_missed_detections=45)
    process = psutil.Process()
    process.cpu_percent(None)
    tracemalloc.start()
    started_at = time.monotonic()
    next_frame_at = started_at
    frames = 0
    stable_id: int | None = None
    id_changes = 0
    missing_track_frames = 0
    samples: list[dict[str, float]] = []

    while time.monotonic() - started_at < duration_seconds:
        frame_started_at = time.perf_counter()
        elapsed = time.monotonic() - started_at
        x = round(260 + math.sin(elapsed * 0.7) * 180)
        y = round(170 + math.cos(elapsed * 0.43) * 70)
        size = round(100 + math.sin(elapsed * 0.31) * 24)
        obscured = int(elapsed) % 20 in {12, 13}
        detection_frame = frames % 2 == 0
        detections = (
            []
            if obscured and detection_frame
            else [FaceDetection(x, y, size, size, 0.94)]
            if detection_frame
            else None
        )
        tracks = tracker.update(detections, time.monotonic())
        if tracks:
            if stable_id is None:
                stable_id = tracks[0].track_id
            elif tracks[0].track_id != stable_id:
                id_changes += 1
                stable_id = tracks[0].track_id
        else:
            missing_track_frames += 1
        frames += 1

        if frames % (fps * 60) == 0:
            current, peak = tracemalloc.get_traced_memory()
            samples.append(
                {
                    "elapsed_seconds": round(elapsed, 1),
                    "rss_mb": round(process.memory_info().rss / 1024 / 1024, 2),
                    "python_heap_mb": round(current / 1024 / 1024, 2),
                    "python_heap_peak_mb": round(peak / 1024 / 1024, 2),
                    "cpu_percent": round(process.cpu_percent(None), 1),
                }
            )

        next_frame_at += 1 / fps
        sleep_for = next_frame_at - time.monotonic()
        if sleep_for > 0:
            time.sleep(sleep_for)
        elif time.perf_counter() - frame_started_at > 1:
            raise RuntimeError("Tracking loop stalled")

    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    rss_values = [sample["rss_mb"] for sample in samples]
    result = {
        "success": id_changes == 0 and missing_track_frames == 0,
        "duration_seconds": round(time.monotonic() - started_at, 1),
        "frames": frames,
        "track_fps": round(frames / (time.monotonic() - started_at), 2),
        "face_id_changes": id_changes,
        "missing_track_frames": missing_track_frames,
        "rss_start_mb": rss_values[0] if rss_values else None,
        "rss_end_mb": rss_values[-1] if rss_values else None,
        "rss_growth_mb": round(rss_values[-1] - rss_values[0], 2) if len(rss_values) > 1 else None,
        "python_heap_end_mb": round(current / 1024 / 1024, 2),
        "python_heap_peak_mb": round(peak / 1024 / 1024, 2),
        "samples": samples,
    }
    print(json.dumps(result, ensure_ascii=False))
    if not result["success"]:
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--duration", type=int, default=1800)
    parser.add_argument("--fps", type=int, default=30)
    args = parser.parse_args()
    run(args.duration, args.fps)
