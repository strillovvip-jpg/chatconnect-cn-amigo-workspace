type SaveAdminRecordingOptions = {
  recordingId: string;
  authorizationCode: string;
  deviceId: string;
};

export type SaveAdminRecordingResult = "saved" | "cancelled";

const BASE64_CHUNK_BYTES = 24_576;

function recordingDownloadEndpoint(recordingId: string) {
  const explicit = import.meta.env.VITE_CONVEX_SITE_URL?.trim();
  const url = explicit
    ? new URL(explicit)
    : new URL(import.meta.env.VITE_CONVEX_URL);
  if (!explicit) {
    if (url.hostname.endsWith(".convex.cloud")) {
      url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
    } else if (url.port === "3210") {
      url.port = "3211";
    }
  }
  url.pathname = "/api/call-recordings/download";
  url.search = "";
  url.hash = "";
  url.searchParams.set("recordingId", recordingId);
  return url.toString();
}

function responseFilename(contentDisposition: string | null) {
  const match =
    contentDisposition?.match(
      /(?:^|;)\s*filename="([A-Za-z0-9][A-Za-z0-9._-]{0,199})"\s*(?:;|$)/i,
    ) ?? null;
  if (!match)
    throw new Error("Recording response did not include a safe filename.");
  return match[1];
}

function bytesToBase64(bytes: Uint8Array) {
  const encoded: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_BYTES);
    encoded.push(btoa(String.fromCharCode(...chunk)));
  }
  return encoded.join("");
}

function isShareCancellation(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown };
  return /cancel(?:led|ed)?/i.test(
    `${String(candidate?.code ?? "")} ${String(candidate?.message ?? error ?? "")}`,
  );
}

async function saveInBrowser(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Safari may not take ownership of the object URL until after the click
    // handler returns. Revoking synchronously can therefore cancel the save.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}

async function saveOnIos(
  blob: Blob,
  filename: string,
): Promise<SaveAdminRecordingResult> {
  const [{ Directory, Filesystem }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  const path = `admin-recordings/${crypto.randomUUID()}-${filename}`;
  let tempWritten = false;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await Filesystem.writeFile({
      path,
      data: bytesToBase64(bytes),
      directory: Directory.Cache,
      recursive: true,
    });
    tempWritten = true;
    const { uri } = await Filesystem.getUri({
      path,
      directory: Directory.Cache,
    });
    try {
      await Share.share({ files: [uri], title: filename });
      return "saved";
    } catch (error) {
      if (isShareCancellation(error)) return "cancelled";
      throw error;
    }
  } finally {
    if (tempWritten) {
      await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(
        () => undefined,
      );
    }
  }
}

export async function saveAdminRecording({
  recordingId,
  authorizationCode,
  deviceId,
}: SaveAdminRecordingOptions): Promise<SaveAdminRecordingResult> {
  const response = await fetch(recordingDownloadEndpoint(recordingId), {
    method: "GET",
    headers: {
      "X-Authorization-Code": authorizationCode,
      "X-Device-Id": deviceId,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Recording download failed (${response.status}).`);
  }
  const filename = responseFilename(
    response.headers.get("Content-Disposition"),
  );
  const blob = await response.blob();
  const { Capacitor } = await import("@capacitor/core");
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios") {
    return await saveOnIos(blob, filename);
  }
  await saveInBrowser(blob, filename);
  return "saved";
}
