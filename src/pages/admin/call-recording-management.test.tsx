// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "sonner";
import { I18nProvider } from "@/lib/i18n";
import AdminPage from "./page";

const mocks = vi.hoisted(() => ({
  complianceDashboard: [] as Array<Record<string, unknown>>,
  sessionRole: { role: "admin", code: "ACADM", companyId: "acadm" },
  deleteCallRecordings: vi.fn(async () => undefined),
  saveFullCallRecording: vi.fn(
    async (): Promise<"saved" | "cancelled"> => "saved",
  ),
  genericMutation: vi.fn(async () => undefined),
  genericAction: vi.fn(async () => undefined),
  navigate: vi.fn(),
}));

vi.mock("./recording-download", () => ({
  saveFullCallRecording: mocks.saveFullCallRecording,
}));

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
      deleteCallRecordings: "deleteCallRecordings",
      authorizeRecordingDownload: "authorizeRecordingDownload",
    },
  },
}));

vi.mock("convex/react", () => ({
  useQuery: (endpoint: string) => {
    if (endpoint === "getSessionRole") return mocks.sessionRole;
    if (endpoint === "getStats") {
      return {
        totalUsers: 1,
        totalContacts: 0,
        totalMessages: 0,
        totalCases: 0,
        openCases: 0,
        inProgressCases: 0,
        activeGroupCalls: 0,
      };
    }
    if (
      endpoint === "getAllCodes" ||
      endpoint === "getAllowedCodes" ||
      endpoint === "listProfiles" ||
      endpoint === "getActiveCalls"
    ) {
      return [];
    }
    if (endpoint === "adminDashboard") return mocks.complianceDashboard;
    return undefined;
  },
  useMutation: (endpoint: string) =>
    endpoint === "deleteCallRecordings"
      ? mocks.deleteCallRecordings
      : mocks.genericMutation,
  useAction: () => mocks.genericAction,
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/admin/calls" }),
  useNavigate: () => mocks.navigate,
}));

function recording(
  id: string,
  participantCode: string,
  participantName: string,
  url: string,
) {
  return {
    _id: id,
    _creationTime: 1_798_761_600_000,
    callId: "call-001",
    tenantId: "acadm",
    participantCode,
    participantName,
    storageId: `storage-${id}`,
    mimeType: "audio/webm",
    createdAt: 1_798_761_600_000,
    url,
  };
}

function complianceSession(
  id: string,
  status: "requested" | "active" | "declined" | "stopping" | "stopped",
  recordings: Array<ReturnType<typeof recording>>,
) {
  return {
    _id: id,
    _creationTime: 1_798_761_000_000,
    callId: "call-001",
    tenantId: "acadm",
    participantCodes: ["ALICE", "BOB"],
    consentedCodes: ["ALICE", "BOB"],
    consentEpoch: 1_798_761_100_000,
    declinedCodes: [],
    status,
    requestedBy: "ACADM",
    requestedAt: 1_798_761_000_000,
    activatedAt: 1_798_761_100_000,
    stoppedAt: status === "stopped" ? 1_798_761_500_000 : undefined,
    stopDeadline: status === "stopping" ? 1_798_761_700_000 : undefined,
    translationEnabled: false,
    transcripts: [],
    recordings,
  };
}

function renderAdminCalls() {
  return render(
    <>
      <I18nProvider>
        <AdminPage />
      </I18nProvider>
      <Toaster />
    </>,
  );
}

describe("admin call recording management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.complianceDashboard = [];
    mocks.sessionRole = {
      role: "admin",
      code: "ACADM",
      companyId: "acadm",
    };
    mocks.saveFullCallRecording.mockReset().mockResolvedValue("saved");
    mocks.deleteCallRecordings.mockReset().mockResolvedValue(undefined);

    const values = new Map<string, string>([
      ["ksc_session_code", "ACADM"],
      ["ksc_device_id", "admin-device"],
      ["songjin_locale_preference", "en"],
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

  it("shows one Save and Delete control for the full finalized call", () => {
    mocks.complianceDashboard = [
      complianceSession("compliance-stopped", "stopped", [
        recording(
          "recording-alice",
          "ALICE",
          "Alice Agent",
          "https://files.example/alice.webm",
        ),
        recording(
          "recording-bob",
          "BOB",
          "Bob Client",
          "https://files.example/bob.webm",
        ),
      ]),
    ];

    renderAdminCalls();

    expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
    expect(screen.getByText(/2 protected segments/)).toBeVisible();
  });

  it("saves all call segments as one recording", async () => {
    mocks.complianceDashboard = [
      complianceSession("compliance-stopped", "stopped", [
        recording(
          "recording-alice",
          "ALICE",
          "Alice Agent",
          "https://files.example/alice.webm",
        ),
      ]),
    ];
    renderAdminCalls();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.saveFullCallRecording).toHaveBeenCalledWith({
        callId: "call-001",
        parts: [
          {
            recordingId: "recording-alice",
            participantCode: "ALICE",
            createdAt: 1_798_761_600_000,
          },
        ],
        authorizationCode: "ACADM",
        deviceId: "admin-device",
      }),
    );
  });

  it("prevents duplicate saves while the first request is pending", () => {
    mocks.complianceDashboard = [
      complianceSession("compliance-stopped", "stopped", [
        recording(
          "recording-alice",
          "ALICE",
          "Alice Agent",
          "https://files.example/alice.webm",
        ),
      ]),
    ];
    mocks.saveFullCallRecording.mockImplementationOnce(
      () => new Promise<"saved">(() => undefined),
    );
    renderAdminCalls();
    const saveButton = screen.getByRole("button", { name: "Save" });

    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(mocks.saveFullCallRecording).toHaveBeenCalledTimes(1);
    expect(saveButton).toBeDisabled();
  });

  it("re-enables Save when saving fails", async () => {
    mocks.complianceDashboard = [
      complianceSession("compliance-stopped", "stopped", [
        recording(
          "recording-alice",
          "ALICE",
          "Alice Agent",
          "https://files.example/alice.webm",
        ),
      ]),
    ];
    mocks.saveFullCallRecording.mockRejectedValueOnce(new Error("save failed"));
    renderAdminCalls();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
    );
  });

  it("shows visible feedback when native saving is cancelled", async () => {
    mocks.complianceDashboard = [
      complianceSession("compliance-stopped", "stopped", [
        recording(
          "recording-alice",
          "ALICE",
          "Alice Agent",
          "https://files.example/alice.webm",
        ),
      ]),
    ];
    mocks.saveFullCallRecording.mockResolvedValueOnce("cancelled");
    renderAdminCalls();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Save cancelled.")).toBeVisible();
  });

  it("does not show recording management controls to an ordinary user", () => {
    mocks.sessionRole = {
      role: "user",
      code: "REGULAR",
      companyId: "acadm",
    };
    mocks.complianceDashboard = [
      complianceSession("compliance-stopped", "stopped", [
        recording(
          "recording-alice",
          "ALICE",
          "Alice Agent",
          "https://files.example/alice.webm",
        ),
      ]),
    ];
    renderAdminCalls();

    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
  });

  it("does not request deletion when the administrator cancels confirmation", () => {
    mocks.complianceDashboard = [
      complianceSession("compliance-stopped", "stopped", [
        recording(
          "recording-alice",
          "ALICE",
          "Alice Agent",
          "https://files.example/alice.webm",
        ),
      ]),
    ];
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderAdminCalls();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(mocks.deleteCallRecordings).not.toHaveBeenCalled();
  });

  it("deletes every recording segment for the confirmed call", async () => {
    mocks.complianceDashboard = [
      complianceSession("compliance-stopped", "stopped", [
        recording(
          "recording-alice",
          "ALICE",
          "Alice Agent",
          "https://files.example/alice.webm",
        ),
      ]),
    ];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderAdminCalls();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(mocks.deleteCallRecordings).toHaveBeenCalledWith({
        password: "ACADM:admin-device",
        callId: "call-001",
      }),
    );
  });

  it.each(["active", "stopping"] as const)(
    "disables Delete while the compliance session is %s",
    (status) => {
      mocks.complianceDashboard = [
        complianceSession(`compliance-${status}`, status, [
          recording(
            `recording-${status}`,
            "ALICE",
            "Alice Agent",
            `https://files.example/${status}.webm`,
          ),
        ]),
      ];
      renderAdminCalls();

      expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
      expect(
        screen.getByText(
          "Stop recording and wait for the final recording to be saved before deleting.",
        ),
      ).toBeVisible();
    },
  );

  it("prevents duplicate deletion while the first request is pending", () => {
    mocks.complianceDashboard = [
      complianceSession("compliance-stopped", "stopped", [
        recording(
          "recording-alice",
          "ALICE",
          "Alice Agent",
          "https://files.example/alice.webm",
        ),
      ]),
    ];
    mocks.deleteCallRecordings.mockImplementationOnce(
      () => new Promise<undefined>(() => undefined),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderAdminCalls();
    const deleteButton = screen.getByRole("button", { name: "Delete" });

    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);

    expect(mocks.deleteCallRecordings).toHaveBeenCalledTimes(1);
    expect(deleteButton).toBeDisabled();
  });

  it("retains the recording and re-enables Delete when deletion fails", async () => {
    mocks.complianceDashboard = [
      complianceSession("compliance-stopped", "stopped", [
        recording(
          "recording-alice",
          "ALICE",
          "Alice Agent",
          "https://files.example/alice.webm",
        ),
      ]),
    ];
    mocks.deleteCallRecordings.mockRejectedValueOnce(
      new Error("delete failed"),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderAdminCalls();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled(),
    );
    expect(screen.getByText("Full call recording")).toBeVisible();
  });
});
