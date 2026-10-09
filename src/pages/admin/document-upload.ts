export const MAX_ADMIN_DOCUMENT_FILES = 5;

export function selectAdminDocumentFiles(files: File[]) {
  if (files.length > MAX_ADMIN_DOCUMENT_FILES) {
    return { ok: false, reason: "too_many_files" } as const;
  }
  return { ok: true, files } as const;
}

type DocumentMetadata = {
  password: string;
  caseNumber: string;
  idNumber: string;
  name: string;
  caseName: string;
};

type UploadOptions = {
  files: File[];
  metadata: DocumentMetadata;
  generateUploadUrl: () => Promise<string>;
  uploadFile: (url: string, file: File) => Promise<string>;
  saveDocument: (
    input: DocumentMetadata & { fileName: string; storageId: string },
  ) => Promise<unknown>;
};

export async function uploadAdminDocuments({
  files,
  metadata,
  generateUploadUrl,
  uploadFile,
  saveDocument,
}: UploadOptions) {
  const uploaded: File[] = [];
  const failed: Array<{ file: File; error: unknown }> = [];

  for (const file of files) {
    try {
      const uploadUrl = await generateUploadUrl();
      const storageId = await uploadFile(uploadUrl, file);
      await saveDocument({
        ...metadata,
        fileName: file.name,
        storageId,
      });
      uploaded.push(file);
    } catch (error) {
      failed.push({ file, error });
    }
  }

  return { uploaded, failed };
}
