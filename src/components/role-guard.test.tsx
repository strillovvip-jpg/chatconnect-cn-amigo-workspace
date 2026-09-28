import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { RequireRole } from "./role-guard";

const mocks = vi.hoisted(() => ({
  session: null as null | undefined | { role: "user" },
}));

vi.mock("convex/react", () => ({
  useQuery: () => mocks.session,
}));

vi.mock("@/convex/_generated/api.js", () => ({
  api: { authCodes: { getSessionRole: "getSessionRole" } },
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    messages: {
      roleGuard: {
        forbiddenTitle: "Access denied",
        forbiddenBody: "You do not have access.",
        verifying: "Verifying...",
      },
    },
  }),
}));

function LoginProbe() {
  const location = useLocation();
  return <output aria-label="login location">{location.pathname + location.search}</output>;
}

describe("RequireRole invalidated sessions", () => {
  beforeEach(() => {
    mocks.session = null;
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    window.localStorage.setItem("ksc_session_code", "OLD01");
    window.localStorage.setItem("ksc_session_name", "Old User");
    window.localStorage.setItem("ksc_session_role", "user");
    window.localStorage.setItem("ksc_device_id", "old-device");
  });

  it("clears an invalid authorization session and returns to login", async () => {
    render(
      <MemoryRouter initialEntries={["/protected"]}>
        <Routes>
          <Route path="/" element={<LoginProbe />} />
          <Route
            path="/protected"
            element={
              <RequireRole role="user">
                <div>protected</div>
              </RequireRole>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("login location")).toHaveTextContent(
      "/?reauth=1",
    );
    await waitFor(() => {
      expect(window.localStorage.getItem("ksc_session_code")).toBeNull();
      expect(window.localStorage.getItem("ksc_session_name")).toBeNull();
      expect(window.localStorage.getItem("ksc_session_role")).toBeNull();
    });
    expect(window.localStorage.getItem("ksc_device_id")).toBe("old-device");
  });
});
