import { describe, expect, it } from "vitest";
import { getNotificationChannel } from "./capabilities";

describe("getNotificationChannel", () => {
  it("treats native iPhone app builds as native notifications", () => {
    expect(
      getNotificationChannel({
        nativeApp: true,
        hasServiceWorker: false,
        hasPushManager: false,
        hasNotificationApi: true,
      }),
    ).toBe("native");
  });

  it("keeps web push for supported browsers", () => {
    expect(
      getNotificationChannel({
        nativeApp: false,
        hasServiceWorker: true,
        hasPushManager: true,
        hasNotificationApi: true,
      }),
    ).toBe("web");
  });

  it("marks unsupported browsers as unsupported", () => {
    expect(
      getNotificationChannel({
        nativeApp: false,
        hasServiceWorker: false,
        hasPushManager: false,
        hasNotificationApi: false,
      }),
    ).toBe("unsupported");
  });
});
