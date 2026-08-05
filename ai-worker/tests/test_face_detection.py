import numpy as np

from app.face_detection import CpuHaarFaceDetector, draw_detections


def test_blank_frame_has_no_face_and_can_be_annotated() -> None:
    frame = np.zeros((240, 320, 4), dtype=np.uint8)
    detections = CpuHaarFaceDetector().detect(frame)
    assert detections == []
    output = draw_detections(frame, detections)
    assert output.shape == frame.shape
    assert output.flags.c_contiguous
