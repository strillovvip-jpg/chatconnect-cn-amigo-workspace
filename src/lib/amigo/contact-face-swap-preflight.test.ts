import { describe, expect, it, vi } from "vitest";
import {
  ContactFaceSwapPreflightError,
  contactFaceSwapPreflightErrorMessage,
  prepareContactFaceSwapRoom,
  runContactFaceSwapPreflight,
  startContactFaceSwapCall,
  type ContactFaceSwapNativeRoom,
} from "./contact-face-swap-preflight";

const readyStatus = {
  connected: false,
  roomUrl: null,
  faceSwapEnabled: true,
  hasTargetFace: true,
  pipeline: "native-livekit",
};

function nativeRoom(
  overrides: Partial<ContactFaceSwapNativeRoom> = {},
): ContactFaceSwapNativeRoom {
  return {
    isAvailable: true,
    getStatus: vi.fn().mockResolvedValue(readyStatus),
    requestMediaPermissions: vi.fn().mockResolvedValue({
      camera: "authorized",
      microphone: "authorized",
    }),
    setFaceSwapEnabled: vi.fn().mockResolvedValue(readyStatus),
    ...overrides,
  };
}

describe("contact face-swap preflight", () => {
  it("rejects before any native or backend work when the iOS bridge is unavailable", async () => {
    const native = nativeRoom({ isAvailable: false });
    const createRoom = vi.fn();

    await expect(
      prepareContactFaceSwapRoom(
        {
          myCode: "AAAAA",
          theirCode: "BBBBB",
          myName: "Caller",
          deviceId: "device-a",
        },
        createRoom,
        native,
      ),
    ).rejects.toMatchObject({ code: "NATIVE_UNAVAILABLE" });

    expect(native.getStatus).not.toHaveBeenCalled();
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("does not create a ringing call when native memory has no target face", async () => {
    const native = nativeRoom({
      getStatus: vi.fn().mockResolvedValue({
        ...readyStatus,
        hasTargetFace: false,
        faceSwapEnabled: false,
      }),
    });
    const createRoom = vi.fn();

    await expect(
      prepareContactFaceSwapRoom(
        {
          myCode: "AAAAA",
          theirCode: "BBBBB",
          myName: "Caller",
          deviceId: "device-a",
        },
        createRoom,
        native,
      ),
    ).rejects.toMatchObject({ code: "TARGET_FACE_REQUIRED" });

    expect(native.requestMediaPermissions).not.toHaveBeenCalled();
    expect(createRoom).not.toHaveBeenCalled();
  });

  it.each([
    ["camera", { camera: "denied", microphone: "authorized" }],
    ["microphone", { camera: "authorized", microphone: "restricted" }],
  ] as const)(
    "does not enable or ring when %s permission is unavailable",
    async (_permission, permissionStatus) => {
      const native = nativeRoom({
        requestMediaPermissions: vi.fn().mockResolvedValue(permissionStatus),
      });
      const createRoom = vi.fn();

      await expect(
        prepareContactFaceSwapRoom(
          {
            myCode: "AAAAA",
            theirCode: "BBBBB",
            myName: "Caller",
            deviceId: "device-a",
          },
          createRoom,
          native,
        ),
      ).rejects.toMatchObject({ code: "MEDIA_PERMISSION_REQUIRED" });

      expect(native.requestMediaPermissions).toHaveBeenCalledWith({
        openSettingsIfDenied: true,
      });
      expect(native.setFaceSwapEnabled).not.toHaveBeenCalled();
      expect(createRoom).not.toHaveBeenCalled();
    },
  );

  it("enables and verifies the retained face before the backend can ring", async () => {
    const events: string[] = [];
    const disabledStatus = { ...readyStatus, faceSwapEnabled: false };
    const native = nativeRoom({
      getStatus: vi
        .fn()
        .mockImplementationOnce(async () => {
          events.push("status-before");
          return disabledStatus;
        })
        .mockImplementationOnce(async () => {
          events.push("status-after");
          return readyStatus;
        }),
      requestMediaPermissions: vi.fn().mockImplementation(async () => {
        events.push("permissions");
        return { camera: "authorized", microphone: "authorized" };
      }),
      setFaceSwapEnabled: vi.fn().mockImplementation(async () => {
        events.push("enable");
        return readyStatus;
      }),
    });
    const createRoom = vi.fn().mockImplementation(async (request) => {
      events.push("backend");
      return { roomName: "room-a-b", request };
    });

    const result = await prepareContactFaceSwapRoom(
      {
        myCode: "AAAAA",
        theirCode: "BBBBB",
        myName: "Caller",
        deviceId: "device-a",
      },
      createRoom,
      native,
    );

    expect(events).toEqual([
      "status-before",
      "permissions",
      "enable",
      "status-after",
      "backend",
    ]);
    expect(createRoom).toHaveBeenCalledWith({
      myCode: "AAAAA",
      theirCode: "BBBBB",
      myName: "Caller",
      deviceId: "device-a",
      callType: "video",
      callerMediaMode: "face-swap",
    });
    expect(result).toMatchObject({ roomName: "room-a-b" });
  });

  it("skips a redundant enable call but still verifies readiness", async () => {
    const native = nativeRoom();

    await runContactFaceSwapPreflight(native);

    expect(native.setFaceSwapEnabled).not.toHaveBeenCalled();
    expect(native.getStatus).toHaveBeenCalledTimes(2);
  });

  it("does not ring when enable verification reports the processor is still off", async () => {
    const native = nativeRoom({
      getStatus: vi
        .fn()
        .mockResolvedValueOnce({ ...readyStatus, faceSwapEnabled: false })
        .mockResolvedValueOnce({ ...readyStatus, faceSwapEnabled: false }),
    });
    const createRoom = vi.fn();

    await expect(
      prepareContactFaceSwapRoom(
        {
          myCode: "AAAAA",
          theirCode: "BBBBB",
          myName: "Caller",
          deviceId: "device-a",
        },
        createRoom,
        native,
      ),
    ).rejects.toBeInstanceOf(ContactFaceSwapPreflightError);

    await expect(
      runContactFaceSwapPreflight(
        nativeRoom({
          getStatus: vi.fn().mockResolvedValue({
            ...readyStatus,
            faceSwapEnabled: false,
          }),
        }),
      ),
    ).rejects.toMatchObject({ code: "ENABLE_VERIFICATION_FAILED" });
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("passes face-swap media mode through signaling and the local call start", async () => {
    const native = nativeRoom();
    const createRoom = vi.fn().mockResolvedValue({
      serverUrl: "",
      token: "",
      roomName: "room-a-b",
      callId: "call-1",
      myCode: "AAAAA",
      remoteCode: "BBBBB",
      callType: "video" as const,
      localMediaMode: "face-swap" as const,
      remoteMediaMode: "camera" as const,
    });
    const startCall = vi.fn().mockResolvedValue(undefined);

    await startContactFaceSwapCall(
      {
        myCode: "AAAAA",
        theirCode: "BBBBB",
        myName: "Caller",
        chatName: "Callee",
        deviceId: "device-a",
      },
      createRoom,
      startCall,
      native,
    );

    expect(createRoom).toHaveBeenCalledWith({
      myCode: "AAAAA",
      theirCode: "BBBBB",
      myName: "Caller",
      deviceId: "device-a",
      callType: "video",
      callerMediaMode: "face-swap",
    });
    expect(startCall).toHaveBeenCalledWith({
      serverUrl: "",
      token: "",
      roomName: "room-a-b",
      callId: "call-1",
      myCode: "AAAAA",
      remoteCode: "BBBBB",
      callType: "video",
      localMediaMode: "face-swap",
      remoteMediaMode: "camera",
      myName: "Caller",
      chatName: "Callee",
      callerMediaMode: "face-swap",
      waitForAnswer: true,
    });
  });

  it("never starts the local ringing state when preflight fails", async () => {
    const createRoom = vi.fn();
    const startCall = vi.fn();

    await expect(
      startContactFaceSwapCall(
        {
          myCode: "AAAAA",
          theirCode: "BBBBB",
          myName: "Caller",
          chatName: "Callee",
          deviceId: "device-a",
        },
        createRoom,
        startCall,
        nativeRoom({ isAvailable: false }),
      ),
    ).rejects.toMatchObject({ code: "NATIVE_UNAVAILABLE" });

    expect(createRoom).not.toHaveBeenCalled();
    expect(startCall).not.toHaveBeenCalled();
  });

  it.each([
    ["NATIVE_UNAVAILABLE", "Native only"],
    ["TARGET_FACE_REQUIRED", "Enable a face"],
    ["MEDIA_PERMISSION_REQUIRED", "Allow media"],
    ["NATIVE_STATUS_FAILED", "Native not ready"],
    ["ENABLE_FAILED", "Enable failed"],
    ["ENABLE_VERIFICATION_FAILED", "Enable failed"],
  ] as const)("localizes the %s preflight failure", (code, expected) => {
    const error = new ContactFaceSwapPreflightError(code, "raw");

    expect(
      contactFaceSwapPreflightErrorMessage(error, {
        nativeOnly: "Native only",
        uploadFaceFirst: "Enable a face",
        mediaPermissionRequired: "Allow media",
        photoErrorSdkNotReady: "Native not ready",
        photoErrorEnroll: "Enable failed",
      }),
    ).toBe(expected);
  });

  it("leaves non-preflight failures for the normal call error handler", () => {
    expect(
      contactFaceSwapPreflightErrorMessage(new Error("backend"), {
        nativeOnly: "Native only",
        uploadFaceFirst: "Enable a face",
        mediaPermissionRequired: "Allow media",
        photoErrorSdkNotReady: "Native not ready",
        photoErrorEnroll: "Enable failed",
      }),
    ).toBeNull();
  });
});
