# ChatConnect AI Worker — Frame Echo, CPU Face Detect and Face Track

This is an independent Python service for validating the LiveKit server-side video path before any model is introduced. It does **not** perform face detection, face swapping, AI inference, CUDA processing, or GPU processing.

## What is included

- Python 3.11+
- FastAPI control API
- Switchable `MockProvider` and `LiveKitWorkerProvider`
- LiveKit named agent worker
- Async frame echo: subscribe to a remote video track and publish the same frames back
- Optional CPU face detection with bounding boxes and normalized confidence labels
- Stable session-local Face IDs with motion prediction and short-occlusion recovery
- Runtime telemetry every five seconds: FPS, processing/detection latency, CPU, resolution
- In-memory face metadata registry for integration testing

## What is deliberately excluded

- Face-swap models
- Model downloads
- CUDA, PyTorch, TensorRT, GPU support
- RunPod and Docker
- Changes to the production ChatConnect application

## Directory

```text
ai-worker/
├── app/
│   ├── main.py                 # FastAPI application
│   ├── worker.py               # LiveKit frame echo worker
│   ├── config.py               # Environment configuration
│   ├── models.py               # API schemas
│   ├── store.py                # Phase-two in-memory face metadata
│   └── providers/
│       ├── base.py
│       ├── mock.py
│       ├── livekit_worker.py
│       └── registry.py
├── tests/
├── .env.example
└── pyproject.toml
```

## Local setup

Create an isolated environment from the `ai-worker` directory:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
cp .env.example .env
```

Windows PowerShell activation:

```powershell
.venv\Scripts\Activate.ps1
```

No model or GPU package is installed by this project.

## Start the API in Mock mode

Set `AI_PROVIDER=mock` in `.env`, then run:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8090 --reload
```

Check health:

```bash
curl http://127.0.0.1:8090/health
```

If `WORKER_API_TOKEN` is configured, send it as `X-Worker-Token` to `/faces` and `/swap`.

## API

### `GET /health`

Returns the selected provider, LiveKit configuration status, and `frame_echo` processing mode.

### `GET /faces`

Lists face metadata registered for integration testing. Photos remain stored by ChatConnect; this endpoint stores URLs and metadata only, in memory.

### `POST /faces`

```json
{
  "face_id": "FACE-TOM",
  "name": "Tom",
  "image_url": "https://example.com/tom.jpg"
}
```

### `DELETE /faces/{face_id}`

Deletes in-memory metadata. It does not delete the source image from ChatConnect.

### `POST /swap`

The route name is reserved for compatibility. In this phase it either returns a Mock response or dispatches the frame echo worker. It never swaps a face.

```json
{
  "room_name": "call-room-name",
  "participant_identity": "authorization-code-or-user-id",
  "face_id": "FACE-TOM",
  "enabled": true
}
```

## Start LiveKit frame echo

1. Configure `.env`:

```dotenv
AI_PROVIDER=livekit_worker
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
LIVEKIT_AGENT_NAME=chatconnect-cn-frame-echo
VIDEO_PROCESSING_MODE=face_track
FACE_DETECTION_INTERVAL=2
FACE_DETECTION_SCALE=0.5
FACE_TRACK_TIMEOUT_SECONDS=3.0
FACE_TRACK_MAX_MISSED_DETECTIONS=45
FRAME_PROVIDER=passthrough
```

2. Start the named worker:

```bash
python -m app.worker dev
```

3. Start FastAPI in another terminal:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8090
```

4. Call `POST /swap`. `LiveKitWorkerProvider` creates an explicit dispatch for `chatconnect-cn-frame-echo` in the supplied room.

5. A browser participant publishes a camera track. The worker subscribes to it and publishes an `echo-<participant identity>` track containing the same received frames.

6. During testing, the frontend must render the echo track separately and avoid sending the echo track back into another processing loop.

The worker writes machine-readable `FRAME_ECHO_METRICS` log entries every five seconds:

```json
{
  "fps": 29.8,
  "worker_frame_latency_ms_avg": 0.12,
  "cpu_percent": 4.6,
  "resolution": "1280x720"
}
```

`worker_frame_latency_ms_avg` measures the time from receiving a decoded frame in the
worker until handing it to LiveKit's outgoing video source. It is not the full mobile
capture-to-display latency. Full end-to-end latency must be measured on the two mobile
devices because WebRTC capture, encode, network, decode and rendering are outside the
worker process.

In `face_detect` mode, the worker converts each incoming frame to RGBA, detects frontal
faces on the CPU, draws a green box and confidence label, then publishes the annotated
frame. Detection is performed every `FACE_DETECTION_INTERVAL` frames and boxes are reused
between detection frames to reduce CPU load. Set `VIDEO_PROCESSING_MODE=echo` for the
original unmodified echo path. No identity matching, tracking or face swapping occurs.

In `face_track` mode, `FaceTrackManager` associates detections by predicted position,
intersection-over-union and normalized centre distance. It assigns a session-local stable
Face ID, estimates position/size velocity between detection frames, retains tracks during
short occlusion, and expires them only after the configured timeout or missed-detection
limit. This is geometric tracking only: it does not identify a person and does not swap a
face.

Face Track never imports or calls a model implementation. After tracking, the Worker calls
the replaceable asynchronous `FrameProvider` interface with the RGBA frame and immutable
track metadata. `FRAME_PROVIDER=passthrough` is the only registered implementation in this
phase. A future model or RunPod client belongs in `app/providers/frame/` and is selected in
the registry; changing it does not modify LiveKit transport, face detection, or tracking.

Generate the model-free tracking demo and run the real-time 30-minute soak test:

```bash
python scripts/create_face_track_demo.py
python scripts/soak_face_tracking.py --duration 1800 --fps 30
```

Production worker command, after frame echo validation:

```bash
python -m app.worker start
```

## Test

```bash
pytest
ruff check .
python -m compileall app tests
```

LiveKit end-to-end test:

1. Join a test room from two browser sessions.
2. Publish video from one browser.
3. Dispatch the worker with `/swap`.
4. Confirm a participant named by LiveKit as the worker joins.
5. Confirm the second browser subscribes to the `echo-*` track.
6. Compare motion and timestamps with the original track.
7. Stop the worker and confirm the original ChatConnect call remains connected.

An automated synthetic-video smoke test is also included. Start the worker, load the
LiveKit variables, and run:

```bash
python scripts/e2e_frame_echo.py
```

It creates a temporary isolated room, publishes changing 320×240 frames, explicitly
dispatches the named worker, and succeeds only after a separate receiver gets at least
10 frames from the worker's `echo-*` track. WebRTC encodes the video on both legs, so
"echo" means that the worker performs no image transformation; it does not promise
byte-identical compressed pixels.

## Two-phone camera test

The mobile test uses real camera capture instead of synthetic frames:

1. Run the worker with `python -m app.worker dev`.
2. Expose FastAPI over a trusted HTTPS origin. iPhone Safari and Android Chrome block
   camera capture on plain HTTP origins other than localhost.
3. Set `MOBILE_TEST_PAGE_URL=https://your-test-host/mobile-echo-test`.
4. Run `python scripts/create_mobile_test_session.py` with the LiveKit variables loaded.
5. Open `phone_1_source_url` on phone 1 and tap **开始测试**.
6. Open `phone_2_receiver_url` on phone 2 and tap **开始测试**.
7. Phone 2 accepts only a video publication whose name starts with `echo-`. Seeing that
   video proves it came through the worker rather than directly from phone 1.

Phone 2 displays received/rendered FPS and connection-to-first-echo-frame latency. The
worker logs FPS, decoded-frame-to-outgoing-source latency and worker-process CPU every
five seconds. Test URLs contain short-lived room credentials and must not be shared or
stored in logs. Stop the worker and close both pages after the test.

## ChatConnect integration boundary

ChatConnect should call this API only from its trusted backend. Never expose `LIVEKIT_API_SECRET` or `WORKER_API_TOKEN` to the browser bundle.

Suggested future flow:

1. ChatConnect authenticates the user and verifies call membership.
2. The trusted backend sends `room_name`, participant identity, and Face ID to this service.
3. The service dispatches the named LiveKit worker.
4. Clients render the worker's processed track when available and fall back to the original camera track on failure.

The current ChatConnect `MockProvider` should remain the production default until this frame echo path is tested independently.
