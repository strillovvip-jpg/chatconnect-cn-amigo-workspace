import { describe, expect, it } from "vitest";
import { appBrand } from "./app-brand";

describe("appBrand", () => {
  it("uses U.S.A as the downloadable app name", () => {
    expect(appBrand.downloadName).toBe("U.S.A");
  });
});
