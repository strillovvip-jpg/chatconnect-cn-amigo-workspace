# Face Track Performance Report

## Scope

CPU-only geometric face tracking. No Face Swap, AI identity model, CUDA, PyTorch, GPU,
RunPod, FaceFusion, InsightFace, or Deep-Live-Cam was used.

## LiveKit verification

- LiveKit Cloud region: Japan
- Processing mode: `face_track`
- Echo frames received by independent receiver: 10
- Resolution: 320×240
- Dispatch-to-first-frame: 3,807.5 ms, including cold worker process startup
- Processed track received successfully: yes

## Real-time 30-minute stability test

- Duration: 1,800.0 seconds
- Target and measured rate: 30.0 FPS
- Frames processed: 54,000
- Simulated motion: horizontal, vertical, forward/backward scale changes
- Simulated occlusion: two seconds every twenty seconds
- Face ID changes: 0
- Missing-track frames: 0
- RSS at first minute: 48.69 MB
- RSS at completion: 33.45 MB
- RSS growth: −15.24 MB
- Python heap peak: 0.01 MB
- CPU samples: approximately 1.0–1.4%
- Memory leak observed: no

The soak test measures `FaceTrackManager` independently at real wall-clock speed. LiveKit
metrics additionally report detection FPS, track FPS, detection latency, tracking latency,
CPU and RSS every five seconds when the Worker handles a real room.

## First-run defect and correction

The first 30-minute run exposed an overly aggressive occlusion timeout and produced 90
Face ID changes. The tracker was corrected to damp predicted velocity while occluded and
retain unmatched tracks for up to three seconds / 45 detection misses. The complete
30-minute test was then repeated from the beginning and passed with zero ID changes.

## Limitations

The current association is geometric and has no appearance embedding. It is stable for
ordinary movement, scale changes, mild pose changes and short occlusion, but two similar
faces crossing tightly may still exchange IDs. Solving that robustly requires a future
appearance/re-identification stage and is intentionally outside this model-free phase.
