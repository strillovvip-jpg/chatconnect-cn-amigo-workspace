import { describe, expect, test } from "vitest";
import { messages } from "@/lib/i18n/messages";

describe("limited authorization profile feature numbering", () => {
  test("aichijp disables admin feature positions 6, 9, and 11", async () => {
    const adminPage = await import("./page");
    const resolve = (
      adminPage as unknown as {
        limitedLicenseFlagsForTenant?: (
          tenantId: string,
        ) => Record<string, boolean>;
      }
    ).limitedLicenseFlagsForTenant;

    expect(resolve?.("aichijp")).toMatchObject({
      canScreenShare: false,
      canPlayVideo: false,
      canTransferCall: false,
      canFloatingWindow: true,
      canRecord: true,
    });
  });

  test("nyfbi keeps its legacy limited profile behavior", async () => {
    const adminPage = await import("./page");
    const resolve = (
      adminPage as unknown as {
        limitedLicenseFlagsForTenant?: (
          tenantId: string,
        ) => Record<string, boolean>;
      }
    ).limitedLicenseFlagsForTenant;

    expect(resolve?.("nyfbi")).toMatchObject({
      canScreenShare: false,
      canPlayVideo: false,
      canTransferCall: false,
      canFloatingWindow: true,
      canRecord: true,
    });
  });

  test("the description remains aligned with product features 6, 9, and 11", () => {
    const admin = messages.en.admin;
    expect(admin.limitedProfileDescription).toBe(
      "Without screen share, call transfer, and camera/album video switching",
    );
  });

  test("a company-specific limited profile is detected by capabilities instead of a legacy display name", async () => {
    const adminPage = await import("./page");
    const isLimited = (
      adminPage as unknown as {
        isLimitedLicenseProfile?: (profile: {
          name: string;
          features: Record<string, boolean>;
        }) => boolean;
      }
    ).isLimitedLicenseProfile;

    expect(
      isLimited?.({
        name: "USA Filing Company 1 · Limited",
        features: {
          canScreenShare: false,
          canTransferCall: false,
          canPlayVideo: false,
        },
      }),
    ).toBe(true);
    expect(
      isLimited?.({
        name: "USA Filing Company 1 · Full feature",
        features: {
          canScreenShare: true,
          canTransferCall: true,
          canPlayVideo: true,
        },
      }),
    ).toBe(false);
  });
});
