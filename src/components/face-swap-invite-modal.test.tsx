import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FaceSwapInviteModal } from "./face-swap-invite-modal";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  createInvite: vi.fn(),
  endInvite: vi.fn(),
  generateUploadUrl: vi.fn(),
  addFace: vi.fn(),
  enrollFaceFile: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: (name: string) =>
    name === "createFaceSwapInvite" ? mocks.createInvite : mocks.endInvite,
  useMutation: (name: string) =>
    name === "generateUploadUrl" ? mocks.generateUploadUrl : mocks.addFace,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock("@/lib/amigo/face-swap", () => ({
  amigoFaceSwap: {
    enrollFaceFile: mocks.enrollFaceFile,
  },
}));

vi.mock("@/lib/amigo/native-room", () => ({
  nativeAmigoRoom: {
    isAvailable: true,
    getStatus: vi.fn(),
    setFaceSwapEnabled: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    messages: {
      common: { close: "Close" },
      faceSwapInvite: {
        nativeOnly: "Only in app",
        uploadFaceFirst: "Upload first",
        created: "Created",
        createFailed: "Create failed",
        copied: "{label} copied",
        copyFailed: "Copy failed {label}",
        shareTitle: "Share",
        shareTextLink: "Link",
        shareTextPassword: "Password",
        shareReady: "Ready",
        shareFailed: "Share failed",
        ended: "Ended",
        endFailed: "End failed",
        title: "Face Swap Call",
        subtitle: "Private call",
        body: "Use a saved face photo for this private call.",
        manageFaces: "Upload face photo",
        manageFacesHint: "Save a photo before creating the call.",
        photoName: "Photo name",
        photoChoose: "Choose photo",
        photoSaveIdle: "Save photo",
        photoSaveBusy: "Saving...",
        photoReady: "Photo saved",
        photoEnrollFailed: "Photo could not be enabled",
        createBusy: "Creating...",
        createIdle: "Create call",
        inviteLink: "Invite link",
        copyLink: "Copy link",
        share: "Share",
        password: "Password",
        copyPassword: "Copy password",
        endBusy: "Ending...",
        endIdle: "End call",
        linkLabel: "link",
        passwordLabel: "password",
      },
      chatPage: {
        chooseImageFile: "Choose image",
        imageMaxSize: "Too large",
        imageUploadFailed: (status: number) => `Upload failed ${status}`,
        imageIdMissing: "Missing id",
        uploadRequestMissing: "Missing upload request",
        faceAdded: "Added",
        faceAddFailed: "Add failed",
      },
    },
  }),
}));

vi.mock("@/lib/utils", () => ({
  uiErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    calls: {
      createFaceSwapInvite: "createFaceSwapInvite",
      endFaceSwapInvite: "endFaceSwapInvite",
    },
    faceLibrary: {
      generateUploadUrl: "generateUploadUrl",
      addFace: "addFace",
    },
  },
}));

describe("FaceSwapInviteModal", () => {
  beforeEach(() => {
    mocks.generateUploadUrl.mockResolvedValue({
      uploadUrl: "https://uploads.example.test/face",
      requestId: "request-1",
    });
    mocks.addFace.mockResolvedValue({ faceId: "face-1" });
    mocks.enrollFaceFile.mockResolvedValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "storage-1" }),
      }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a face-photo upload entrypoint before creating the call", () => {
    render(
      <FaceSwapInviteModal
        open
        onClose={() => undefined}
        userCode="QQAUF"
        deviceId="device-1"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Upload face photo" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Save a photo before creating the call.")).toBeInTheDocument();
  });

  it("enrolls the saved photo in the native processor before reporting success", async () => {
    const { container } = render(
      <FaceSwapInviteModal
        open
        onClose={() => undefined}
        userCode="QQAUF"
        deviceId="device-1"
      />,
    );
    const file = new File(["face"], "face.jpeg", { type: "image/jpeg" });
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

    await waitFor(() => expect(mocks.addFace).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.enrollFaceFile).toHaveBeenCalledWith(file));
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Photo saved");
  });
});
