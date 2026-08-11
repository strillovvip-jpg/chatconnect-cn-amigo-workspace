import { describe, expect, it } from "vitest";
import {
  getConsultationHeaderActionClassName,
  getConsultationHeaderBrand,
  getConsultationHeaderClassName,
  getConsultationHeaderSecondaryClassName,
  getConsultationTabBarClassName,
} from "./header-layout";

describe("getConsultationHeaderClassName", () => {
  it("adds safe-area top padding so the mobile header sits lower", () => {
    expect(getConsultationHeaderClassName()).toContain(
      "pt-[max(1rem,calc(var(--app-safe-area-top)+0.9rem))]",
    );
    expect(getConsultationHeaderClassName()).toContain("pb-3");
    expect(getConsultationHeaderClassName()).toContain("border-b");
  });

  it("uses two responsive rows so controls cannot collide with the profile", () => {
    expect(getConsultationHeaderClassName()).toContain("grid");
    expect(getConsultationHeaderClassName()).toContain(
      "grid-cols-[minmax(0,1fr)_auto]",
    );
    expect(getConsultationHeaderActionClassName()).toContain("justify-end");
    expect(getConsultationHeaderSecondaryClassName()).toContain("col-span-2");
    expect(getConsultationHeaderSecondaryClassName()).toContain("flex-wrap");
  });

  it("keeps the navigation tappable on narrow phones", () => {
    expect(getConsultationTabBarClassName()).toContain("overflow-x-auto");
    expect(getConsultationTabBarClassName()).toContain("shrink-0");
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
