"""Generate a model-free synthetic GIF demonstrating stable Face IDs."""

import math
from pathlib import Path

import numpy as np
from PIL import Image

from app.face_detection import FaceDetection
from app.face_tracking import FaceTrackManager, draw_tracks


def run() -> None:
    tracker = FaceTrackManager(timeout_seconds=3.0, max_missed_detections=45)
    frames: list[Image.Image] = []
    now = 0.0
    for index in range(120):
        now += 1 / 20
        x = round(70 + index * 3.3)
        y = round(155 + math.sin(index / 10) * 55)
        size = round(92 + math.sin(index / 15) * 18)
        detection_frame = index % 2 == 0
        obscured = 54 <= index <= 68
        detections = (
            []
            if obscured and detection_frame
            else [FaceDetection(x, y, size, size, 0.95)]
            if detection_frame
            else None
        )
        tracks = tracker.update(detections, now)
        rgba = np.zeros((420, 640, 4), dtype=np.uint8)
        rgba[:, :, :3] = (12, 18, 30)
        rgba[:, :, 3] = 255
        annotated = draw_tracks(rgba, tracks, 20.0)
        if obscured:
            annotated[130:310, 280:390, :3] = (45, 45, 50)
        image = Image.fromarray(annotated, "RGBA")
        frames.append(image.convert("P", palette=Image.Palette.ADAPTIVE))

    output = Path(__file__).resolve().parents[1] / "artifacts" / "face-track-demo.gif"
    output.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(output, save_all=True, append_images=frames[1:], duration=50, loop=0)
    print(output)


if __name__ == "__main__":
    run()
