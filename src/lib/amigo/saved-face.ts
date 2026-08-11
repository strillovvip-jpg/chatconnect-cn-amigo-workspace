import { amigoFaceSwap } from "./face-swap.ts";
import { nativeAmigoRoom } from "./native-room.ts";

export type PersistedFace = {
  _id?: string;
  faceId?: string;
  storageId?: string;
  imageUrl?: string | null;
  createdAt?: number;
};

export type SavedFaceDebug = {
  exists: boolean;
  pathKey: string | null;
  byteLength: number;
  updatedAt: number | null;
};

export class SavedFaceValidationError extends Error {
  constructor(
    readonly code:
      | "FACE_IMAGE_NOT_FOUND"
      | "FACE_IMAGE_READ_FAILED"
      | "FACE_IMAGE_EMPTY"
      | "FACE_IMAGE_FORMAT_UNSUPPORTED"
      | "FACE_IMAGE_DECODE_FAILED"
      | "NATIVE_FACE_STATE_MISSING",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SavedFaceValidationError";
  }
}

export async function prepareLatestSavedFace(
  faces: readonly PersistedFace[],
  stage: "save" | "create",
): Promise<SavedFaceDebug | null> {
  const face = faces[0];
  const pathKey = face
    ? String(face.storageId ?? face._id ?? face.faceId ?? "") || null
    : null;
  const updatedAt = face?.createdAt ?? null;

  if (!face?.imageUrl) {
    logSavedFace(stage, {
      exists: false,
      pathKey,
      byteLength: 0,
      updatedAt,
    });
    return null;
  }

  let byteLength = 0;
  let exists = false;
  try {
    const response = await fetch(face.imageUrl, {
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok)
      throw new SavedFaceValidationError(
        "FACE_IMAGE_READ_FAILED",
        `Saved face download failed (${response.status}).`,
      );

    const blob = await response.blob();
    byteLength = blob.size;
    if (byteLength === 0)
      throw new SavedFaceValidationError(
        "FACE_IMAGE_EMPTY",
        "Saved face is empty.",
      );
    if (blob.type && !blob.type.toLowerCase().startsWith("image/"))
      throw new SavedFaceValidationError(
        "FACE_IMAGE_FORMAT_UNSUPPORTED",
        "Saved face is not an image.",
      );

    await verifyImageDecodes(blob);
    exists = true;

    const enrolled = await amigoFaceSwap.enrollFaceFile(blob);
    if (!enrolled)
      throw new SavedFaceValidationError(
        "NATIVE_FACE_STATE_MISSING",
        "Saved face could not be enrolled.",
      );

    const nativeStatus = await nativeAmigoRoom.getStatus();
    if (!nativeStatus.hasTargetFace)
      throw new SavedFaceValidationError(
        "NATIVE_FACE_STATE_MISSING",
        "Native processor did not retain the saved face.",
      );

    const debug = {
      exists: true,
      pathKey,
      byteLength,
      updatedAt,
    } satisfies SavedFaceDebug;
    logSavedFace(stage, debug);
    return debug;
  } catch (error) {
    logSavedFace(stage, {
      exists,
      pathKey,
      byteLength,
      updatedAt,
    });
    console.error(`[savedFace:${stage}:failure]`, {
      code: readErrorField(error, "code"),
      message: error instanceof Error ? error.message : String(error),
      stage: readErrorField(error, "stage"),
      nativeDetails: readErrorField(error, "nativeDetails"),
      "savedFace.exists": exists,
      "savedFace.path/key": pathKey,
      "savedFace.byteLength": byteLength,
      "savedFace.updatedAt": updatedAt,
    });
    if (
      error instanceof SavedFaceValidationError ||
      hasNativeFaceErrorCode(error)
    )
      throw error;
    throw new SavedFaceValidationError(
      "FACE_IMAGE_READ_FAILED",
      "Saved face validation failed.",
      { cause: error },
    );
  }
}

function readErrorField(error: unknown, key: string): unknown {
  if (typeof error !== "object" || error === null || !(key in error))
    return undefined;
  return (error as Record<string, unknown>)[key];
}

async function verifyImageDecodes(blob: Blob): Promise<void> {
  if (typeof createImageBitmap === "function") {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch (error) {
      throw new SavedFaceValidationError(
        "FACE_IMAGE_DECODE_FAILED",
        "Saved face could not be decoded.",
        { cause: error },
      );
    }
    try {
      if (bitmap.width < 1 || bitmap.height < 1)
        throw new SavedFaceValidationError(
          "FACE_IMAGE_DECODE_FAILED",
          "Saved face has invalid dimensions.",
        );
    } finally {
      bitmap.close();
    }
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (image.naturalWidth < 1 || image.naturalHeight < 1) {
        reject(
          new SavedFaceValidationError(
            "FACE_IMAGE_DECODE_FAILED",
            "Saved face has invalid dimensions.",
          ),
        );
        return;
      }
      resolve();
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(
        new SavedFaceValidationError(
          "FACE_IMAGE_DECODE_FAILED",
          "Saved face could not be decoded.",
        ),
      );
    };
    image.src = objectUrl;
  });
}

function hasNativeFaceErrorCode(
  error: unknown,
): error is Error & { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  );
}

function logSavedFace(stage: "save" | "create", debug: SavedFaceDebug) {
  console.info(`[savedFace:${stage}]`, {
    "savedFace.exists": debug.exists,
    "savedFace.path/key": debug.pathKey,
    "savedFace.byteLength": debug.byteLength,
    "savedFace.updatedAt": debug.updatedAt,
  });
}
