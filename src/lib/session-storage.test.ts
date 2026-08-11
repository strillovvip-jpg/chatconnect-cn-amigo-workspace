import { beforeEach, describe, expect, it } from "vitest";
import { clearPersistedSession } from "./session-storage";

describe("clearPersistedSession", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };

  beforeEach(() => {
    values.clear();
    storage.setItem("ksc_session_code", "RAVE");
    storage.setItem("ksc_session_name", "Song Jin");
    storage.setItem("ksc_session_role", "super_admin");
    storage.setItem("ksc_device_id", "device-1");
  });

  it("removes every authentication field without forgetting the bound device", () => {
    clearPersistedSession(storage);

    expect(storage.getItem("ksc_session_code")).toBeNull();
    expect(storage.getItem("ksc_session_name")).toBeNull();
    expect(storage.getItem("ksc_session_role")).toBeNull();
    expect(storage.getItem("ksc_device_id")).toBe("device-1");
  });
});
