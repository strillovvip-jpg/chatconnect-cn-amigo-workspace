# Draggable Self Preview Design

## Goal

Allow the local self-preview in a one-to-one video call to be repositioned by pressing and dragging it with either touch or mouse input. The remote video, media publication, room lifecycle, and call controls must remain unchanged.

## Interaction

- The preview keeps its current bottom-right starting position.
- Pressing the preview captures that pointer. Moving the pointer moves the preview immediately.
- The preview is clamped to the visible `LiveKitStage` bounds and cannot be dragged off-screen.
- Releasing or cancelling the pointer leaves the preview at its current position.
- The position lasts only for the current mounted room. A new call starts in the default bottom-right position.
- The preview disables browser touch panning and text selection while dragging so iPhone Safari does not scroll the page instead.

## Implementation

Add a small internal draggable-preview wrapper to `LiveKitStage`. It owns only transient pointer and position state:

1. On `pointerdown`, read the stage and preview rectangles, convert the preview's current location to stage-relative coordinates, save the pointer offset, and call `setPointerCapture`.
2. On `pointermove`, calculate the next stage-relative position and clamp it to `0 ... stageSize - previewSize` on both axes.
3. Render the moved preview with absolute `left` and `top` coordinates. Before the first drag, preserve the existing responsive bottom/right classes.
4. On `pointerup` or `pointercancel`, release capture and clear only the active drag state.
5. Reset the transient position when the `room` object changes.

No gesture dependency, persistence store, backend change, native change, or App rebuild is required. The hosted guest page receives the behavior through the existing route-only web deployment.

## Verification

- Component test: pointer movement changes preview position.
- Component test: movement is clamped at all four stage edges.
- Component test: remote primary video is not moved.
- Existing guest join, processed-host selection, audio, and call lifecycle tests remain green.
- Run the full frontend tests, lint, production build, build-chain checks, and a mobile-sized browser geometry check before deployment.

