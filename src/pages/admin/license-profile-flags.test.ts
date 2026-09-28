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
});
