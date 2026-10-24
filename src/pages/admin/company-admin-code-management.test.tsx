// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "./page";
import { I18nProvider } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  setEnabled: vi.fn(async () => undefined),
  genericMutation: vi.fn(async () => undefined),
  navigate: vi.fn(),
}));

const fullFeatures = {
  canVideoCall: true,
  canVoiceCall: true,
  canAIFace: true,
  canVideoSource: true,
  canPlayVideo: true,
  canScreenShare: true,
  canTransferCall: true,
  canGroupCall: true,
  canPictureInPicture: true,
  canFloatingWindow: true,
  canFileSearch: true,
  canRecord: true,
};
const limitedFeatures = {
  ...fullFeatures,
  canPlayVideo: false,
  canScreenShare: false,
  canTransferCall: false,
};

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    authCodes: { getSessionRole: "getSessionRole" },
    admin: {
      getStats: "getStats",
      getAllCodes: "getAllCodes",
      getAllowedCodes: "getAllowedCodes",
      getAllMessages: "getAllMessages",
      getAllCases: "getAllCases",
      getActiveCalls: "getActiveCalls",
      cleanupStaleCalls: "cleanupStaleCalls",
      resetCode: "resetCode",
      updateCaseStatusAdmin: "updateCaseStatusAdmin",
      deleteCaseAdmin: "deleteCaseAdmin",
    },
    features: {
      listProfiles: "listProfiles",
      createAuthorizationCode: "createAuthorizationCode",
      createProfile: "createProfile",
      migrateUnassignedCodes: "migrateUnassignedCodes",
      configureCode: "configureCode",
      updateProfile: "updateProfile",
    },
    caseDocuments: {
      listAll: "listAllDocuments",
      generateUploadUrl: "generateUploadUrl",
      saveDocument: "saveDocument",
      deleteDocument: "deleteDocument",
    },
    cases: {
      createCasesBulk: "createCasesBulk",
      updateCaseDetails: "updateCaseDetails",
    },
    roleManagement: {
      createOrPromoteAdmin: "createOrPromoteAdmin",
      rotateClaimSecret: "rotateClaimSecret",
      setRole: "setRole",
      setEnabled: "setEnabled",
      deleteCode: "deleteCode",
    },
    callCompliance: {
      adminDashboard: "adminDashboard",
      request: "requestRecording",
      stop: "stopRecording",
      setTranslation: "setTranslation",
    },
  },
}));

vi.mock("convex/react", () => ({
  useQuery: (endpoint: string) => {
    if (endpoint === "getSessionRole")
      return { role: "admin", code: "ACADM", companyId: "acadm" };
    if (endpoint === "getStats")
      return {
        totalUsers: 2,
        totalContacts: 0,
        totalMessages: 0,
        totalCases: 0,
        openCases: 0,
        inProgressCases: 0,
        activeGroupCalls: 0,
      };
    if (endpoint === "listProfiles")
      return [
        {
          _id: "full-profile",
          name: "Acme · Full feature",
          features: fullFeatures,
        },
        {
          _id: "limited-profile",
          name: "Acme · Limited",
          features: limitedFeatures,
        },
      ];
    if (endpoint === "getAllowedCodes")
      return [
        {
          _id: "allowed-full",
          code: "FULLA",
          role: "user",
          enabled: true,
          licenseProfileId: "full-profile",
        },
        {
          _id: "allowed-limit",
          code: "LIMIT",
          role: "user",
          enabled: true,
          licenseProfileId: "limited-profile",
        },
        {
          _id: "allowed-paused",
          code: "PAUSE",
          role: "user",
          enabled: false,
          licenseProfileId: "full-profile",
        },
      ];
    if (endpoint === "getAllCodes")
      return [
        {
          _id: "session-full",
          code: "FULLA",
          name: "Full User",
          role: "user",
          enabled: true,
          licenseProfileId: "full-profile",
          deviceId: "full-device",
          usedAt: new Date(0).toISOString(),
        },
        {
          _id: "session-limit",
          code: "LIMIT",
          name: "Limited User",
          role: "user",
          enabled: true,
          licenseProfileId: "limited-profile",
          deviceId: "limited-device",
          usedAt: new Date(0).toISOString(),
        },
      ];
    return undefined;
  },
  useMutation: (endpoint: string) =>
    endpoint === "setEnabled" ? mocks.setEnabled : mocks.genericMutation,
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/admin/authorization-codes" }),
  useNavigate: () => mocks.navigate,
}));

describe("company administrator authorization-code management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const values = new Map<string, string>([
      ["ksc_session_code", "ACADM"],
      ["ksc_device_id", "admin-device"],
    ]);
    const localStorageStub = {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
      get length() {
        return values.size;
      },
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageStub,
    });
    vi.stubGlobal("localStorage", localStorageStub);
  });

  it("shows both full and limited company codes and exposes enable/disable management", async () => {
    render(
      <I18nProvider>
        <AdminPage />
      </I18nProvider>,
    );

    expect(screen.getByText("FULLA")).toBeVisible();
    expect(screen.getByText("LIMIT")).toBeVisible();

    fireEvent.click(screen.getByText("FULLA"));
    const disable = await screen.findByRole("button", { name: "Disable" });
    fireEvent.click(disable);

    await waitFor(() =>
      expect(mocks.setEnabled).toHaveBeenCalledWith({
        password: "ACADM:admin-device",
        targetCode: "FULLA",
        enabled: false,
      }),
    );

    const pausedCode = screen.getByText("PAUSE").closest("span");
    expect(pausedCode).not.toBeNull();
    fireEvent.click(
      within(pausedCode!).getByRole("button", { name: "Enable" }),
    );
    await waitFor(() =>
      expect(mocks.setEnabled).toHaveBeenCalledWith({
        password: "ACADM:admin-device",
        targetCode: "PAUSE",
        enabled: true,
      }),
    );
  });
});
