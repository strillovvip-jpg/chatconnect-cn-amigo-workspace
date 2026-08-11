import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FaceSwapInviteModal } from "./face-swap-invite-modal";
import type { ReactNode } from "react";

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
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
});
