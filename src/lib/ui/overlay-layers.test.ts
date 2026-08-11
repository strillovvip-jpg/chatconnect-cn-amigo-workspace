import { describe, expect, it } from "vitest";
import { OVERLAY_LAYERS } from "./overlay-layers";

describe("overlay layer ordering", () => {
  it("keeps urgent incoming calls above feature and transfer modals", () => {
    expect(OVERLAY_LAYERS.urgentIncoming).toBeGreaterThan(
      OVERLAY_LAYERS.featureModal,
    );
    expect(OVERLAY_LAYERS.urgentIncoming).toBeGreaterThan(
      OVERLAY_LAYERS.transferModal,
    );
  });
});
