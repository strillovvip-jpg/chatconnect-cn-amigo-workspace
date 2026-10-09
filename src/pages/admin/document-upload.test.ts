import { describe, expect, it, vi } from "vitest";

import {
  selectAdminDocumentFiles,
  uploadAdminDocuments,
} from "./document-upload";

const file = (name: string) =>
  new File([`contents:${name}`], name, { type: "application/pdf" });

describe("selectAdminDocumentFiles", () => {
  it("accepts up to five files and preserves their order", () => {
    const files = ["1.pdf", "2.pdf", "3.pdf", "4.pdf", "5.pdf"].map(file);

    expect(selectAdminDocumentFiles(files)).toEqual({ ok: true, files });
  });

  it("rejects the whole selection when more than five files are chosen", () => {
    const files = ["1", "2", "3", "4", "5", "6"].map(file);

    expect(selectAdminDocumentFiles(files)).toEqual({
      ok: false,
      reason: "too_many_files",
    });
  });
});

describe("uploadAdminDocuments", () => {
  it("uploads and saves every file sequentially with the shared case metadata", async () => {
    const events: string[] = [];
    const files = [file("evidence-a.pdf"), file("evidence-b.pdf")];
    const generateUploadUrl = vi.fn(async () => {
      const index = generateUploadUrl.mock.calls.length;
      events.push(`url:${index}`);
      return `https://upload.test/${index}`;
    });
    const uploadFile = vi.fn(async (url: string, current: File) => {
      events.push(`upload:${current.name}`);
      return `storage-${url.at(-1)}`;
    });
    const saveDocument = vi.fn(async (input: { fileName: string }) => {
      events.push(`save:${input.fileName}`);
    });

    const result = await uploadAdminDocuments({
      files,
      metadata: {
        password: "secret",
        caseNumber: "CASE-1",
        idNumber: "ID-1",
        name: "Alice",
        caseName: "Evidence",
      },
      generateUploadUrl,
      uploadFile,
      saveDocument,
    });

    expect(result.uploaded).toEqual(files);
    expect(result.failed).toEqual([]);
    expect(events).toEqual([
      "url:1",
      "upload:evidence-a.pdf",
      "save:evidence-a.pdf",
      "url:2",
      "upload:evidence-b.pdf",
      "save:evidence-b.pdf",
    ]);
    expect(saveDocument).toHaveBeenNthCalledWith(1, {
      password: "secret",
      caseNumber: "CASE-1",
      idNumber: "ID-1",
      name: "Alice",
      caseName: "Evidence",
      fileName: "evidence-a.pdf",
      storageId: "storage-1",
    });
  });

  it("keeps successful uploads and reports each failed file independently", async () => {
    const files = [file("good-a.pdf"), file("bad.pdf"), file("good-b.pdf")];
    const saveDocument = vi.fn(async () => undefined);

    const result = await uploadAdminDocuments({
      files,
      metadata: {
        password: "secret",
        caseNumber: "CASE-1",
        idNumber: "ID-1",
        name: "Alice",
        caseName: "Evidence",
      },
      generateUploadUrl: async () => "https://upload.test",
      uploadFile: async (_url, current) => {
        if (current.name === "bad.pdf") throw new Error("network error");
        return `storage-${current.name}`;
      },
      saveDocument,
    });

    expect(result.uploaded.map((item) => item.name)).toEqual([
      "good-a.pdf",
      "good-b.pdf",
    ]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.file.name).toBe("bad.pdf");
    expect(saveDocument).toHaveBeenCalledTimes(2);
  });
});
