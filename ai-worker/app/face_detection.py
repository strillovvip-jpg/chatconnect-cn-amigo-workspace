from dataclasses import dataclass
from math import exp

import cv2
import numpy as np


@dataclass(frozen=True, slots=True)
class FaceDetection:
    x: int
    y: int
    width: int
    height: int
    confidence: float


class CpuHaarFaceDetector:
    """CPU-only detector using the cascade bundled with OpenCV."""

    def __init__(self) -> None:
        path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self._classifier = cv2.CascadeClassifier(path)
        if self._classifier.empty():
            raise RuntimeError("OpenCV face detector could not be loaded")

    def detect(self, rgba: np.ndarray, scale: float = 0.5) -> list[FaceDetection]:
        scale = min(1.0, max(0.2, scale))
        resized = cv2.resize(rgba, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(resized, cv2.COLOR_RGBA2GRAY)
        boxes, _reject_levels, weights = self._classifier.detectMultiScale3(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(30, 30),
            outputRejectLevels=True,
        )
        inverse = 1 / scale
        detections: list[FaceDetection] = []
        for (x, y, width, height), weight in zip(boxes, weights, strict=False):
            raw_weight = float(weight)
            confidence = 1 / (1 + exp(-raw_weight))
            detections.append(
                FaceDetection(
                    x=round(x * inverse),
                    y=round(y * inverse),
                    width=round(width * inverse),
                    height=round(height * inverse),
                    confidence=round(confidence, 3),
                )
            )
        return detections


def draw_detections(rgba: np.ndarray, detections: list[FaceDetection]) -> np.ndarray:
    output = np.ascontiguousarray(rgba.copy())
    for face in detections:
        start = (face.x, face.y)
        end = (face.x + face.width, face.y + face.height)
        cv2.rectangle(output, start, end, (0, 220, 90, 255), 3)
        label = f"Face {face.confidence:.2f}"
        text_y = max(24, face.y - 8)
        cv2.putText(
            output,
            label,
            (face.x, text_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.65,
            (0, 220, 90, 255),
            2,
            cv2.LINE_AA,
        )
    return output
