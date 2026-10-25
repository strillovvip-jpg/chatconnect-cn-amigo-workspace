import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { aiProvider } from "../services/ai/provider";
import { validateFileUpload } from "./messages";

const http = httpRouter();
const MAX_RECORDING_FILE_BYTES = 25 * 1024 * 1024;

const recordingCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-Authorization-Code, X-Device-Id, X-Call-Id, X-Recording-Segment-Id, X-Recording-Upload-Token",
  "Cache-Control": "no-store",
};

const recordingDownloadCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "X-Authorization-Code, X-Device-Id",
  "Access-Control-Expose-Headers": "Content-Disposition, Content-Type",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function credentials(request: Request) {
  const code =
    request.headers.get("x-authorization-code")?.trim().toUpperCase() ?? "";
  const deviceId = request.headers.get("x-device-id")?.trim() ?? "";
  if (!code || !deviceId) throw new Error("AUTH_REQUIRED");
  return { code, deviceId };
}

async function boundedUploadBody(request: Request, maxBytes: number) {
  if (!request.body) throw new Error("Empty upload");
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Upload exceeds size limit");
      }
      parts.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(parts as BlobPart[]);
}

http.route({
  path: "/api/files/upload",
  method: "OPTIONS",
  handler: httpAction(
    async () =>
      new Response(null, { status: 204, headers: recordingCorsHeaders }),
  ),
});

http.route({
  path: "/api/files/upload",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let storageId: Id<"_storage"> | undefined;
    const reply = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          ...recordingCorsHeaders,
          "Content-Type": "application/json",
        },
      });
    try {
      const url = new URL(request.url);
      const admissionId = url.searchParams.get(
        "admissionId",
      ) as Id<"file_upload_admissions">;
      const token = url.searchParams.get("token") ?? "";
      if (!admissionId || !token)
        return reply({ error: "INVALID_UPLOAD" }, 403);
      const admission = await ctx.runQuery(
        internal.messages.authorizeFileUpload,
        { admissionId, token },
      );
      const maxBytes =
        (admission.purpose === "document" ? 25 : 50) * 1024 * 1024;
      const declaredSize = Number(request.headers.get("content-length") ?? 0);
      const mimeType = request.headers.get("content-type") ?? "";
      let body: Blob;
      try {
        validateFileUpload(admission.purpose, mimeType, declaredSize || 1);
        body = await boundedUploadBody(request, maxBytes);
        validateFileUpload(admission.purpose, mimeType, body.size);
      } catch {
        return reply({ error: "INVALID_FILE_TYPE_OR_SIZE" }, 400);
      }
      await ctx.runQuery(internal.messages.authorizeFileUpload, {
        admissionId,
        token,
      });
      storageId = await ctx.storage.store(new Blob([body], { type: mimeType }));
      await ctx.runMutation(internal.messages.recordFileUpload, {
        admissionId,
        token,
        storageId,
        mimeType,
        byteLength: body.size,
      });
      return reply({ storageId }, 200);
    } catch {
      if (storageId) await ctx.storage.delete(storageId).catch(() => undefined);
      return reply({ error: "UPLOAD_REJECTED" }, 403);
    }
  }),
});

http.route({
  path: "/api/ai/faces",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const faces = await ctx.runQuery(
        api.faceLibrary.listMine,
        credentials(request),
      );
      return json({
        faces: faces.map((face) => ({
          faceId: face.faceId ?? `FACE-${face._id}`,
          name: face.name,
          imageUrl: face.imageUrl,
          createdAt: face.createdAt,
        })),
      });
    } catch (error) {
      if (error instanceof Error && error.message === "AUTH_REQUIRED")
        return json({ error: "AUTH_REQUIRED", message: "请先登录。" }, 401);
      return json({ error: "FORBIDDEN", message: "没有权限执行此操作。" }, 403);
    }
  }),
});

http.route({
  path: "/api/ai/swap",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const auth = credentials(request);
      const body = (await request.json()) as {
        faceId?: string;
        targetImageUrl?: string;
      };
      if (
        !body.faceId ||
        !body.targetImageUrl ||
        !/^https:\/\//i.test(body.targetImageUrl)
      )
        return json(
          {
            error: "INVALID_REQUEST",
            message: "必须提供 faceId 和使用 HTTPS 的 targetImageUrl。",
          },
          400,
        );
      const faces = await ctx.runQuery(api.faceLibrary.listMine, auth);
      const face = faces.find(
        (item) => (item.faceId ?? `FACE-${item._id}`) === body.faceId,
      );
      if (!face?.imageUrl)
        return json(
          { error: "FACE_NOT_FOUND", message: "找不到人脸资料。" },
          404,
        );
      return json(
        await aiProvider.swap({
          faceId: body.faceId,
          sourceImageUrl: face.imageUrl,
          targetImageUrl: body.targetImageUrl,
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "AUTH_REQUIRED")
        return json({ error: "AUTH_REQUIRED", message: "请先登录。" }, 401);
      return json(
        { error: "REQUEST_FAILED", message: "请求失败，请稍后重试。" },
        500,
      );
    }
  }),
});

http.route({
  path: "/api/helper-sessions/consume",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = (await request.json()) as {
        assertionId?: string;
        helperNonce?: string;
      };
      if (!body.assertionId || !body.helperNonce)
        return json({ error: "INVALID_REQUEST" }, 400);
      return json(
        await ctx.runMutation(api.helperSessions.consume, {
          assertionId: body.assertionId,
          helperNonce: body.helperNonce,
        }),
      );
    } catch (error) {
      console.error("[RECORDING_UPLOAD] rejected", error);
      return json({ error: "INVALID_ASSERTION" }, 401);
    }
  }),
});

http.route({
  path: "/api/call-recordings/upload",
  method: "OPTIONS",
  handler: httpAction(
    async () =>
      new Response(null, { status: 204, headers: recordingCorsHeaders }),
  ),
});

http.route({
  path: "/api/call-recordings/upload",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let storageId: Id<"_storage"> | undefined;
    try {
      const { code, deviceId } = credentials(request);
      const callId = request.headers.get("x-call-id")?.trim() ?? "";
      const segmentId = request.headers
        .get("x-recording-segment-id")
        ?.trim() as Id<"call_recording_segments"> | undefined;
      const uploadToken =
        request.headers.get("x-recording-upload-token")?.trim() ?? "";
      const mimeType = request.headers
        .get("content-type")
        ?.normalize("NFKC")
        .trim()
        .toLowerCase();
      const declaredSize = Number(request.headers.get("content-length") ?? 0);
      if (
        !callId ||
        !segmentId ||
        !uploadToken ||
        !mimeType?.split(";", 1)[0].startsWith("audio/") ||
        (declaredSize > 0 && declaredSize > MAX_RECORDING_FILE_BYTES)
      )
        return new Response(
          JSON.stringify({ error: "INVALID_RECORDING_UPLOAD" }),
          {
            status: 400,
            headers: {
              ...recordingCorsHeaders,
              "Content-Type": "application/json; charset=utf-8",
            },
          },
        );
      await ctx.runQuery(internal.callCompliance.authorizeRecordingHttpUpload, {
        code,
        deviceId,
        callId,
        segmentId,
        uploadToken,
      });
      const bytes = await request.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > MAX_RECORDING_FILE_BYTES)
        return new Response(
          JSON.stringify({ error: "INVALID_RECORDING_SIZE" }),
          {
            status: 400,
            headers: {
              ...recordingCorsHeaders,
              "Content-Type": "application/json; charset=utf-8",
            },
          },
        );
      // Recheck authorization immediately before storage. The internal save
      // mutation checks the same one-time token once more after storage and
      // any failure deletes the new blob.
      await ctx.runQuery(internal.callCompliance.authorizeRecordingHttpUpload, {
        code,
        deviceId,
        callId,
        segmentId,
        uploadToken,
      });
      storageId = await ctx.storage.store(
        new Blob([bytes], { type: mimeType }),
      );
      await ctx.runMutation(internal.callCompliance.saveRecordingHttpUpload, {
        code,
        deviceId,
        callId,
        segmentId,
        uploadToken,
        storageId,
        mimeType,
        byteLength: bytes.byteLength,
      });
      return new Response(JSON.stringify({ storageId }), {
        status: 200,
        headers: {
          ...recordingCorsHeaders,
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    } catch {
      if (storageId) await ctx.storage.delete(storageId).catch(() => undefined);
      return new Response(
        JSON.stringify({ error: "RECORDING_UPLOAD_REJECTED" }),
        {
          status: 403,
          headers: {
            ...recordingCorsHeaders,
            "Content-Type": "application/json; charset=utf-8",
          },
        },
      );
    }
  }),
});

http.route({
  path: "/api/call-recordings/download",
  method: "OPTIONS",
  handler: httpAction(
    async () =>
      new Response(null, {
        status: 204,
        headers: recordingDownloadCorsHeaders,
      }),
  ),
});

http.route({
  path: "/api/call-recordings/download",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const { code, deviceId } = credentials(request);
      const recordingId = new URL(request.url).searchParams.get(
        "recordingId",
      ) as Id<"call_recordings"> | null;
      if (!recordingId) throw new Error("RECORDING_REQUIRED");
      const authorization = await ctx.runQuery(
        internal.callCompliance.authorizeRecordingDownload,
        {
          password: `${code}:${deviceId}`,
          recordingId,
        },
      );
      const recording = await ctx.storage.get(authorization.storageId);
      if (!recording) throw new Error("RECORDING_NOT_FOUND");
      return new Response(recording, {
        status: 200,
        headers: {
          ...recordingDownloadCorsHeaders,
          "Cache-Control": "private, no-store",
          "Content-Type": authorization.mimeType,
          "Content-Disposition": `attachment; filename="${authorization.filename}"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response(
        JSON.stringify({ error: "RECORDING_DOWNLOAD_REJECTED" }),
        {
          status: 403,
          headers: {
            ...recordingDownloadCorsHeaders,
            "Content-Type": "application/json; charset=utf-8",
          },
        },
      );
    }
  }),
});

export default http;
