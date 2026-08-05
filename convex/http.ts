import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { aiProvider } from "../services/ai/provider";

const http = httpRouter();

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

export default http;
