import { describe, expect, it } from "vitest";
import { normalizeLegacyBrandName } from "./app-brand";

describe("legacy brand display names", () => {
  it.each(["Song Jin", "song jin", "SONGJIN", "頌進", "颂进"])(
    "renders %s as USA.Filing",
    (name) => {
      expect(normalizeLegacyBrandName(name)).toBe("USA.Filing");
    },
  );

  it("keeps an actual contact name unchanged", () => {
    expect(normalizeLegacyBrandName("RAVE")).toBe("RAVE");
  });
});
