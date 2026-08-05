import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel.d.ts";
import { paginationOptsValidator } from "convex/server";
import { requireSession } from "./roles";
import { requireFeature } from "./features";

type CaseStatus = Doc<"cases">["status"];
type CasePriority = Doc<"cases">["priority"];

// Generate an independent case number such as "CASE-20260101-0001".
function generateCaseNumber(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 9000 + 1000).toString();
  return `CASE-${date}-${rand}`;
}

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .trim()
    .toUpperCase();
}
function legacyNormalize(value: string) {
  return value.trim().toUpperCase();
}
async function secureHash(value: string) {
  const bytes = new TextEncoder().encode(normalize(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function legacyHash(value: string) {
  const bytes = new TextEncoder().encode(legacyNormalize(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export const createCase = mutation({
  args: {
    userCode: v.string(),
    deviceId: v.string(),
    userName: v.string(),
    caseNumber: v.string(),
    idNumber: v.string(),
    title: v.string(),
    category: v.string(),
    priority: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("urgent"),
    ),
    description: v.string(),
    suspectName: v.optional(v.string()),
    adminContent: v.optional(v.string()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.userCode, args.deviceId);
    if (auth.role !== "admin" && auth.role !== "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    const caseNumber = normalize(args.caseNumber);
    const existingNumber = await ctx.db
      .query("cases")
      .withIndex("by_case_number", (q) => q.eq("caseNumber", caseNumber))
      .unique();
    if (existingNumber)
      throw new ConvexError({
        code: "CONFLICT",
        message: "案件编号已被使用。",
      });
    if (!caseNumber || !normalize(args.idNumber))
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "必须填写案件编号和证件号码。",
      });
    const now = new Date().toISOString();
    const id = await ctx.db.insert("cases", {
      caseNumber,
      idNumberHash: await secureHash(args.idNumber),
      adminContent: args.adminContent,
      title: args.title,
      status: "open",
      priority: args.priority,
      category: args.category,
      description: args.description,
      assignedCode: auth.code,
      assignedName: auth.session.name,
      suspectName: args.suspectName,
      location: args.location,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
});

export const createCasesBulk = mutation({
  args: {
    userCode: v.string(),
    deviceId: v.string(),
    cases: v.array(
      v.object({
        caseNumber: v.string(),
        idNumber: v.string(),
        name: v.string(),
        title: v.string(),
        description: v.string(),
        status: v.union(
          v.literal("open"),
          v.literal("in_progress"),
          v.literal("closed"),
          v.literal("suspended"),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.userCode, args.deviceId);
    if (auth.role !== "admin" && auth.role !== "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    if (args.cases.length < 1 || args.cases.length > 10)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "一次只能新增 1 至 10 个案件。",
      });
    const normalized = args.cases.map((item) => ({
      ...item,
      caseNumber: normalize(item.caseNumber),
      idNumber: normalize(item.idNumber),
      name: item.name.trim(),
      title: item.title.trim(),
      description: item.description.trim(),
    }));
    if (
      normalized.some(
        (item) =>
          !item.caseNumber || !item.idNumber || !item.name || !item.title,
      )
    ) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "每个案件都必须填写案件编号、证件号码、姓名和案件名称。",
      });
    }
    if (
      new Set(normalized.map((item) => item.caseNumber)).size !==
      normalized.length
    ) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "批量数据中存在重复的案件编号。",
      });
    }
    for (const item of normalized) {
      const existing = await ctx.db
        .query("cases")
        .withIndex("by_case_number", (q) => q.eq("caseNumber", item.caseNumber))
        .unique();
      if (existing)
        throw new ConvexError({
          code: "CONFLICT",
          message: `案件编号 ${item.caseNumber} 已存在。`,
        });
    }
    const now = new Date().toISOString();
    const ids = [];
    for (const item of normalized) {
      ids.push(
        await ctx.db.insert("cases", {
          caseNumber: item.caseNumber,
          idNumberHash: await secureHash(item.idNumber),
          suspectName: item.name,
          title: item.title,
          status: item.status,
          priority: "medium",
          category: "其他",
          description: item.description || item.title,
          assignedCode: auth.code,
          assignedName: auth.session.name,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    return { count: ids.length, ids };
  },
});

export const updateCaseDetails = mutation({
  args: {
    caseId: v.id("cases"),
    userCode: v.string(),
    deviceId: v.string(),
    caseNumber: v.string(),
    idNumber: v.optional(v.string()),
    title: v.string(),
    description: v.string(),
    adminContent: v.optional(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("in_progress"),
      v.literal("closed"),
      v.literal("suspended"),
    ),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.userCode, args.deviceId);
    if (auth.role !== "admin" && auth.role !== "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    const record = await ctx.db.get(args.caseId);
    if (!record)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到案件。" });
    const caseNumber = normalize(args.caseNumber);
    const duplicate = await ctx.db
      .query("cases")
      .withIndex("by_case_number", (q) => q.eq("caseNumber", caseNumber))
      .unique();
    if (duplicate && duplicate._id !== args.caseId)
      throw new ConvexError({
        code: "CONFLICT",
        message: "案件编号已被使用。",
      });
    await ctx.db.patch(args.caseId, {
      caseNumber,
      title: args.title.trim(),
      description: args.description.trim(),
      adminContent: args.adminContent?.trim(),
      status: args.status,
      ...(args.idNumber?.trim()
        ? {
            idNumberHash: await secureHash(args.idNumber),
            suspectIdNumber: undefined,
          }
        : {}),
      updatedAt: new Date().toISOString(),
    });
  },
});

export const verifyCaseAccess = mutation({
  args: {
    caseNumber: v.string(),
    idNumber: v.string(),
    userCode: v.string(),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireFeature(
      ctx,
      args.userCode,
      args.deviceId,
      "canFileSearch",
    );
    const invalid = () => {
      throw new ConvexError({
        code: "INVALID_CASE_ACCESS",
        message: "案件编号或证件号码不正确，请重新输入。",
      });
    };
    const caseNumber = normalize(args.caseNumber);
    let record = await ctx.db
      .query("cases")
      .withIndex("by_case_number", (q) => q.eq("caseNumber", caseNumber))
      .unique();
    // Older records may contain visually identical full-width characters or
    // a Unicode dash. The fallback remains entirely server-side and returns
    // only the single verified record to the client.
    if (!record) {
      const candidates = await ctx.db.query("cases").take(500);
      record =
        candidates.find((item) => normalize(item.caseNumber) === caseNumber) ??
        null;
    }
    if (!record) {
      console.info("[CASE_ACCESS] rejected", { reason: "case_not_found" });
      return invalid();
    }
    const canonicalId = normalize(args.idNumber);
    const canonicalHash = await secureHash(canonicalId);
    const oldHash = await legacyHash(args.idNumber);
    const legacyPlaintextMatches = Boolean(
      record.suspectIdNumber &&
      normalize(record.suspectIdNumber) === canonicalId,
    );
    if (
      !legacyPlaintextMatches &&
      record.idNumberHash !== canonicalHash &&
      record.idNumberHash !== oldHash
    ) {
      console.info("[CASE_ACCESS] rejected", {
        reason: record.idNumberHash ? "id_hash_mismatch" : "missing_id_hash",
      });
      return invalid();
    }
    if (
      legacyPlaintextMatches ||
      record.idNumberHash !== canonicalHash ||
      record.suspectIdNumber
    ) {
      await ctx.db.patch(record._id, {
        idNumberHash: canonicalHash,
        suspectIdNumber: undefined,
        updatedAt: new Date().toISOString(),
      });
    }
    const token = crypto.randomUUID();
    await ctx.db.insert("case_access_grants", {
      token,
      caseId: record._id,
      userCode: auth.code,
      deviceId: args.deviceId,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    console.info("[CASE_ACCESS] granted", {
      caseId: record._id,
      userCode: auth.code,
    });
    return { token };
  },
});

export const getVerifiedCase = query({
  args: { token: v.string(), userCode: v.string(), deviceId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireFeature(
      ctx,
      args.userCode,
      args.deviceId,
      "canFileSearch",
    );
    const grant = await ctx.db
      .query("case_access_grants")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (
      !grant ||
      grant.userCode !== normalize(args.userCode) ||
      grant.deviceId !== args.deviceId ||
      grant.expiresAt <= Date.now()
    )
      return null;
    const record = await ctx.db.get(grant.caseId);
    if (!record) return null;
    const documents = await ctx.db
      .query("case_documents")
      .withIndex("by_case_number", (q) => q.eq("caseNumber", record.caseNumber))
      .collect();
    return {
      caseNumber: record.caseNumber,
      suspectName: record.suspectName,
      title: record.title,
      description: record.description,
      status: record.status,
      adminContent: record.adminContent,
      documents: await Promise.all(
        documents.map(async (doc) => ({
          _id: doc._id,
          fileName: doc.fileName,
          url: await ctx.storage.getUrl(doc.storageId),
          uploadedAt: doc.uploadedAt,
        })),
      ),
    };
  },
});

export const updateCaseStatus = mutation({
  args: {
    caseId: v.id("cases"),
    status: v.union(
      v.literal("open"),
      v.literal("in_progress"),
      v.literal("closed"),
      v.literal("suspended"),
    ),
    userCode: v.string(),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.userCode, args.deviceId);
    if (auth.role !== "admin" && auth.role !== "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    const existing = await ctx.db.get(args.caseId);
    if (!existing)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到案件。" });
    await ctx.db.patch(args.caseId, {
      status: args.status,
      updatedAt: new Date().toISOString(),
    });
  },
});

export const listCases = query({
  args: {
    userCode: v.string(),
    deviceId: v.string(),
    status: v.optional(
      v.union(
        v.literal("open"),
        v.literal("in_progress"),
        v.literal("closed"),
        v.literal("suspended"),
      ),
    ),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    page: Doc<"cases">[];
    isDone: boolean;
    continueCursor: string;
  }> => {
    const auth = await requireSession(ctx, args.userCode, args.deviceId);
    if (auth.role !== "admin" && auth.role !== "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    let q = ctx.db.query("cases");

    if (args.status) {
      return q
        .withIndex("by_status", (qb) =>
          qb.eq("status", args.status as CaseStatus),
        )
        .order("desc")
        .paginate(args.paginationOpts);
    }

    return q
      .withIndex("by_created")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const searchCases = query({
  args: {
    query: v.string(),
    userCode: v.string(),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.userCode, args.deviceId);
    if (auth.role !== "admin" && auth.role !== "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    const q = args.query.trim().toLowerCase();
    if (!q) return [];
    const all = await ctx.db
      .query("cases")
      .withIndex("by_created")
      .order("desc")
      .take(500);
    return all
      .filter(
        (c) =>
          c.caseNumber.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          (c.suspectName ?? "").toLowerCase().includes(q) ||
          (c.suspectIdNumber ?? "").toLowerCase().includes(q) ||
          (c.location ?? "").toLowerCase().includes(q),
      )
      .slice(0, 20);
  },
});

export const getCase = query({
  args: { caseId: v.id("cases"), userCode: v.string(), deviceId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.userCode, args.deviceId);
    if (auth.role !== "admin" && auth.role !== "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    const record = await ctx.db.get(args.caseId);
    if (!record) return null;
    return record;
  },
});

export const getMyCases = query({
  args: { userCode: v.string(), deviceId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.userCode, args.deviceId);
    if (auth.role !== "admin" && auth.role !== "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    return await ctx.db
      .query("cases")
      .withIndex("by_assigned", (q) => q.eq("assignedCode", auth.code))
      .order("desc")
      .take(50);
  },
});

export const deleteCase = mutation({
  args: { caseId: v.id("cases"), userCode: v.string(), deviceId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.userCode, args.deviceId);
    if (auth.role !== "admin" && auth.role !== "super_admin")
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "没有权限执行此操作。",
      });
    const existing = await ctx.db.get(args.caseId);
    if (!existing)
      throw new ConvexError({ code: "NOT_FOUND", message: "找不到案件。" });
    await ctx.db.delete(args.caseId);
  },
});
