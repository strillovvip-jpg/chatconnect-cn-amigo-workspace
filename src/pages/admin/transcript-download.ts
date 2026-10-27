export type AdminTranscriptLine = {
  speakerName: string;
  text: string;
  originalText?: string;
  createdAt: number;
};

export type SaveTranscriptResult = "saved" | "cancelled";

function safeFilename(callId: string) {
  return `call-transcript-${callId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80)}.txt`;
}

function transcriptText(callId: string, lines: AdminTranscriptLine[]) {
  const body = [...lines]
    .sort((left, right) => left.createdAt - right.createdAt)
    .flatMap((line) => {
      const timestamp = new Date(line.createdAt).toISOString();
      const translated = `[${timestamp}] ${line.speakerName}: ${line.text}`;
      return line.originalText && line.originalText !== line.text
        ? [translated, `Original: ${line.originalText}`]
        : [translated];
    });
  return [`Call: ${callId}`, "", ...body, ""].join("\n");
}

function isShareCancellation(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown };
  return /cancel(?:led|ed)?/i.test(
    `${String(candidate?.code ?? "")} ${String(candidate?.message ?? error ?? "")}`,
  );
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}

export async function saveFullCallTranscript({
  callId,
  lines,
}: {
  callId: string;
  lines: AdminTranscriptLine[];
}): Promise<SaveTranscriptResult> {
  if (!lines.length) throw new Error("No call transcript is available.");
  const filename = safeFilename(callId);
  const blob = new Blob([transcriptText(callId, lines)], {
    type: "text/plain;charset=utf-8",
  });
  const { Capacitor } = await import("@capacitor/core");
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios") {
    const [{ Directory, Filesystem }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    const path = `admin-transcripts/${crypto.randomUUID()}-${filename}`;
    let written = false;
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await Filesystem.writeFile({
        path,
        data: bytesToBase64(bytes),
        directory: Directory.Cache,
        recursive: true,
      });
      written = true;
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
      if (written)
        await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(
          () => undefined,
        );
    }
  }
  await saveInBrowser(blob, filename);
  return "saved";
}
