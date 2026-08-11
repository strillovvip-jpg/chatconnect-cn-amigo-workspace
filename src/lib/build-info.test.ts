import { describe, expect, it } from "vitest";
import { appBuildInfo } from "./build-info";

describe("appBuildInfo", () => {
  it("always exposes an app version, build number, and commit fingerprint", () => {
    expect(appBuildInfo.version).toMatch(/^\d+(?:\.\d+)*$/);
    expect(appBuildInfo.buildNumber).toMatch(/^\d+$/);
    expect(appBuildInfo.gitCommit).toMatch(/^[0-9a-f]{7,40}$/i);
  });
});
