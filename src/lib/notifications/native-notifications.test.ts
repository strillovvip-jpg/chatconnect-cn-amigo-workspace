import { describe, expect, it, vi } from "vitest";
import {
  ensureNativeNotificationPermission,
  readNativeNotificationPermission,
  scheduleNativeAlert,
} from "./native-notifications";

describe("native notification permissions", () => {
  it("does not prompt again when permission is already granted", async () => {
    const plugin = {
      checkPermissions: vi.fn().mockResolvedValue({ display: "granted" }),
      requestPermissions: vi.fn(),
      schedule: vi.fn(),
    };

    await expect(ensureNativeNotificationPermission(plugin)).resolves.toBe(
      "granted",
    );
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it("requests prompt permission and trusts the final native recheck", async () => {
    const plugin = {
      checkPermissions: vi
        .fn()
        .mockResolvedValueOnce({ display: "prompt" })
        .mockResolvedValueOnce({ display: "granted" }),
      requestPermissions: vi.fn().mockResolvedValue({ display: "granted" }),
      schedule: vi.fn(),
    };

    await expect(ensureNativeNotificationPermission(plugin)).resolves.toBe(
      "granted",
    );
    expect(plugin.requestPermissions).toHaveBeenCalledOnce();
    expect(plugin.checkPermissions).toHaveBeenCalledTimes(2);
  });

  it("does not request when iOS has already denied permission", async () => {
    const plugin = {
      checkPermissions: vi.fn().mockResolvedValue({ display: "denied" }),
      requestPermissions: vi.fn(),
      schedule: vi.fn(),
    };

    await expect(ensureNativeNotificationPermission(plugin)).resolves.toBe(
      "denied",
    );
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it("does not persist a stale request result when the final recheck is denied", async () => {
    const plugin = {
      checkPermissions: vi
        .fn()
        .mockResolvedValueOnce({ display: "prompt" })
        .mockResolvedValueOnce({ display: "denied" }),
      requestPermissions: vi.fn().mockResolvedValue({ display: "granted" }),
      schedule: vi.fn(),
    };

    await expect(ensureNativeNotificationPermission(plugin)).resolves.toBe(
      "denied",
    );
  });

  it("reads the current native state without prompting", async () => {
    const plugin = {
      checkPermissions: vi.fn().mockResolvedValue({ display: "granted" }),
      requestPermissions: vi.fn(),
      schedule: vi.fn(),
    };

    await expect(readNativeNotificationPermission(plugin)).resolves.toBe(
      "granted",
    );
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });
});

describe("native notification scheduling", () => {
  it("schedules an iOS-visible alert with the default notification sound", async () => {
    const plugin = {
      checkPermissions: vi.fn(),
      requestPermissions: vi.fn(),
      schedule: vi.fn().mockResolvedValue(undefined),
    };

    await scheduleNativeAlert(plugin, {
      id: 314,
      title: "Incoming call",
      body: "Caller",
    });

    expect(plugin.schedule).toHaveBeenCalledWith({
      notifications: [
        expect.objectContaining({
          id: 314,
          title: "Incoming call",
          body: "Caller",
          sound: "default",
        }),
      ],
    });
  });
});
