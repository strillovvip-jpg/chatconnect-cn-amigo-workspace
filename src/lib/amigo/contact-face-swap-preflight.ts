import type {
  NativeMediaPermissionStatus,
  NativeRoomStatus,
} from "./bridge.ts";
import { nativeAmigoRoom } from "./native-room.ts";

export type ContactFaceSwapPreflightErrorCode =
  | "NATIVE_UNAVAILABLE"
  | "NATIVE_STATUS_FAILED"
  | "TARGET_FACE_REQUIRED"
  | "MEDIA_PERMISSION_REQUIRED"
  | "ENABLE_FAILED"
  | "ENABLE_VERIFICATION_FAILED";

export class ContactFaceSwapPreflightError extends Error {
  readonly name = "ContactFaceSwapPreflightError";

  constructor(
    readonly code: ContactFaceSwapPreflightErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type ContactFaceSwapNativeRoom = {
  readonly isAvailable: boolean;
  getStatus(): Promise<NativeRoomStatus>;
  requestMediaPermissions(options: {
    openSettingsIfDenied?: boolean;
  }): Promise<NativeMediaPermissionStatus>;
  setFaceSwapEnabled(enabled: boolean): Promise<NativeRoomStatus>;
};

export type ContactFaceSwapRoomRequest = {
  myCode: string;
  theirCode: string;
  myName: string;
  deviceId: string;
  callType: "video";
  callerMediaMode: "face-swap";
};

export type ContactFaceSwapCallRequest = Omit<
  ContactFaceSwapRoomRequest,
  "callType" | "callerMediaMode"
> & {
  chatName: string;
};

export type ContactFaceSwapStartOverrides = {
  myName: string;
  chatName: string;
  callType: "video";
  callerMediaMode: "face-swap";
  waitForAnswer: true;
};

export type ContactFaceSwapPreflightMessages = {
  nativeOnly: string;
  uploadFaceFirst: string;
  mediaPermissionRequired: string;
  photoErrorSdkNotReady: string;
  photoErrorEnroll: string;
};

export function contactFaceSwapPreflightErrorMessage(
  error: unknown,
  messages: ContactFaceSwapPreflightMessages,
): string | null {
  if (!(error instanceof ContactFaceSwapPreflightError)) return null;
  switch (error.code) {
    case "NATIVE_UNAVAILABLE":
      return messages.nativeOnly;
    case "TARGET_FACE_REQUIRED":
      return messages.uploadFaceFirst;
    case "MEDIA_PERMISSION_REQUIRED":
      return messages.mediaPermissionRequired;
    case "NATIVE_STATUS_FAILED":
      return messages.photoErrorSdkNotReady;
    case "ENABLE_FAILED":
    case "ENABLE_VERIFICATION_FAILED":
      return messages.photoErrorEnroll;
  }
}

export async function runContactFaceSwapPreflight(
  nativeRoom: ContactFaceSwapNativeRoom = nativeAmigoRoom,
): Promise<NativeRoomStatus> {
  if (!nativeRoom.isAvailable) {
    throw new ContactFaceSwapPreflightError(
      "NATIVE_UNAVAILABLE",
      "Native face-swap calling is unavailable.",
    );
  }

  const initialStatus = await readNativeStatus(
    nativeRoom,
    "NATIVE_STATUS_FAILED",
  );
  if (!initialStatus.hasTargetFace) {
    throw new ContactFaceSwapPreflightError(
      "TARGET_FACE_REQUIRED",
      "A target face must be enabled before starting the call.",
    );
  }

  let permissions: NativeMediaPermissionStatus;
  try {
    permissions = await nativeRoom.requestMediaPermissions({
      openSettingsIfDenied: true,
    });
  } catch (error) {
    throw new ContactFaceSwapPreflightError(
      "MEDIA_PERMISSION_REQUIRED",
      errorMessage(error, "Camera and microphone permissions are required."),
      { cause: error },
    );
  }
  if (
    permissions.camera !== "authorized" ||
    permissions.microphone !== "authorized"
  ) {
    throw new ContactFaceSwapPreflightError(
      "MEDIA_PERMISSION_REQUIRED",
      "Camera and microphone permissions are required.",
    );
  }

  if (!initialStatus.faceSwapEnabled) {
    try {
      await nativeRoom.setFaceSwapEnabled(true);
    } catch (error) {
      throw new ContactFaceSwapPreflightError(
        "ENABLE_FAILED",
        errorMessage(error, "The enabled face could not be activated."),
        { cause: error },
      );
    }
  }

  const verifiedStatus = await readNativeStatus(
    nativeRoom,
    "ENABLE_VERIFICATION_FAILED",
  );
  if (!verifiedStatus.hasTargetFace) {
    throw new ContactFaceSwapPreflightError(
      "TARGET_FACE_REQUIRED",
      "The enabled target face is no longer available.",
    );
  }
  if (!verifiedStatus.faceSwapEnabled) {
    throw new ContactFaceSwapPreflightError(
      "ENABLE_VERIFICATION_FAILED",
      "The native face-swap processor did not become ready.",
    );
  }
  return verifiedStatus;
}

export async function prepareContactFaceSwapRoom<T>(
  request: Omit<ContactFaceSwapRoomRequest, "callType" | "callerMediaMode">,
  createRoom: (request: ContactFaceSwapRoomRequest) => Promise<T>,
  nativeRoom: ContactFaceSwapNativeRoom = nativeAmigoRoom,
): Promise<T> {
  await runContactFaceSwapPreflight(nativeRoom);
  return createRoom({
    ...request,
    callType: "video",
    callerMediaMode: "face-swap",
  });
}

export async function startContactFaceSwapCall<TDetails extends object>(
  request: ContactFaceSwapCallRequest,
  createRoom: (request: ContactFaceSwapRoomRequest) => Promise<TDetails>,
  startCall: (
    request: TDetails & ContactFaceSwapStartOverrides,
  ) => Promise<void>,
  nativeRoom: ContactFaceSwapNativeRoom = nativeAmigoRoom,
): Promise<void> {
  const { chatName, ...roomRequest } = request;
  const details = await prepareContactFaceSwapRoom(
    roomRequest,
    createRoom,
    nativeRoom,
  );
  await startCall({
    ...details,
    myName: request.myName,
    chatName,
    callType: "video",
    callerMediaMode: "face-swap",
    waitForAnswer: true,
  });
}

async function readNativeStatus(
  nativeRoom: ContactFaceSwapNativeRoom,
  code: "NATIVE_STATUS_FAILED" | "ENABLE_VERIFICATION_FAILED",
) {
  try {
    return await nativeRoom.getStatus();
  } catch (error) {
    throw new ContactFaceSwapPreflightError(
      code,
      errorMessage(error, "The native face-swap status could not be verified."),
      { cause: error },
    );
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}
