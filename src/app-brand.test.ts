import { describe, expect, it } from "vitest";
import { appBrand } from "./app-brand";

describe("appBrand", () => {
  it("uses Song Jin as the downloadable app name", () => {
    expect(appBrand.downloadName).toBe("Song Jin");
  });
});
