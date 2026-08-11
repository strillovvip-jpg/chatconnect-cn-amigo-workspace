import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { ConvexError } from "convex/values";
import {
  AlertTriangle,
  CircleAlert,
  File,
  FileText,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

function Attachment({
  doc,
}: {
  doc: { _id: string; fileName: string; url: string | null };
}) {
  const url = doc.url ?? "";
  const ext = doc.fileName.split(".").pop()?.toLowerCase() ?? "";
  const isImage = ["jpg", "jpeg", "png", "gif", "webp", "heic"].includes(ext);
  const isVideo = ["mp4", "mov", "webm", "m4v"].includes(ext);
  return (
    <a
      href={url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block overflow-hidden rounded-md border border-red-500/25 bg-[#160707]"
    >
      <div className="aspect-[1.7/1] overflow-hidden bg-[#210909]">
        {isImage && url ? (
          <img
            src={url}
            alt={doc.fileName}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : isVideo && url ? (
          <video
            src={url}
            controls
            playsInline
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            {ext === "pdf" ? (
              <FileText className="text-red-300/70" />
            ) : (
              <File className="text-red-300/70" />
            )}
          </div>
        )}
      </div>
      <div className="truncate bg-[#251010] px-2 py-1.5 text-[10px] text-white/65">
        {doc.fileName}
      </div>
    </a>
  );
}

export default function CaseDocSearch({ userCode }: { userCode: string }) {
  const { messages } = useI18n();
  const copy = messages.caseSearch;
  const STATUS: Record<string, string> = {
    open: copy.status.open,
    in_progress: copy.status.inProgress,
    closed: copy.status.closed,
    suspended: copy.status.suspended,
  };
  const deviceId = localStorage.getItem("ksc_device_id") ?? "";
  const storageKey = `ksc_case_grant_${userCode}`;
  const idStorageKey = `ksc_case_verified_id_${userCode}`;
  const [caseNumber, setCaseNumber] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [verifiedIdNumber, setVerifiedIdNumber] = useState(
    () => sessionStorage.getItem(idStorageKey) ?? "",
  );
  const [token, setToken] = useState(
    () => sessionStorage.getItem(storageKey) ?? "",
  );
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const verify = useMutation(api.cases.verifyCaseAccess);
  const result = useQuery(
    api.cases.getVerifiedCase,
    token ? { token, userCode, deviceId } : "skip",
  );

  const reset = () => {
    sessionStorage.removeItem(storageKey);
    sessionStorage.removeItem(idStorageKey);
    setToken("");
    setCaseNumber("");
    setIdNumber("");
    setVerifiedIdNumber("");
    setError("");
  };
  const handleVerify = async () => {
    if (!caseNumber.trim() || !idNumber.trim()) {
      setError(copy.invalidCredentials);
      return;
    }
    setChecking(true);
    setError("");
    try {
      const grant = await verify({
        caseNumber: caseNumber
          .normalize("NFKC")
          .replace(/[‐‑‒–—―]/g, "-")
          .trim()
          .toUpperCase(),
        idNumber: idNumber.normalize("NFKC").trim().toUpperCase(),
        userCode,
        deviceId,
      });
      sessionStorage.setItem(storageKey, grant.token);
      sessionStorage.setItem(
        idStorageKey,
        idNumber.normalize("NFKC").trim().toUpperCase(),
      );
      setToken(grant.token);
      setVerifiedIdNumber(idNumber.normalize("NFKC").trim().toUpperCase());
      setIdNumber("");
    } catch (err) {
      void err;
      sessionStorage.removeItem(storageKey);
      sessionStorage.removeItem(idStorageKey);
      setToken("");
      setError(copy.invalidCredentials);
    } finally {
      setChecking(false);
    }
  };
  if (token && result === null) {
    sessionStorage.removeItem(storageKey);
    sessionStorage.removeItem(idStorageKey);
    setTimeout(() => setToken(""), 0);
  }

  return (
    <div className="min-h-[100dvh] w-full bg-black">
      <section className="min-h-[100dvh] w-full overflow-hidden border border-[#352323] bg-[#050505] shadow-2xl">
        <header className="flex items-center justify-between border-b border-[#302323] bg-[#160b09] px-4 py-5 sm:px-6">
          <div className="flex items-center gap-2 text-white">
            <Search size={15} className="text-[#e99a52]" />
            <h2 className="text-lg font-bold tracking-wide">{copy.title}</h2>
          </div>
          <button
            onClick={reset}
            aria-label={copy.close}
            className="rounded p-1 text-white/80 hover:bg-white/10"
          >
            <X size={22} />
          </button>
        </header>

        <div className="space-y-4 p-4 sm:p-6">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-[11px] text-white/45">{copy.caseNumber}</span>
              <input
                value={caseNumber}
                onChange={(e) => setCaseNumber(e.target.value)}
                placeholder={copy.caseNumberPlaceholder}
                className="w-full rounded-md border border-[#2d2525] bg-black px-3 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#d27b27] focus:ring-4 focus:ring-[#d27b27]/25"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] text-white/45">{copy.idNumber}</span>
              <input
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleVerify();
                }}
                placeholder={copy.idNumberPlaceholder}
                className="w-full rounded-md border border-[#2d2525] bg-black px-3 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#d27b27] focus:ring-4 focus:ring-[#d27b27]/25"
              />
            </label>
          </div>
          <button
            onClick={() => void handleVerify()}
            disabled={checking || !caseNumber.trim() || !idNumber.trim()}
            className="flex w-full items-center justify-center gap-3 rounded-md bg-[#ed9851] py-3 text-sm font-bold text-[#160d08] transition hover:bg-[#f3a561] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Search size={18} />
            {checking ? copy.searchBusy : copy.searchIdle}
          </button>
          {error && (
            <p
              role="alert"
              className="rounded-md border border-red-800/60 bg-red-950/50 px-3 py-2 text-sm text-red-200"
            >
              {error}
            </p>
          )}

          {token && result && (
            <article className="overflow-hidden rounded-md border border-red-600 bg-[#150000] shadow-[0_0_24px_rgba(220,0,0,0.18)]">
              <div className="flex items-center justify-between bg-[#b40000] px-4 py-3 text-white">
                <div className="flex items-center gap-2">
                  <ShieldAlert size={17} />
                  <div>
                    <div className="text-sm font-bold">{copy.secureRecord}</div>
                    <div className="text-[8px] tracking-wide text-white/70">
                      {copy.verifiedRecord}
                    </div>
                  </div>
                </div>
                <CircleAlert size={16} />
              </div>
              <div className="space-y-6 p-4 sm:p-8">
                <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <div className="text-[10px] text-red-400">{copy.caseNumber}</div>
                    <div className="font-mono text-lg text-white">
                      {result.caseNumber}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-red-400">{copy.name}</div>
                    <div className="text-lg font-semibold text-white">
                      {result.suspectName ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-red-400">{copy.verifiedId}</div>
                    <div className="font-mono text-lg text-white">
                      {verifiedIdNumber || copy.verified}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-red-400">{copy.caseTitle}</div>
                    <div className="text-lg font-semibold text-white">
                      {result.title}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-red-400">{copy.state}</div>
                    <span className="mt-1 inline-flex rounded-full border border-yellow-700/50 bg-yellow-800/30 px-2 py-0.5 text-[10px] text-yellow-300">
                      {STATUS[result.status] ?? result.status}
                    </span>
                  </div>
                </div>
                <div className="border-t border-red-900/70 pt-3">
                  <div className="text-[10px] text-red-400">{copy.summary}</div>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-white/75">
                    {result.description}
                  </p>
                </div>
                {result.adminContent && (
                  <div className="rounded border border-red-800/50 bg-red-950/35 p-3">
                    <div className="mb-1 flex items-center gap-1 text-[10px] text-red-400">
                      <AlertTriangle size={11} />
                      {copy.extraInfo}
                    </div>
                    <p className="whitespace-pre-wrap text-xs leading-5 text-white/80">
                      {result.adminContent}
                    </p>
                  </div>
                )}
                <div>
                  <div className="mb-3 text-base font-bold text-red-400">
                    {copy.documentsTitle}（{result.documents.length}）
                  </div>
                  {result.documents.length === 0 ? (
                    <p className="text-sm text-white/35">{copy.noDocuments}</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {result.documents.map((doc) => (
                        <Attachment key={doc._id} doc={doc} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </article>
          )}
        </div>
      </section>
    </div>
  );
}
