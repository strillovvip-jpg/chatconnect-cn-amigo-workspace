from app.face_detection import FaceDetection
from app.face_tracking import FaceTrackManager


def face(x: int, y: int, size: int = 80) -> FaceDetection:
    return FaceDetection(x=x, y=y, width=size, height=size, confidence=0.94)


def test_face_id_stays_stable_during_motion_scale_and_short_occlusion() -> None:
    tracker = FaceTrackManager(timeout_seconds=2.0, max_missed_detections=8)
    now = 100.0
    first = tracker.update([face(100, 100)], now)
    assert first[0].track_id == 1

    for frame in range(1, 16):
        now += 1 / 30
        detections = [face(100 + frame * 4, 100 + frame, 80 + frame)] if frame % 2 == 0 else None
        tracks = tracker.update(detections, now)
        assert [track.track_id for track in tracks] == [1]

    for _ in range(12):
        now += 1 / 30
        tracks = tracker.update(None, now)
        assert tracks[0].track_id == 1

    recovered = tracker.update([face(169, 118, 96)], now + 1 / 30)
    assert [track.track_id for track in recovered] == [1]


def test_tracks_expire_and_new_faces_receive_new_ids() -> None:
    tracker = FaceTrackManager(timeout_seconds=0.5, max_missed_detections=2)
    assert tracker.update([face(20, 20)], 10.0)[0].track_id == 1
    tracker.update([], 10.2)
    tracker.update([], 10.4)
    assert tracker.update([], 10.6) == []
    assert tracker.update([face(20, 20)], 10.7)[0].track_id == 2


def test_two_faces_keep_separate_ids() -> None:
    tracker = FaceTrackManager(timeout_seconds=2.0)
    tracks = tracker.update([face(30, 80), face(350, 90)], 1.0)
    assert [track.track_id for track in tracks] == [1, 2]
    tracks = tracker.update([face(45, 82), face(332, 93)], 1.1)
    assert [track.track_id for track in tracks] == [1, 2]
