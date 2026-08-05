import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAdmin } from "./roles";

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .trim()
    .toUpperCase();
}
async function secureHash(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalize(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

// Generate upload URL for PDF files
export const generateUploadUrl = mutation({
  args: { password: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    await requireAdmin(ctx, args.password);
    return await ctx.storage.generateUploadUrl();
  },
});

// Save document record after upload
export const saveDocument = mutation({
  args: {
    password: v.string(),
    caseNumber: v.string(),
    idNumber: v.string(),
    name: v.string(),
    caseName: v.string(),
    fileName: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx: MutationCtx, args) => {
    const auth = await requireAdmin(ctx, args.password);
    const caseNumber = normalize(args.caseNumber);
    const name = args.name.trim();
    const caseName = args.caseName.trim();
    if (!caseNumber || !normalize(args.idNumber) || !name || !caseName)
      throw new Error("必须填写案件编号、证件号码、姓名和案件名称。");
    let record = await ctx.db
      .query("cases")
      .withIndex("by_case_number", (q) => q.eq("caseNumber", caseNumber))
      .unique();
    const idNumberHash = await secureHash(args.idNumber);
    if (record?.idNumberHash && record.idNumberHash !== idNumberHash)
      throw new Error("案件编号或证件号码不正确。");
    if (!record) {
      const now = new Date().toISOString();
      const caseId = await ctx.db.insert("cases", {
        caseNumber,
        idNumberHash,
        suspectName: name,
        title: caseName,
        status: "open",
        priority: "medium",
        category: "一般",
        description: caseName,
        assignedCode: auth.code,
        assignedName: auth.session.name,
        createdAt: now,
        updatedAt: now,
      });
      record = await ctx.db.get(caseId);
    } else if (!record.suspectName?.trim()) {
      await ctx.db.patch(record._id, {
        suspectName: name,
        updatedAt: new Date().toISOString(),
      });
    }
    if (record && !record.idNumberHash) {
      await ctx.db.patch(record._id, {
        idNumberHash,
        updatedAt: new Date().toISOString(),
      });
    }
    return await ctx.db.insert("case_documents", {
      caseNumber,
      idNumberHash,
      fileName: args.fileName,
      storageId: args.storageId,
      uploadedByCode: auth.code,
      uploadedByName: auth.session.name,
      uploadedAt: new Date().toISOString(),
    });
  },
});

// Delete a document
export const deleteDocument = mutation({
  args: { password: v.string(), documentId: v.id("case_documents") },
  handler: async (ctx: MutationCtx, args) => {
    await requireAdmin(ctx, args.password);
    const doc = await ctx.db.get(args.documentId);
    if (doc) {
      await ctx.storage.delete(doc.storageId);
      await ctx.db.delete(args.documentId);
    }
  },
});

// List all documents (admin)
export const listAll = query({
  args: { password: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    await requireAdmin(ctx, args.password);
    const docs = await ctx.db.query("case_documents").order("desc").take(100);
    return await Promise.all(
      docs.map(async (doc) => ({
        ...doc,
        url: await ctx.storage.getUrl(doc.storageId),
      })),
    );
  },
});
