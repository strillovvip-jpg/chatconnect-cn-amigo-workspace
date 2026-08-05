from dataclasses import dataclass
from math import hypot

import cv2
import numpy as np

from app.face_detection import FaceDetection


@dataclass(frozen=True, slots=True)
class FaceTrack:
    track_id: int
    x: int
    y: int
    width: int
    height: int
    confidence: float
    missed_detections: int


@dataclass(slots=True)
class _TrackState:
    track_id: int
    x: float
    y: float
    width: float
    height: float
    confidence: float
    velocity_x: float
    velocity_y: float
    velocity_width: float
    velocity_height: float
    last_update_at: float
    last_detection_at: float
    missed_detections: int = 0


def _intersection_over_union(track: _TrackState, detection: FaceDetection) -> float:
    left = max(track.x, detection.x)
    top = max(track.y, detection.y)
    right = min(track.x + track.width, detection.x + detection.width)
    bottom = min(track.y + track.height, detection.y + detection.height)
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    union = track.width * track.height + detection.width * detection.height - intersection
    return intersection / union if union > 0 else 0.0


class FaceTrackManager:
    """Lightweight CPU multi-face tracker with stable session-local IDs."""

    def __init__(
        self,
        *,
        timeout_seconds: float = 3.0,
        max_missed_detections: int = 45,
        match_distance_ratio: float = 3.0,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.max_missed_detections = max_missed_detections
        self.match_distance_ratio = match_distance_ratio
        self._tracks: dict[int, _TrackState] = {}
        self._next_id = 1

    def update(
        self,
        detections: list[FaceDetection] | None,
        now: float,
    ) -> list[FaceTrack]:
        self._predict(now)
        if detections is not None:
            self._associate(detections, now)
        self._expire(now)
        return self.snapshot()

    def _predict(self, now: float) -> None:
        for track in self._tracks.values():
            elapsed = min(0.25, max(0.0, now - track.last_update_at))
            track.x += track.velocity_x * elapsed
            track.y += track.velocity_y * elapsed
            track.width = max(8.0, track.width + track.velocity_width * elapsed)
            track.height = max(8.0, track.height + track.velocity_height * elapsed)
            if track.missed_detections:
                # Avoid unbounded extrapolation while the face is temporarily occluded.
                track.velocity_x *= 0.9
                track.velocity_y *= 0.9
                track.velocity_width *= 0.9
                track.velocity_height *= 0.9
            track.last_update_at = now

    def _associate(self, detections: list[FaceDetection], now: float) -> None:
        candidates: list[tuple[float, int, int]] = []
        for track_id, track in self._tracks.items():
            track_center = (track.x + track.width / 2, track.y + track.height / 2)
            for detection_index, detection in enumerate(detections):
                detection_center = (
                    detection.x + detection.width / 2,
                    detection.y + detection.height / 2,
                )
                distance = hypot(
                    track_center[0] - detection_center[0],
                    track_center[1] - detection_center[1],
                )
                size = max(track.width, track.height, detection.width, detection.height)
                iou = _intersection_over_union(track, detection)
                if iou < 0.03 and distance > size * self.match_distance_ratio:
                    continue
                cost = distance / max(size, 1.0) + (1.0 - iou) * 0.45
                candidates.append((cost, track_id, detection_index))

        matched_tracks: set[int] = set()
        matched_detections: set[int] = set()
        for _cost, track_id, detection_index in sorted(candidates):
            if track_id in matched_tracks or detection_index in matched_detections:
                continue
            self._correct(self._tracks[track_id], detections[detection_index], now)
            matched_tracks.add(track_id)
            matched_detections.add(detection_index)

        for track_id, track in self._tracks.items():
            if track_id not in matched_tracks:
                track.missed_detections += 1
                track.confidence *= 0.96

        for detection_index, detection in enumerate(detections):
            if detection_index not in matched_detections:
                self._create(detection, now)

    def _correct(self, track: _TrackState, detection: FaceDetection, now: float) -> None:
        elapsed = max(1 / 120, now - track.last_detection_at)
        measured_velocity_x = (detection.x - track.x) / elapsed
        measured_velocity_y = (detection.y - track.y) / elapsed
        measured_velocity_width = (detection.width - track.width) / elapsed
        measured_velocity_height = (detection.height - track.height) / elapsed
        velocity_weight = 0.3
        track.velocity_x = (
            track.velocity_x * (1 - velocity_weight) + measured_velocity_x * velocity_weight
        )
        track.velocity_y = (
            track.velocity_y * (1 - velocity_weight) + measured_velocity_y * velocity_weight
        )
        track.velocity_width = (
            track.velocity_width * (1 - velocity_weight) + measured_velocity_width * velocity_weight
        )
        track.velocity_height = (
            track.velocity_height * (1 - velocity_weight)
            + measured_velocity_height * velocity_weight
        )
        correction_weight = 0.72
        track.x = track.x * (1 - correction_weight) + detection.x * correction_weight
        track.y = track.y * (1 - correction_weight) + detection.y * correction_weight
        track.width = track.width * (1 - correction_weight) + detection.width * correction_weight
        track.height = track.height * (1 - correction_weight) + detection.height * correction_weight
        track.confidence = detection.confidence
        track.last_detection_at = now
        track.missed_detections = 0

    def _create(self, detection: FaceDetection, now: float) -> None:
        track_id = self._next_id
        self._next_id += 1
        self._tracks[track_id] = _TrackState(
            track_id=track_id,
            x=float(detection.x),
            y=float(detection.y),
            width=float(detection.width),
            height=float(detection.height),
            confidence=detection.confidence,
            velocity_x=0.0,
            velocity_y=0.0,
            velocity_width=0.0,
            velocity_height=0.0,
            last_update_at=now,
            last_detection_at=now,
        )

    def _expire(self, now: float) -> None:
        expired = [
            track_id
            for track_id, track in self._tracks.items()
            if track.missed_detections > self.max_missed_detections
            or now - track.last_detection_at > self.timeout_seconds
        ]
        for track_id in expired:
            del self._tracks[track_id]

    def snapshot(self) -> list[FaceTrack]:
        return [
            FaceTrack(
                track_id=track.track_id,
                x=round(track.x),
                y=round(track.y),
                width=round(track.width),
                height=round(track.height),
                confidence=round(track.confidence, 3),
                missed_detections=track.missed_detections,
            )
            for track in sorted(self._tracks.values(), key=lambda item: item.track_id)
        ]


def draw_tracks(rgba: np.ndarray, tracks: list[FaceTrack], fps: float) -> np.ndarray:
    output = np.ascontiguousarray(rgba.copy())
    cv2.putText(
        output,
        f"FPS {fps:.1f}",
        (18, 32),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.75,
        (255, 210, 30, 255),
        2,
        cv2.LINE_AA,
    )
    for track in tracks:
        colour = (0, 220, 90, 255)
        cv2.rectangle(
            output,
            (track.x, track.y),
            (track.x + track.width, track.y + track.height),
            colour,
            3,
        )
        label = f"ID {track.track_id}  {track.confidence:.2f}"
        cv2.putText(
            output,
            label,
            (track.x, max(58, track.y - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.62,
            colour,
            2,
            cv2.LINE_AA,
        )
    return output
