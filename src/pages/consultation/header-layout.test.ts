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
  it("uses 颂进 instead of the U.S.A. flag block", () => {
    expect(getConsultationHeaderBrand()).toEqual({
      ariaLabel: "颂进",
      badgeText: "颂进",
      title: "颂进",
    });
  });
});
