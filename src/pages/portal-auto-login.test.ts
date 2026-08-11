import { describe, expect, it } from "vitest";
import { resolveAutoLoginSession } from "./portal-auto-login";

describe("resolveAutoLoginSession", () => {
  it("does not auto login in production builds", () => {
    expect(
      resolveAutoLoginSession({
        isDev: false,
        code: "QQAUF",
        name: "RAVE",
        savedCode: "",
        hasSavedSession: false,
      }),
    ).toBeNull();
  });

  it("allows explicit dev-only auto login when there is no saved session", () => {
    expect(
      resolveAutoLoginSession({
        isDev: true,
        code: "qqauf",
        name: "RAVE",
        savedCode: "",
        hasSavedSession: false,
      }),
    ).toEqual({
      code: "QQAUF",
      name: "RAVE",
    });
  });
});
