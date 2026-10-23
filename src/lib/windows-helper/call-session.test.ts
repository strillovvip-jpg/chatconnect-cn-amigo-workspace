import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWindowsHelperRuntime,
  markWindowsVirtualCameraDevice,
  registerWindowsHelperStop,
  stopWindowsHelperForPublisher,
} from "./call-session";

describe("Windows helper call session", () => {
  beforeEach(() => clearWindowsHelperRuntime());

  it("stops helper processing only after its virtual-camera publisher ends", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    registerWindowsHelperStop(stop);
    markWindowsVirtualCameraDevice("usa-camera");

    await stopWindowsHelperForPublisher("physical-camera");
    expect(stop).not.toHaveBeenCalled();
    await stopWindowsHelperForPublisher("usa-camera");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("retains enrollment when processing stops so camera can be enabled again", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    registerWindowsHelperStop(stop);
    markWindowsVirtualCameraDevice("usa-camera");

    await stopWindowsHelperForPublisher("usa-camera");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(await stopWindowsHelperForPublisher("usa-camera")).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("leaves ordinary camera calls unchanged", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    registerWindowsHelperStop(stop);
    expect(await stopWindowsHelperForPublisher("obs-camera")).toBe(false);
    expect(stop).not.toHaveBeenCalled();
  });
});
