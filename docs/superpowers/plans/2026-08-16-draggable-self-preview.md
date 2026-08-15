# Draggable Self Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local one-to-one-call preview draggable by touch or mouse while keeping it inside the visible video stage.

**Architecture:** Keep the behavior local to `LiveKitStage`. An internal `DraggableSelfPreview` owns transient pointer state and absolute coordinates, receives the existing local participant, and uses the stage element's rectangle as its clamp boundary. The component is keyed by room identity so a new call restores the existing bottom-right default.

**Tech Stack:** React 19, TypeScript, Pointer Events, Testing Library, Vitest, Tailwind CSS.

## Global Constraints

- Do not change remote video selection, media publication, room lifecycle, permissions, or backend behavior.
- Add no gesture dependency and no persisted position storage.
- Support touch and mouse through Pointer Events.
- Keep the preview inside `LiveKitStage` on all four edges.
- A new room starts at the existing bottom-right position.
- Deployment remains route-only for `/video_call/`; do not replace the production root page.

---

### Task 1: Add bounded pointer dragging to the self preview

**Files:**
- Modify: `src/components/livekit-stage.tsx:84-245`
- Test: `src/components/livekit-stage.test.tsx:39-132`

**Interfaces:**
- Consumes: the existing `Participant`, `compact`, and parent stage rectangle.
- Produces: internal `DraggableSelfPreview({ participant, compact, stageRef })` with no public API change to `LiveKitStage`.

- [ ] **Step 1: Write failing drag and clamp tests**

Add tests that render a P2P stage with `showSelfPreview`, mock these rectangles, and drive Pointer Events:

```tsx
Object.defineProperty(stage, "getBoundingClientRect", {
  value: () => ({ left: 0, top: 0, width: 300, height: 500, right: 300, bottom: 500 }),
});
Object.defineProperty(preview, "getBoundingClientRect", {
  value: () => ({ left: 200, top: 350, width: 100, height: 150, right: 300, bottom: 500 }),
});

fireEvent.pointerDown(preview, { pointerId: 7, clientX: 250, clientY: 400 });
fireEvent.pointerMove(preview, { pointerId: 7, clientX: -100, clientY: -100 });
expect(preview).toHaveStyle({ left: "0px", top: "0px" });

fireEvent.pointerMove(preview, { pointerId: 7, clientX: 1000, clientY: 1000 });
expect(preview).toHaveStyle({ left: "200px", top: "350px" });
fireEvent.pointerUp(preview, { pointerId: 7 });
```

Also assert that the main remote tile receives no draggable inline position.

- [ ] **Step 2: Run the tests and observe the expected RED result**

Run:

```bash
npx vitest run src/components/livekit-stage.test.tsx --configLoader runner
```

Expected: FAIL because the preview has no pointer-driven `left`/`top` position and no draggable test identifier.

- [ ] **Step 3: Implement the minimal internal draggable wrapper**

In `livekit-stage.tsx`, add these internal state shapes and behavior:

```tsx
type PreviewPosition = { x: number; y: number } | null;
type PreviewDrag = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);
```

`DraggableSelfPreview` must:

- use a preview ref, `PreviewPosition` state, and `PreviewDrag | null` ref;
- on pointer down, read stage/preview rectangles, store the stage-relative start position, set that position, capture the pointer, and prevent default;
- on pointer move, ignore other pointer IDs, calculate deltas, clamp X to `0 ... stage.width - preview.width`, clamp Y to `0 ... stage.height - preview.height`, and update the position;
- on pointer up/cancel, release capture if held and clear the drag ref;
- render the existing responsive size/border classes plus `touch-none select-none cursor-move`;
- use the old bottom/right classes while position is `null`, then render `style={{ left: position.x, top: position.y }}` without bottom/right classes;
- wrap only the existing self-preview `ParticipantTile`;
- receive `key={`${room.name}:${room.localParticipant.identity}`}` from `LiveKitStage` so room replacement resets the position.

Give the outer stage `ref={stageRef}` and the preview `data-testid="self-preview"` for the behavioral test.

- [ ] **Step 4: Run focused tests and lint**

Run:

```bash
npx vitest run src/components/livekit-stage.test.tsx src/pages/guest-video-call.behavior.test.tsx --configLoader runner
npx eslint src/components/livekit-stage.tsx src/components/livekit-stage.test.tsx
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the feature**

```bash
git add src/components/livekit-stage.tsx src/components/livekit-stage.test.tsx
git commit -m "feat(video): drag self preview"
```

### Task 2: Verify and deploy the hosted guest route

**Files:**
- No source files beyond Task 1.
- Generated locally: `dist/` (untracked build output).

**Interfaces:**
- Consumes: the committed draggable preview and existing route-only VPS deployment contract.
- Produces: a new hashed guest bundle referenced by `/var/www/chatconnect/guest-index.html` while `/var/www/chatconnect/index.html` remains byte-for-byte unchanged.

- [ ] **Step 1: Run the full verification suite**

```bash
npm test
npm run lint
npm run build
npm run test:build-chain
npx tsc -p convex/tsconfig.json --noEmit
git diff --check
```

Expected: zero test failures and every command exits 0.

- [ ] **Step 2: Push without rewriting history**

```bash
git fetch origin main
git rev-list --left-right --count HEAD...origin/main
git push origin main
```

Expected before push: no unexpected remote commits; expected after push: `0 0`.

- [ ] **Step 3: Rebuild with the committed marker and deploy only the guest route**

Run `npm run build` after the feature commit, append the new hashed `dist/assets/*` files to `/var/www/chatconnect/assets/`, and atomically replace only `/var/www/chatconnect/guest-index.html`. Do not run `scripts/deploy-vps.sh`, replace `/var/www/chatconnect/index.html`, or delete old assets.

- [ ] **Step 4: Verify production assets and mobile geometry**

Verify that:

```text
https://tokoyochet.com/video_call/<uuid> -> HTTP 200
guest entry bundle -> contains the new Git commit marker
guest call bundle -> contains self-preview pointer handlers
/var/www/chatconnect/index.html SHA-256 -> d46c52b991ff221c87d4a7841c06b3000ffeae8bedb74a3c3bd81844856e9236
```

Use Playwright with an iPhone-sized viewport to confirm the stage has non-zero height and the preview's inline `left`/`top` coordinates stay within the stage after synthetic pointer movement.

