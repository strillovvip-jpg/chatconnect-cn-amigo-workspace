type SaveAdminRecordingOptions = {
  recordingId: string;
  authorizationCode: string;
  deviceId: string;
};

export type FullCallRecordingPart = {
  recordingId: string;
  participantCode: string;
  createdAt: number;
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

function canonicalCallParts(parts: FullCallRecordingPart[]) {
  const groups = new Map<string, FullCallRecordingPart[]>();
  for (const part of parts) {
    const group = groups.get(part.participantCode) ?? [];
    group.push(part);
    groups.set(part.participantCode, group);
  }
  return (
    [...groups.values()]
      .sort(
        (left, right) =>
          right.length - left.length || left[0].createdAt - right[0].createdAt,
      )[0]
      ?.sort((left, right) => left.createdAt - right.createdAt) ?? []
  );
}

function wavBlob(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(
      44 + index * 2,
      sample < 0 ? sample * 32768 : sample * 32767,
      true,
    );
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function mergeRecordingBlobs(blobs: Blob[]) {
  const context = new AudioContext();
  try {
    const decoded = [];
    for (const blob of blobs)
      decoded.push(await context.decodeAudioData(await blob.arrayBuffer()));
    // Voice-grade 16 kHz keeps a complete long call small enough to merge and
    // save reliably on iPhone without sacrificing speech intelligibility.
    const sampleRate = 16_000;
    const mono = decoded.map((audio) => {
      const length = Math.round(audio.duration * sampleRate);
      const output = new Float32Array(length);
      for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
        const input = audio.getChannelData(channel);
        for (let index = 0; index < length; index += 1) {
          const sourceIndex = Math.min(
            input.length - 1,
            Math.floor((index * audio.sampleRate) / sampleRate),
          );
          output[index] += input[sourceIndex] / audio.numberOfChannels;
        }
      }
      return output;
    });
    const joined = new Float32Array(
      mono.reduce((total, samples) => total + samples.length, 0),
    );
    let offset = 0;
    for (const samples of mono) {
      joined.set(samples, offset);
      offset += samples.length;
    }
    return wavBlob(joined, sampleRate);
  } finally {
    await context.close();
  }
}

export async function saveFullCallRecording({
  callId,
  parts,
  authorizationCode,
  deviceId,
}: {
  callId: string;
  parts: FullCallRecordingPart[];
  authorizationCode: string;
  deviceId: string;
}): Promise<SaveAdminRecordingResult> {
  const selected = canonicalCallParts(parts);
  if (!selected.length) throw new Error("No call recording is available.");
  const blobs: Blob[] = [];
  for (const part of selected) {
    const response = await fetch(recordingDownloadEndpoint(part.recordingId), {
      headers: {
        "X-Authorization-Code": authorizationCode,
        "X-Device-Id": deviceId,
      },
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`Recording download failed (${response.status}).`);
    blobs.push(await response.blob());
  }
  const blob = await mergeRecordingBlobs(blobs);
  const safeCallId = callId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  const filename = `full-call-${safeCallId}.wav`;
  const { Capacitor } = await import("@capacitor/core");
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios")
    return await saveOnIos(blob, filename);
  await saveInBrowser(blob, filename);
  return "saved";
}
