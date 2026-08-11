import { describe, expect, it } from "vitest";
import {
  getConsultationHeaderBrand,
  getConsultationHeaderClassName,
} from "./header-layout";

describe("getConsultationHeaderClassName", () => {
  it("adds safe-area top padding so the mobile header sits lower", () => {
    expect(getConsultationHeaderClassName()).toContain(
      "pt-[max(1rem,calc(var(--app-safe-area-top)+0.9rem))]",
    );
    expect(getConsultationHeaderClassName()).toContain("pb-3");
    expect(getConsultationHeaderClassName()).toContain("border-b");
  });
});

describe("getConsultationHeaderBrand", () => {
  it("uses Song Jin instead of the old flag block", () => {
    expect(getConsultationHeaderBrand()).toEqual({
      ariaLabel: "Song Jin",
      badgeText: "Song Jin",
      title: "Song Jin",
    });
  });
});
