import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield,
  Users,
  MessageSquare,
  UserCheck,
  RotateCcw,
  Trash2,
  LogOut,
  BarChart3,
  Key,
  ChevronDown,
  ChevronUp,
  Eye,
  FolderOpen,
  Video,
  Search,
  X,
  AlertTriangle,
  CheckCircle2,
  Clock,
  PauseCircle,
  FileText,
  Upload,
  Loader2,
  Pencil,
} from "lucide-react";
import { cn, uiErrorMessage } from "@/lib/utils.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { useLocation, useNavigate } from "react-router-dom";
import { localeToHtmlLang, useI18n } from "@/lib/i18n";
import type { Messages } from "@/lib/i18n";

type AdminTab =
  | "dashboard"
  | "codes"
  | "online"
  | "managers"
  | "users"
  | "cases"
  | "calls"
  | "messages"
  | "documents";

const LICENSE_FEATURES = [
  "canVideoCall",
  "canVoiceCall",
  "canVideoSource",
  "canPlayVideo",
  "canScreenShare",
  "canTransferCall",
  "canGroupCall",
  "canPictureInPicture",
  "canFloatingWindow",
  "canFileSearch",
  "canRecord",
] as const;
type LicenseFeatureKey = (typeof LICENSE_FEATURES)[number];
type LicenseFlags = Record<LicenseFeatureKey, boolean> & {
  canAIFace: boolean;
};
const DEFAULT_LICENSE_FLAGS: LicenseFlags = {
  canVideoCall: true,
  canVoiceCall: true,
  canAIFace: false,
  canVideoSource: true,
  canPlayVideo: true,
  canScreenShare: true,
  canTransferCall: true,
  canGroupCall: true,
  canPictureInPicture: true,
  canFloatingWindow: true,
  canFileSearch: true,
  canRecord: false,
};

const FULL_PROFILE_NAME = "高级授权码-全部功能";
const LIMITED_PROFILE_NAME = "高级授权码-无6、9及11";
const LEGACY_LIMITED_PROFILE_NAMES = [
  LIMITED_PROFILE_NAME,
  "高级授权码-无9及11",
];
const ADVANCED_LICENSE_FLAGS: LicenseFlags = {
  canVideoCall: true,
  canVoiceCall: true,
  canAIFace: true,
  canVideoSource: true,
  canPlayVideo: true,
  canScreenShare: true,
  canTransferCall: true,
  canGroupCall: true,
  canPictureInPicture: true,
  canFloatingWindow: true,
  canFileSearch: true,
  canRecord: true,
};
const LIMITED_LICENSE_FLAGS: LicenseFlags = {
  ...ADVANCED_LICENSE_FLAGS,
  canScreenShare: false,
  canTransferCall: false,
  canVideoSource: true,
  canPlayVideo: false,
};

function LicenseEditor({
  password,
  code,
  currentProfileId,
  enabled,
  expiresAt,
}: {
  password: string;
  code: string;
  currentProfileId?: Id<"license_profiles">;
  enabled: boolean;
  expiresAt?: number;
}) {
  const { messages } = useI18n();
  const copy = messages.admin;
  const profiles = useQuery(api.features.listProfiles, { password });
  const createProfile = useMutation(api.features.createProfile);
  const updateProfile = useMutation(api.features.updateProfile);
  const configureCode = useMutation(api.features.configureCode);
  const selected = profiles?.find(
    (profile) => profile._id === currentProfileId,
  );
  const [profileId, setProfileId] = useState<string>(currentProfileId ?? "");
  const [profileName, setProfileName] = useState("");
  const [flags, setFlags] = useState<LicenseFlags>(DEFAULT_LICENSE_FLAGS);
  const [active, setActive] = useState(enabled);
  const [expiry, setExpiry] = useState(
    expiresAt ? new Date(expiresAt).toISOString().slice(0, 10) : "",
  );
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setProfileId(currentProfileId ?? "");
    setActive(enabled);
    setExpiry(expiresAt ? new Date(expiresAt).toISOString().slice(0, 10) : "");
  }, [currentProfileId, enabled, expiresAt]);
  useEffect(() => {
    if (selected) {
      setProfileName(selected.name);
      setFlags(selected.features);
    }
  }, [selected]);
  const saveAssignment = async () => {
    setSaving(true);
    try {
      await configureCode({
        password,
        targetCode: code,
        profileId: profileId
          ? (profileId as Id<"license_profiles">)
          : undefined,
        enabled: active,
        expiresAt: expiry
          ? new Date(`${expiry}T23:59:59`).getTime()
          : undefined,
      });
      toast.success(copy.permissionSettingsUpdated);
    } catch (error) {
      toast.error(
        error instanceof ConvexError
          ? (error.data as { message: string }).message
          : copy.permissionSettingsUpdateFailed,
      );
    } finally {
      setSaving(false);
    }
  };
  const saveProfile = async () => {
    if (!profileName.trim()) {
      toast.error(copy.enterLicenseProfileName);
      return;
    }
    setSaving(true);
    try {
      if (profileId)
        await updateProfile({
          password,
          profileId: profileId as Id<"license_profiles">,
          name: profileName,
          features: flags,
        });
      else {
        const id = await createProfile({
          password,
          name: profileName,
          features: flags,
        });
        setProfileId(id);
        await configureCode({
          password,
          targetCode: code,
          profileId: id,
          enabled: active,
          expiresAt: expiry
            ? new Date(`${expiry}T23:59:59`).getTime()
            : undefined,
        });
      }
      toast.success(copy.licenseProfileSaved);
    } catch (error) {
      toast.error(
        error instanceof ConvexError
          ? (error.data as { message: string }).message
          : copy.licenseProfileSaveFailed,
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-3 rounded-xl border border-blue-400/15 bg-blue-500/5 p-3">
      <div className="text-xs font-bold text-blue-200">
        {copy.licenseProfileTitle}
      </div>
      <select
        value={profileId}
        onChange={(event) => {
          const value = event.target.value;
          setProfileId(value);
          const profile = profiles?.find((item) => item._id === value);
          if (profile) {
            setProfileName(profile.name);
            setFlags(profile.features);
          } else {
            setProfileName("");
            setFlags(DEFAULT_LICENSE_FLAGS);
          }
        }}
        className="w-full rounded-lg bg-[#172238] px-3 py-2 text-xs"
      >
        <option value="">{copy.newLicenseProfile}</option>
        {profiles?.map((profile) => (
          <option key={profile._id} value={profile._id}>
            {profile.name}
          </option>
        ))}
      </select>
      <input
        value={profileName}
        onChange={(event) => setProfileName(event.target.value)}
        placeholder={copy.licenseProfileName}
        className="w-full rounded-lg bg-black/25 px-3 py-2 text-xs outline-none"
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {LICENSE_FEATURES.map((key) => (
          <label
            key={key}
            className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-2 text-[11px]"
          >
            <input
              type="checkbox"
              checked={flags[key as keyof LicenseFlags]}
              onChange={(event) =>
                setFlags((current) => ({
                  ...current,
                  [key]: event.target.checked,
                }))
              }
              className="accent-blue-500"
            />
            {copy.featureLabels[key]}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 rounded-lg bg-white/5 px-3 text-xs">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
          {copy.enableCodeCheckbox}
        </label>
        <input
          type="date"
          value={expiry}
          onChange={(event) => setExpiry(event.target.value)}
          className="rounded-lg bg-[#172238] px-3 py-2 text-xs"
        />
      </div>
      <div className="flex gap-2">
        <button
          disabled={saving}
          onClick={() => void saveProfile()}
          className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold disabled:opacity-40"
        >
          {copy.saveLicenseProfile}
        </button>
        <button
          disabled={saving || !profileId}
          onClick={() => void saveAssignment()}
          className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-black disabled:opacity-40"
        >
          {copy.applyToCode}
        </button>
      </div>
    </div>
  );
}

function getCaseStatusLabels(copy: Messages["admin"]): Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> {
  return {
    open: {
      label: copy.statuses.open,
      color: "oklch(0.65 0.15 220)",
      icon: <AlertTriangle size={11} />,
    },
    in_progress: {
      label: copy.statuses.inProgress,
      color: "oklch(0.75 0.16 80)",
      icon: <Clock size={11} />,
    },
    closed: {
      label: copy.statuses.closed,
      color: "oklch(0.65 0.15 145)",
      icon: <CheckCircle2 size={11} />,
    },
    suspended: {
      label: copy.statuses.suspended,
      color: "oklch(0.55 0.08 260)",
      icon: <PauseCircle size={11} />,
    },
  };
}

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
  sub?: string;
  accent?: string;
}) {
  const color = accent ?? "oklch(0.78 0.15 75)";
  return (
    <div
      className="rounded-2xl p-4 flex items-center gap-3"
      style={{
        background: "oklch(0.16 0.03 240)",
        border: "1px solid oklch(1 0 0 / 8%)",
      }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{
          background: `${color} / 15%`.replace("/ 15%", ""),
          opacity: 0.85,
        }}
      >
        <span style={{ color }}>{icon}</span>
      </div>
      <div className="min-w-0">
        <div className="text-xl font-bold text-white">{value ?? "…"}</div>
        <div className="text-xs opacity-50 leading-tight">{label}</div>
        {sub && (
          <div className="text-[10px] mt-0.5" style={{ color }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

type BulkCaseRow = {
  caseNumber: string;
  idNumber: string;
  name: string;
  title: string;
  description: string;
  status: "open" | "in_progress" | "closed" | "suspended";
};
const emptyBulkRow = (): BulkCaseRow => ({
  caseNumber: "",
  idNumber: "",
  name: "",
  title: "",
  description: "",
  status: "open",
});

function BulkCaseModal({
  userCode,
  deviceId,
  onClose,
}: {
  userCode: string;
  deviceId: string;
  onClose: () => void;
}) {
  const { messages } = useI18n();
  const copy = messages.admin;
  const createBulk = useMutation(api.cases.createCasesBulk);
  const [rows, setRows] = useState<BulkCaseRow[]>(() =>
    Array.from({ length: 10 }, emptyBulkRow),
  );
  const [saving, setSaving] = useState(false);
  const update = (index: number, field: keyof BulkCaseRow, value: string) =>
    setRows((current) =>
      current.map((row, i) =>
        i === index ? ({ ...row, [field]: value } as BulkCaseRow) : row,
      ),
    );
  const submit = async () => {
    const filled = rows.filter(
      (row) =>
        row.caseNumber.trim() ||
        row.idNumber.trim() ||
        row.name.trim() ||
        row.title.trim() ||
        row.description.trim(),
    );
    if (!filled.length) {
      toast.error(copy.needAtLeastOneCase);
      return;
    }
    setSaving(true);
    try {
      const result = await createBulk({ userCode, deviceId, cases: filled });
      toast.success(copy.bulkCreated(result.count));
      onClose();
    } catch (error) {
      toast.error(
        error instanceof ConvexError
          ? (error.data as { message: string }).message
          : copy.bulkCreateFailed,
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[40000] flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92dvh] w-full max-w-4xl overflow-hidden rounded-t-2xl bg-[#111b30] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <div>
            <h2 className="font-bold text-white">{copy.bulkTitle}</h2>
            <p className="text-xs text-white/40">{copy.bulkSubtitle}</p>
          </div>
          <button onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="max-h-[68dvh] space-y-3 overflow-auto p-4">
          {rows.map((row, index) => (
            <div
              key={index}
              className="rounded-xl border border-white/10 bg-white/5 p-3"
            >
              <div className="mb-2 text-xs font-bold text-amber-300">
                {copy.bulkItem(index)}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                <input
                  value={row.caseNumber}
                  onChange={(e) =>
                    update(index, "caseNumber", e.target.value.toUpperCase())
                  }
                  placeholder={copy.caseNumber}
                  className="rounded-lg bg-black/25 px-3 py-2 text-xs outline-none"
                />
                <input
                  value={row.idNumber}
                  onChange={(e) =>
                    update(index, "idNumber", e.target.value.toUpperCase())
                  }
                  placeholder={copy.idNumber}
                  className="rounded-lg bg-black/25 px-3 py-2 text-xs outline-none"
                />
                <input
                  value={row.name}
                  onChange={(e) => update(index, "name", e.target.value)}
                  placeholder={copy.name}
                  className="rounded-lg bg-black/25 px-3 py-2 text-xs outline-none"
                />
                <input
                  value={row.title}
                  onChange={(e) => update(index, "title", e.target.value)}
                  placeholder={copy.caseName}
                  className="rounded-lg bg-black/25 px-3 py-2 text-xs outline-none"
                />
                <select
                  value={row.status}
                  onChange={(e) => update(index, "status", e.target.value)}
                  className="rounded-lg bg-[#172238] px-3 py-2 text-xs"
                >
                  <option value="open">{copy.statuses.open}</option>
                  <option value="in_progress">{copy.statuses.inProgress}</option>
                  <option value="closed">{copy.statuses.closed}</option>
                  <option value="suspended">{copy.statuses.suspended}</option>
                </select>
                <input
                  value={row.description}
                  onChange={(e) => update(index, "description", e.target.value)}
                  placeholder={copy.optionalDescription}
                  className="col-span-2 rounded-lg bg-black/25 px-3 py-2 text-xs outline-none sm:col-span-1"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 border-t border-white/10 p-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-white/10 py-3 text-sm"
          >
            {copy.cancel}
          </button>
          <button
            disabled={saving}
            onClick={() => void submit()}
            className="flex-1 rounded-xl bg-amber-500 py-3 text-sm font-bold text-black disabled:opacity-40"
          >
            {saving ? copy.creating : copy.createBulk}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { locale, messages } = useI18n();
  const copy = messages.admin;
  const caseStatusLabels = getCaseStatusLabels(copy);
  const localeTag = localeToHtmlLang(locale);
  const location = useLocation();
  const navigate = useNavigate();
  const sessionCode = localStorage.getItem("ksc_session_code") ?? "";
  const deviceId = localStorage.getItem("ksc_device_id") ?? "";
  const password = `${sessionCode}:${deviceId}`;
  const routeTabs: Record<string, AdminTab> = {
    "/admin": "dashboard",
    "/admin/cases": "cases",
    "/admin/documents": "cases",
    "/admin/authorization-codes": "codes",
    "/admin/online-status": "online",
    "/admin/calls": "calls",
    "/admin/managers": "managers",
  };
  const activeTab = routeTabs[location.pathname] ?? "dashboard";
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [caseSearch, setCaseSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [msgSearch, setMsgSearch] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newCodeTier, setNewCodeTier] = useState<"standard" | "advanced">(
    "standard",
  );
  const [showBulkCases, setShowBulkCases] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const sessionRole = useQuery(
    api.authCodes.getSessionRole,
    sessionCode && deviceId ? { code: sessionCode, deviceId } : "skip",
  );
  const isSuperAdmin = sessionRole?.role === "super_admin";
  const canManageCallCompliance = isSuperAdmin || sessionRole?.role === "admin";

  // PDF upload state
  const [docCaseNumber, setDocCaseNumber] = useState("");
  const [docIdNumber, setDocIdNumber] = useState("");
  const [docName, setDocName] = useState("");
  const [docCaseName, setDocCaseName] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docUploading, setDocUploading] = useState(false);

  const stats = useQuery(api.admin.getStats, { password });
  const codes = useQuery(api.admin.getAllCodes, { password });
  const allowedCodes = useQuery(api.admin.getAllowedCodes, { password });
  const licenseProfiles = useQuery(api.features.listProfiles, { password });
  const allMessages = useQuery(
    api.admin.getAllMessages,
    activeTab === "messages" ? { password } : "skip",
  );
  const allCases = useQuery(
    api.admin.getAllCases,
    activeTab === "cases" ? { password } : "skip",
  );
  const activeCalls = useQuery(
    api.admin.getActiveCalls,
    activeTab === "calls" ? { password } : "skip",
  );
  const complianceDashboard = useQuery(
    api.callCompliance.adminDashboard,
    activeTab === "calls" && canManageCallCompliance ? { password } : "skip",
  );
  const caseDocuments = useQuery(
    api.caseDocuments.listAll,
    activeTab === "cases" ? { password } : "skip",
  );

  const resetCode = useMutation(api.admin.resetCode);
  const deleteUser = useMutation(api.admin.deleteUser);
  const updateCaseStatus = useMutation(api.admin.updateCaseStatusAdmin);
  const deleteCaseAdmin = useMutation(api.admin.deleteCaseAdmin);
  const updateCaseDetails = useMutation(api.cases.updateCaseDetails);
  const generateDocUploadUrl = useMutation(api.caseDocuments.generateUploadUrl);
  const saveDocument = useMutation(api.caseDocuments.saveDocument);
  const deleteDocument = useMutation(api.caseDocuments.deleteDocument);
  const createLicensedCode = useMutation(api.features.createAuthorizationCode);
  const createLicenseProfile = useMutation(api.features.createProfile);
  const migrateLicenses = useMutation(api.features.migrateUnassignedCodes);
  const createOrPromoteAdmin = useMutation(
    api.roleManagement.createOrPromoteAdmin,
  );
  const setSystemRole = useMutation(api.roleManagement.setRole);
  const setCodeEnabled = useMutation(api.roleManagement.setEnabled);
  const deleteAuthCode = useMutation(api.roleManagement.deleteCode);
  const cleanupStaleCalls = useMutation(api.admin.cleanupStaleCalls);
  const requestCallRecording = useMutation(api.callCompliance.request);
  const stopCallRecording = useMutation(api.callCompliance.stop);
  const setCallTranslation = useMutation(api.callCompliance.setTranslation);

  const handleCreateCode = async () => {
    try {
      if (activeTab === "managers") {
        const result = await createOrPromoteAdmin({
          password,
          targetCode: newCode,
        });
        toast.success(copy.createManagerSuccess(result.created));
      } else {
        if (isSuperAdmin) {
          const requestedProfileName =
            newCodeTier === "advanced"
              ? FULL_PROFILE_NAME
              : LIMITED_PROFILE_NAME;
          let requestedProfile = licenseProfiles?.find(
            (profile) => profile.name === requestedProfileName,
          )?._id;
          if (!requestedProfile) {
            requestedProfile = await createLicenseProfile({
              password,
              name: requestedProfileName,
              description:
                newCodeTier === "advanced"
                  ? copy.advancedProfileDescription
                  : copy.limitedProfileDescription,
              features:
                newCodeTier === "advanced"
                  ? ADVANCED_LICENSE_FLAGS
                  : LIMITED_LICENSE_FLAGS,
            });
          }
          await createLicensedCode({
            password,
            targetCode: newCode,
            profileId: requestedProfile,
          });
        } else await createLicensedCode({ password, targetCode: newCode });
        toast.success(
          newCodeTier === "advanced"
            ? copy.advancedCodeCreated
            : copy.limitedCodeCreated,
        );
      }
      setNewCode("");
    } catch (error) {
      toast.error(
        error instanceof ConvexError
          ? (error.data as { message: string }).message
          : copy.createAdminFailed,
      );
    }
  };

  const handleReset = async (code: string) => {
    try {
      await resetCode({ password, code });
      toast.success(copy.codeResetSuccess(code));
    } catch (err) {
      if (err instanceof ConvexError)
        toast.error((err.data as { message: string }).message);
    }
  };

  const handleDelete = async (code: string) => {
    if (!window.confirm(copy.deleteCodeConfirm(code)))
      return;
    try {
      if (isSuperAdmin) await deleteAuthCode({ password, targetCode: code });
      else await deleteUser({ password, code });
      toast.success(copy.codeDeletedSuccess(code));
    } catch (err) {
      if (err instanceof ConvexError)
        toast.error((err.data as { message: string }).message);
    }
  };

  const handleCaseStatus = async (
    caseId: Id<"cases">,
    status: "open" | "in_progress" | "closed" | "suspended",
  ) => {
    try {
      await updateCaseStatus({ password, caseId, status });
      toast.success(copy.caseStatusUpdated);
    } catch {
      toast.error(copy.updateFailed);
    }
  };

  const handleDeleteCase = async (caseId: Id<"cases">) => {
    try {
      await deleteCaseAdmin({ password, caseId });
      toast.success(copy.caseDeleted);
    } catch {
      toast.error(copy.deleteFailed);
    }
  };

  const handleEditCase = async (
    record: NonNullable<typeof allCases>[number],
  ) => {
    const caseNumber = window.prompt(copy.promptCaseNumber, record.caseNumber);
    if (caseNumber === null) return;
    const idNumber = window.prompt(copy.promptNewIdNumber, "");
    if (idNumber === null) return;
    const title = window.prompt(copy.promptCaseTitle, record.title);
    if (title === null) return;
    const description = window.prompt(copy.promptCaseDescription, record.description);
    if (description === null) return;
    const adminContent = window.prompt(copy.promptAdminNotes, record.adminContent ?? "");
    if (adminContent === null) return;
    try {
      await updateCaseDetails({
        caseId: record._id,
        userCode: sessionCode,
        deviceId,
        caseNumber,
        idNumber: idNumber || undefined,
        title,
        description,
        adminContent: adminContent || undefined,
        status: record.status,
      });
      toast.success(copy.caseUpdated);
    } catch (err) {
      toast.error(
        err instanceof ConvexError
          ? (err.data as { message: string }).message
          : copy.updateFailed,
      );
    }
  };

  const handleDocUpload = async () => {
    if (
      !docCaseNumber.trim() ||
      !docIdNumber.trim() ||
      !docName.trim() ||
      !docCaseName.trim() ||
      !docFile
    ) {
      toast.error(copy.uploadFieldsRequired);
      return;
    }
    setDocUploading(true);
    try {
      const uploadUrl = await generateDocUploadUrl({ password });
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": docFile.type || "application/octet-stream" },
        body: docFile,
      });
      if (!res.ok) throw new Error(copy.uploadHttpFailed(res.status));
      const { storageId } = (await res.json()) as { storageId?: string };
      if (!storageId) throw new Error(copy.uploadMissingStorageId);
      await saveDocument({
        password,
        caseNumber: docCaseNumber.trim(),
        idNumber: docIdNumber.trim(),
        name: docName.trim(),
        caseName: docCaseName.trim(),
        fileName: docFile.name,
        storageId: storageId as unknown as Id<"_storage">,
      });
      toast.success(copy.attachmentUploaded);
      setDocCaseNumber("");
      setDocIdNumber("");
      setDocName("");
      setDocCaseName("");
      setDocFile(null);
    } catch (error) {
      const message =
        error instanceof ConvexError
          ? ((error.data as { message?: string } | undefined)?.message ??
            copy.uploadFailed)
          : uiErrorMessage(error, copy.uploadFailed);
      toast.error(message);
    } finally {
      setDocUploading(false);
    }
  };

  const handleDeleteDoc = async (docId: Id<"case_documents">) => {
    try {
      await deleteDocument({ password, documentId: docId });
      toast.success(copy.documentDeleted);
    } catch {
      toast.error(copy.deleteFailed);
    }
  };

  const usedCodes = new Set((codes ?? []).map((c) => c.code));

  useEffect(() => {
    if (activeTab !== "calls") return;
    void cleanupStaleCalls({ password }).catch(() => undefined);
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeTab, cleanupStaleCalls, password]);

  const formatCallDuration = (startedAt: number) => {
    const seconds = Math.max(0, Math.floor((clock - startedAt) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const rest = (seconds % 60).toString().padStart(2, "0");
    return hours > 0 ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
  };
  const formatDateTime = (value: number | string | Date) =>
    new Date(value).toLocaleString(localeTag);
  const formatDate = (value: number) => new Date(value).toLocaleDateString(localeTag);

  const filteredUsers = (codes ?? []).filter((r) => {
    const q = userSearch.toLowerCase();
    return r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q);
  });

  const filteredCases = (allCases ?? []).filter((c) => {
    const q = caseSearch.toLowerCase();
    return (
      c.caseNumber.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.assignedName.toLowerCase().includes(q) ||
      (c.suspectName ?? "").toLowerCase().includes(q)
    );
  });

  const filteredMessages = (allMessages ?? []).filter((m) => {
    const q = msgSearch.toLowerCase();
    return (
      m.senderName.toLowerCase().includes(q) ||
      m.senderCode.toLowerCase().includes(q) ||
      (m.text ?? "").toLowerCase().includes(q)
    );
  });
  const fullProfileId = licenseProfiles?.find(
    (profile) => profile.name === FULL_PROFILE_NAME,
  )?._id;
  const limitedProfileId = licenseProfiles?.find(
    (profile) => LEGACY_LIMITED_PROFILE_NAMES.includes(profile.name),
  )?._id;
  const selectedProfileId =
    newCodeTier === "advanced" ? fullProfileId : limitedProfileId;
  const selectedTierCodes = (allowedCodes ?? []).filter(
    (item) => item.licenseProfileId === selectedProfileId,
  );
  const selectedTierUsed = selectedTierCodes.filter((item) =>
    usedCodes.has(item.code),
  ).length;

  const tabs = [
    {
      key: "dashboard" as AdminTab,
      label: copy.tabs.dashboard,
      icon: <BarChart3 size={13} />,
    },
    {
      key: "codes" as AdminTab,
      label: copy.tabs.codes,
      icon: <Key size={13} />,
    },
    {
      key: "online" as AdminTab,
      label: copy.tabs.online,
      icon: <Users size={13} />,
    },
    {
      key: "calls" as AdminTab,
      label: copy.tabs.calls,
      icon: <Video size={13} />,
    },
    {
      key: "cases" as AdminTab,
      label: copy.tabs.cases,
      icon: <FolderOpen size={13} />,
    },
    ...(isSuperAdmin
      ? [
          {
            key: "managers" as AdminTab,
            label: copy.tabs.managers,
            icon: <Shield size={13} />,
          },
        ]
      : []),
  ] satisfies { key: AdminTab; label: string; icon: React.ReactNode }[];
  const tabPath: Record<string, string> = {
    dashboard: "/admin",
    codes: "/admin/authorization-codes",
    online: "/admin/online-status",
    calls: "/admin/calls",
    cases: "/admin/cases",
    managers: "/admin/managers",
  };

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background: "oklch(0.10 0.03 240)",
        color: "oklch(0.92 0.01 240)",
      }}
    >
      {/* Header */}
      <div
        data-app-header
        className="flex flex-wrap items-center gap-2 px-4 py-3 border-b shrink-0"
        style={{ borderColor: "oklch(1 0 0 / 8%)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "oklch(0.78 0.15 75 / 20%)" }}
          >
            <Shield size={16} style={{ color: "oklch(0.78 0.15 75)" }} />
          </div>
          <span className="text-sm font-bold tracking-wide">
            {copy.headerTitle}
          </span>
        </div>
        <button
          onClick={() => window.location.assign("/consultation")}
          className="ml-auto text-xs opacity-60 hover:opacity-100 cursor-pointer"
        >
          {copy.caseOps}
        </button>
        <button
          onClick={() => {
            localStorage.removeItem("ksc_session_code");
            localStorage.removeItem("ksc_session_role");
            window.dispatchEvent(new Event("chatconnect-session-changed"));
            window.location.assign("/");
          }}
          className="flex items-center gap-1.5 text-xs opacity-50 hover:opacity-80 cursor-pointer"
        >
          <LogOut size={14} />
          {copy.logout}
        </button>
      </div>

      {/* Tabs */}
      <div
        className="flex border-b shrink-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ borderColor: "oklch(1 0 0 / 8%)" }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => navigate(tabPath[tab.key] ?? "/admin")}
            className={cn(
              "flex-none min-w-[112px] flex items-center justify-center gap-1 py-3 text-xs transition-all cursor-pointer border-b-2 whitespace-nowrap px-3",
              activeTab === tab.key
                ? "border-yellow-500 text-yellow-400"
                : "border-transparent opacity-40 hover:opacity-70",
            )}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* ── Dashboard ─────────────────────────────────────────────── */}
        {activeTab === "dashboard" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold opacity-40 tracking-widest uppercase">
                {copy.dashboardTitle}
              </h2>
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={() => navigate("/admin/authorization-codes")}
                  className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-black"
                >
                  {copy.createCode}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                icon={<Users size={18} />}
                label={copy.registeredUsers}
                value={stats?.totalUsers}
              />
              <StatCard
                icon={<Key size={18} />}
                label={copy.unusedCodes}
                value={stats ? 50 - stats.totalUsers : undefined}
              />
              <StatCard
                icon={<UserCheck size={18} />}
                label={copy.contactPairs}
                value={stats?.totalContacts}
              />
              <StatCard
                icon={<MessageSquare size={18} />}
                label={copy.totalMessages}
                value={stats?.totalMessages}
              />
              <StatCard
                icon={<FolderOpen size={18} />}
                label={copy.totalCases}
                value={stats?.totalCases}
                sub={
                  stats
                    ? copy.casesSummary(stats.openCases, stats.inProgressCases)
                    : undefined
                }
                accent="oklch(0.75 0.16 80)"
              />
              <StatCard
                icon={<Video size={18} />}
                label={copy.activeCalls}
                value={stats?.activeGroupCalls}
                accent={
                  stats?.activeGroupCalls ? "oklch(0.65 0.15 145)" : undefined
                }
              />
            </div>
          </div>
        )}

        {/* ── Auth Codes ────────────────────────────────────────────── */}
        {(activeTab === "codes" || activeTab === "managers") && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold opacity-40 tracking-widest uppercase">
                {copy.codesTitle}
              </h2>
              <span className="text-xs opacity-40">
                {copy.usedCount(
                  activeTab === "codes" ? selectedTierUsed : usedCodes.size,
                  activeTab === "codes"
                    ? selectedTierCodes.length
                    : (allowedCodes?.length ?? 0),
                )}
              </span>
            </div>
            {!isSuperAdmin && activeTab === "codes" && (
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-white/5 p-3">
                <button
                  type="button"
                  onClick={() => setNewCodeTier("standard")}
                  className={cn(
                    "rounded-lg border px-3 py-3 text-sm",
                    newCodeTier === "standard"
                      ? "border-blue-400 bg-blue-500/20 text-blue-100"
                      : "border-white/10 bg-black/10 text-white/50",
                  )}
                >
                  {copy.limitedTier}
                </button>
                <button
                  type="button"
                  onClick={() => setNewCodeTier("advanced")}
                  className={cn(
                    "rounded-lg border px-3 py-3 text-sm",
                    newCodeTier === "advanced"
                      ? "border-amber-400 bg-amber-500/20 text-amber-100"
                      : "border-white/10 bg-black/10 text-white/50",
                  )}
                >
                  {copy.fullTier}
                </button>
              </div>
            )}
            {isSuperAdmin &&
              (activeTab === "codes" || activeTab === "managers") && (
                <div className="space-y-3 rounded-xl bg-white/5 p-3">
                  <div className="flex gap-2">
                    <input
                      value={newCode}
                      onChange={(event) =>
                        setNewCode(
                          event.target.value
                            .normalize("NFKC")
                            .replace(/\s/g, "")
                            .toUpperCase(),
                        )
                      }
                      placeholder={
                        activeTab === "managers"
                          ? copy.createManagerPlaceholder
                          : copy.createCodePlaceholder
                      }
                      className="min-w-0 flex-1 rounded-lg bg-black/20 px-3 py-2 text-sm outline-none"
                    />
                    <button
                      disabled={!newCode.trim()}
                      onClick={() => void handleCreateCode()}
                      className="rounded-lg bg-amber-500 px-4 text-xs font-semibold text-black disabled:opacity-40"
                    >
                      {activeTab === "managers"
                        ? copy.makeManager
                        : newCodeTier === "advanced"
                          ? copy.addFullCode
                          : copy.addLimitedCode}
                    </button>
                  </div>
                  {activeTab === "codes" && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setNewCodeTier("standard")}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-xs",
                            newCodeTier === "standard"
                              ? "border-blue-400 bg-blue-500/20 text-blue-100"
                              : "border-white/10 bg-black/10 text-white/50",
                          )}
                        >
                          {copy.limitedTier}（
                          {
                            (allowedCodes ?? []).filter(
                              (item) =>
                                item.licenseProfileId === limitedProfileId,
                            ).length
                          }
                          )
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewCodeTier("advanced")}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-xs",
                            newCodeTier === "advanced"
                              ? "border-amber-400 bg-amber-500/20 text-amber-100"
                              : "border-white/10 bg-black/10 text-white/50",
                          )}
                        >
                          {copy.fullTier}（
                          {
                            (allowedCodes ?? []).filter(
                              (item) => item.licenseProfileId === fullProfileId,
                            ).length
                          }
                          )
                        </button>
                      </div>
                      {newCodeTier === "advanced" && (
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-amber-500/10 p-3 text-[10px] text-amber-100 sm:grid-cols-3">
                          {copy.featureSummary.map((feature: string, index: number) => (
                            <span key={feature}>
                              {index + 1}. {feature}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            {isSuperAdmin && activeTab === "codes" && (
              <button
                onClick={() =>
                  void migrateLicenses({ password })
                    .then((result) =>
                      toast.success(copy.defaultProfilesApplied(result.migrated)),
                    )
                    .catch(() => toast.error(copy.defaultProfilesApplyFailed))
                }
                className="w-full rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-200"
              >
                {copy.applyDefaultProfiles}
              </button>
            )}
            {/* Used codes */}
            {(codes ?? [])
              .filter(
                (record) =>
                  (activeTab !== "managers" ||
                    record.role === "admin" ||
                    record.role === "super_admin") &&
                  (activeTab !== "codes" ||
                    record.licenseProfileId === selectedProfileId),
              )
              .map((record) => {
                const isExpanded = expandedCode === record.code;
                return (
                  <div
                    key={record._id}
                    className="rounded-xl overflow-hidden"
                    style={{
                      background: "oklch(0.16 0.03 240)",
                      border: "1px solid oklch(1 0 0 / 8%)",
                    }}
                  >
                    <div
                      className="flex items-center justify-between px-4 py-3 cursor-pointer"
                      onClick={() =>
                        setExpandedCode(isExpanded ? null : record.code)
                      }
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-bold"
                          style={{
                            background: "oklch(0.35 0.12 145 / 25%)",
                            color: "oklch(0.65 0.15 145)",
                          }}
                        >
                          {copy.used}
                        </span>
                        <span className="text-sm font-mono font-bold text-white">
                          {record.code}
                        </span>
                        <span className="text-xs opacity-50">
                          {record.name}
                        </span>
                        {record.department && (
                          <span className="text-[10px] opacity-30">
                            {record.department}
                          </span>
                        )}
                      </div>
                      {isExpanded ? (
                        <ChevronUp size={14} className="opacity-40" />
                      ) : (
                        <ChevronDown size={14} className="opacity-40" />
                      )}
                    </div>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div
                            className="px-4 pb-4 pt-2 space-y-3 border-t"
                            style={{ borderColor: "oklch(1 0 0 / 8%)" }}
                          >
                            <div className="text-xs opacity-40 space-y-1">
                              <div>
                                {copy.mobileDevice}：
                                <span className="font-mono text-[10px]">
                                  {record.mobileDeviceId ??
                                    (record.desktopDeviceId
                                      ? copy.statuses.unregistered
                                      : record.deviceId)}
                                </span>
                              </div>
                              <div>
                                {copy.desktopDevice}：
                                <span className="font-mono text-[10px]">
                                  {record.desktopDeviceId ??
                                    copy.statuses.unregistered}
                                </span>
                              </div>
                              <div>
                                {copy.registeredAt}：
                                {formatDateTime(record.usedAt)}
                              </div>
                              <div>
                                {copy.role}：
                                {record.role === "super_admin"
                                  ? copy.superAdmin
                                  : record.role === "admin"
                                    ? copy.admin
                                    : copy.user}
                              </div>
                              <div>
                                {copy.status}：
                                {record.online
                                  ? copy.statuses.online
                                  : copy.statuses.offline}
                                ／
                                {record.enabled
                                  ? copy.statuses.enabled
                                  : copy.statuses.disabled}
                              </div>
                              {record.lastSeenAt && (
                                <div>
                                  {copy.lastSeen}：
                                  {formatDateTime(record.lastSeenAt)}
                                </div>
                              )}
                              {record.expiresAt && (
                                <div>
                                  {copy.expiresAt}：
                                  {formatDate(record.expiresAt)}
                                </div>
                              )}
                            </div>
                            {isSuperAdmin && activeTab === "codes" && (
                              <LicenseEditor
                                password={password}
                                code={record.code}
                                currentProfileId={record.licenseProfileId}
                                enabled={record.enabled}
                                expiresAt={record.expiresAt}
                              />
                            )}
                            {activeTab === "codes" &&
                              record.role !== "super_admin" && (
                                <div className="flex flex-wrap gap-2">
                                  {(isSuperAdmin || record.role === "user") && (
                                    <button
                                      onClick={() =>
                                        void handleReset(record.code)
                                      }
                                      className="flex items-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-300"
                                    >
                                      <LogOut size={12} />
                                      {copy.logoutDevice}
                                    </button>
                                  )}
                                  {isSuperAdmin && (
                                    <button
                                      onClick={() =>
                                        void handleDelete(record.code)
                                      }
                                      className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white"
                                    >
                                      <Trash2 size={12} />
                                      {copy.deleteCode}
                                    </button>
                                  )}
                                </div>
                              )}
                            {isSuperAdmin &&
                              activeTab === "managers" &&
                              record.role !== "super_admin" && (
                                <div className="flex gap-2 flex-wrap">
                                  <button
                                    onClick={() =>
                                      void setSystemRole({
                                        password,
                                        targetCode: record.code,
                                        role:
                                          record.role === "admin"
                                            ? "user"
                                            : "admin",
                                      }).then(() =>
                                        toast.success(copy.permissionUpdated),
                                      )
                                    }
                                    className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs text-amber-300"
                                  >
                                    {record.role === "admin"
                                      ? copy.removeAdminRole
                                      : copy.setAdminRole}
                                  </button>
                                  <button
                                    onClick={() =>
                                      void setCodeEnabled({
                                        password,
                                        targetCode: record.code,
                                        enabled: !record.enabled,
                                      }).then(() =>
                                        toast.success(copy.usageStateUpdated),
                                      )
                                    }
                                    className="rounded-lg bg-white/10 px-3 py-1.5 text-xs"
                                  >
                                    {record.enabled ? copy.disable : copy.enable}
                                  </button>
                                  <button
                                    onClick={() => handleReset(record.code)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer hover:opacity-80"
                                    style={{
                                      background: "oklch(0.55 0.14 250 / 25%)",
                                      color: "oklch(0.75 0.12 250)",
                                    }}
                                  >
                                    <RotateCcw size={12} />
                                    {copy.resetCode}
                                  </button>
                                  <button
                                    onClick={() => handleDelete(record.code)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer hover:opacity-80"
                                    style={{
                                      background: "oklch(0.55 0.22 25 / 20%)",
                                      color: "oklch(0.75 0.18 25)",
                                    }}
                                  >
                                    <Trash2 size={12} />
                                    {copy.deleteUser}
                                  </button>
                                </div>
                              )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            {/* Unused codes */}
            {activeTab === "codes" && (
              <div className="pt-2">
                <p className="text-[10px] opacity-30 tracking-widest uppercase mb-2">
                  {copy.unusedCodesTitle}
                </p>
                <div className="flex flex-wrap gap-2">
                  {(allowedCodes ?? [])
                    .filter(
                      (item) =>
                        !usedCodes.has(item.code) &&
                        item.licenseProfileId === selectedProfileId,
                    )
                    .map(({ code, role }) => (
                      <span
                        key={code}
                        className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-mono"
                        style={{
                          background: "oklch(0.14 0.02 240)",
                          border: "1px solid oklch(1 0 0 / 5%)",
                          color: "oklch(0.5 0.01 240)",
                        }}
                      >
                        {code}
                        {isSuperAdmin && role !== "super_admin" && (
                          <button
                            aria-label={copy.deleteCodeAria(code)}
                            onClick={() => void handleDelete(code)}
                            className="text-red-400 hover:text-red-300"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Users ─────────────────────────────────────────────────── */}
        {(activeTab === "users" || activeTab === "online") && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold opacity-40 tracking-widest uppercase">
                {copy.usersTitle}
              </h2>
              <span className="text-xs opacity-30">
                {copy.countItems(filteredUsers.length)}
              </span>
            </div>
            {/* Search */}
            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2.5"
              style={{
                background: "oklch(1 0 0 / 6%)",
                border: "1px solid oklch(1 0 0 / 8%)",
              }}
            >
              <Search size={13} className="text-white/40 shrink-0" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder={copy.searchUsersPlaceholder}
                className="flex-1 bg-transparent outline-none text-xs text-white placeholder:text-white/30"
              />
              {userSearch && (
                <button
                  onClick={() => setUserSearch("")}
                  className="opacity-40 cursor-pointer"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {codes === undefined && (
                <div className="text-xs opacity-30 text-center py-8">
                {copy.loading}
              </div>
            )}
            {codes?.length === 0 && (
              <div className="text-xs opacity-30 text-center py-8">
                {copy.noUsers}
              </div>
            )}
            {filteredUsers.map((record) => (
              <div
                key={record._id}
                className="flex items-center justify-between rounded-xl px-4 py-3"
                style={{
                  background: "oklch(0.16 0.03 240)",
                  border: "1px solid oklch(1 0 0 / 8%)",
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                    style={{ background: "oklch(0.3 0.05 260)" }}
                  >
                    {record.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">
                      {record.name}
                    </div>
                    {record.department && (
                      <div className="text-[10px] opacity-40 truncate">
                        {record.department}
                      </div>
                    )}
                    <div className="text-[10px] opacity-30 font-mono">
                      {record.code}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Cases ─────────────────────────────────────────────────── */}
        {activeTab === "cases" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold opacity-40 tracking-widest uppercase">
                {copy.casesTitle}
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs opacity-30">
                  {copy.countItems(filteredCases.length)}
                </span>
                <button
                  onClick={() =>
                    navigate("/consultation", {
                      state: { notificationTab: "cases" },
                    })
                  }
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black"
                >
                  {copy.addSingleCase}
                </button>
                <button
                  onClick={() => setShowBulkCases(true)}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  {copy.addBulkCases}
                </button>
              </div>
            </div>
            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2.5"
              style={{
                background: "oklch(1 0 0 / 6%)",
                border: "1px solid oklch(1 0 0 / 8%)",
              }}
            >
              <Search size={13} className="text-white/40 shrink-0" />
              <input
                type="text"
                value={caseSearch}
                onChange={(e) => setCaseSearch(e.target.value)}
                placeholder={copy.searchCasesPlaceholder}
                className="flex-1 bg-transparent outline-none text-xs text-white placeholder:text-white/30"
              />
              {caseSearch && (
                <button
                  onClick={() => setCaseSearch("")}
                  className="opacity-40 cursor-pointer"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {allCases === undefined && (
                <div className="text-xs opacity-30 text-center py-8">
                {copy.loading}
              </div>
            )}
            {allCases?.length === 0 && (
              <div className="text-xs opacity-30 text-center py-8">
                {copy.noCases}
              </div>
            )}
            {filteredCases.map((c) => {
              const st =
                caseStatusLabels[c.status] ?? caseStatusLabels["open"];
              return (
                <div
                  key={c._id}
                  className="rounded-xl px-4 py-3 space-y-2"
                  style={{
                    background: "oklch(0.16 0.03 240)",
                    border: "1px solid oklch(1 0 0 / 8%)",
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-mono opacity-40">
                          {c.caseNumber}
                        </span>
                        <span
                          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                          style={{
                            background: `${st.color} / 15%`.replace(
                              "/ 15%",
                              "",
                            ),
                            color: st.color,
                            border: `1px solid ${st.color}30`,
                          }}
                        >
                          {st.icon}
                          {st.label}
                        </span>
                      </div>
                      <div className="text-sm font-semibold text-white mt-0.5 truncate">
                        {c.title}
                      </div>
                      <div className="text-[10px] opacity-40 mt-0.5">
                        {copy.assignee}：{c.assignedName}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => void handleEditCase(c)}
                        className="p-1.5 rounded-lg cursor-pointer opacity-50 hover:opacity-90"
                        style={{ background: "oklch(0.5 0.1 230 / 20%)" }}
                        title={copy.edit}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => handleDeleteCase(c._id)}
                        className="p-1.5 rounded-lg cursor-pointer opacity-40 hover:opacity-80 shrink-0"
                        style={{ background: "oklch(0.55 0.22 25 / 15%)" }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  {/* Status quick-change */}
                  <div className="flex gap-1.5 flex-wrap">
                    {(
                      ["open", "in_progress", "closed", "suspended"] as const
                    ).map((s) => (
                      <button
                        key={s}
                        onClick={() => handleCaseStatus(c._id, s)}
                        className="text-[10px] px-2 py-1 rounded-full cursor-pointer transition-all"
                        style={{
                          background:
                            c.status === s
                              ? `${caseStatusLabels[s].color}25`
                              : "oklch(1 0 0 / 5%)",
                          color:
                            c.status === s
                              ? caseStatusLabels[s].color
                              : "oklch(0.6 0 0)",
                          border: `1px solid ${c.status === s ? caseStatusLabels[s].color + "50" : "oklch(1 0 0 / 8%)"}`,
                          fontWeight: c.status === s ? 700 : 400,
                        }}
                      >
                        {caseStatusLabels[s].label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Active Calls ──────────────────────────────────────────── */}
        {activeTab === "calls" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold opacity-40 tracking-widest uppercase">
                {copy.callsTitle}
              </h2>
              <span
                className="text-xs"
                style={{ color: "oklch(0.65 0.15 145)" }}
              >
                {copy.callsCount((activeCalls ?? []).length)}
              </span>
            </div>
            {activeCalls === undefined && (
              <div className="text-xs opacity-30 text-center py-8">
                {copy.loading}
              </div>
            )}
            {activeCalls?.length === 0 && (
              <div className="text-xs opacity-30 text-center py-8">
                {copy.noCalls}
              </div>
            )}
            {(activeCalls ?? []).map((call) => {
              const compliance = complianceDashboard?.find(
                (item) => item.callId === call.id,
              );
              return (
                <div
                  key={`${call.kind}-${call.id}`}
                  className="rounded-xl px-4 py-3 flex items-center gap-3"
                  style={{
                    background: "oklch(0.16 0.03 240)",
                    border: "1px solid oklch(1 0 0 / 8%)",
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "oklch(0.22 0.06 145 / 50%)" }}
                  >
                    <Video
                      size={16}
                      style={{ color: "oklch(0.65 0.15 145)" }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">
                      {"groupName" in call
                        ? call.groupName
                        : call.type === "video"
                          ? copy.directVideoCall
                          : copy.directVoiceCall}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-white/65">
                      {call.participants.map((participant) => (
                        <span key={participant.code}>
                          {participant.name}{" "}
                          <span className="font-mono text-white/35">
                            ({participant.code})
                          </span>
                        </span>
                      ))}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[10px]">
                      <span className="font-semibold text-emerald-400">
                        ● {copy.statuses.inCall}
                      </span>
                      <span className="text-white/35">
                        {copy.callDuration(formatCallDuration(call.startedAt))}
                      </span>
                    </div>
                  </div>
                  {canManageCallCompliance && (
                    <button
                      onClick={() =>
                        void (
                          compliance &&
                          ["requested", "active"].includes(compliance.status)
                            ? stopCallRecording({ password, callId: call.id })
                            : requestCallRecording({
                                password,
                                callId: call.id,
                              })
                        )
                          .then(() =>
                            toast.success(
                              compliance?.status === "active"
                                ? copy.recordingStopped
                                : copy.recordingRequested,
                            ),
                          )
                          .catch((error) =>
                            toast.error(
                              error instanceof ConvexError
                                ? (error.data as { message: string }).message
                                : copy.actionFailed,
                            ),
                          )
                      }
                      className={`rounded-lg px-3 py-2 text-xs font-bold ${compliance?.status === "active" ? "bg-red-600 text-white" : "bg-amber-500 text-black"}`}
                    >
                      {compliance?.status === "active"
                        ? copy.stopRecording
                        : compliance?.status === "requested"
                          ? copy.waitingRecordingConsent
                          : copy.requestRecording}
                    </button>
                  )}
                  {canManageCallCompliance &&
                    compliance?.status === "active" && (
                      <button
                        onClick={() =>
                          void setCallTranslation({
                            password,
                            callId: call.id,
                            enabled: !compliance.translationEnabled,
                          })
                            .then(() =>
                              toast.success(
                                compliance.translationEnabled
                                  ? copy.chineseTextStopped
                                  : copy.chineseTextStarted,
                              ),
                            )
                            .catch((error) =>
                              toast.error(
                                error instanceof ConvexError
                                  ? (error.data as { message: string }).message
                                  : copy.actionFailed,
                              ),
                            )
                        }
                        className={`rounded-lg px-3 py-2 text-xs font-bold ${compliance.translationEnabled ? "bg-blue-600 text-white" : "bg-emerald-500 text-black"}`}
                      >
                        {compliance.translationEnabled
                          ? copy.stopChineseText
                          : copy.startChineseText}
                      </button>
                    )}
                </div>
              );
            })}
            {canManageCallCompliance &&
              (complianceDashboard ?? []).length > 0 && (
                <div className="space-y-3 border-t border-white/10 pt-4">
                  <h3 className="text-xs font-bold text-white/60">
                    {copy.recordingsTitle}
                  </h3>
                  {complianceDashboard?.map((session) => (
                    <div
                      key={session._id}
                      className="rounded-xl border border-white/10 bg-white/5 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-amber-300">
                          {session.callId}
                        </span>
                        <span className="text-[10px] uppercase text-white/40">
                          {{
                            requested: copy.statuses.requested,
                            active: copy.statuses.active,
                            declined: copy.statuses.declined,
                            stopped: copy.statuses.stopped,
                          }[session.status] ?? session.status}
                        </span>
                      </div>
                      <div className="mt-2 max-h-36 space-y-1 overflow-auto rounded-lg bg-black/20 p-2">
                        {session.transcripts.length ? (
                          session.transcripts.map((line) => (
                            <p key={line._id} className="text-xs text-white/75">
                              <strong className="text-blue-300">
                                {line.speakerName}:
                              </strong>{" "}
                              {line.text}
                              {line.originalText &&
                                line.originalText !== line.text && (
                                  <span className="mt-0.5 block text-[10px] text-white/35">
                                    {copy.originalText}：{line.originalText}
                                  </span>
                                )}
                              {line.translated === false && (
                                <span className="ml-1 text-[10px] text-amber-400">
                                  （{copy.translationFailedHint}）
                                </span>
                              )}
                            </p>
                          ))
                        ) : (
                          <p className="text-xs text-white/30">
                            {copy.noTranslations}
                          </p>
                        )}
                      </div>
                      {session.recordings.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {session.recordings.map(
                            (recording) =>
                              recording.url && (
                                <audio
                                  key={recording._id}
                                  controls
                                  src={recording.url}
                                  className="h-8 max-w-full"
                                />
                              ),
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
          </div>
        )}

        {/* ── Documents ─────────────────────────────────────────────── */}
        {activeTab === "cases" && (
          <div className="space-y-4">
            <h2 className="border-t border-white/10 pt-4 text-xs font-semibold opacity-40 tracking-widest uppercase">
              {copy.documentsTitle}
            </h2>

            {/* Upload form */}
            <div
              className="rounded-2xl p-4 space-y-3"
              style={{
                background: "oklch(0.16 0.03 240)",
                border: "1px solid oklch(1 0 0 / 8%)",
              }}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Upload size={15} />
                {copy.uploadDocumentsTitle}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] opacity-40">{copy.caseNumber}</label>
                  <input
                    type="text"
                    value={docCaseNumber}
                    onChange={(e) => setDocCaseNumber(e.target.value)}
                    placeholder="CASE-20260101-0001"
                    className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none"
                    style={{
                      background: "oklch(1 0 0 / 7%)",
                      border: "1px solid oklch(1 0 0 / 10%)",
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] opacity-40">{copy.idNumber}</label>
                  <input
                    type="text"
                    value={docIdNumber}
                    onChange={(e) => setDocIdNumber(e.target.value)}
                    placeholder="A123456789"
                    className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none"
                    style={{
                      background: "oklch(1 0 0 / 7%)",
                      border: "1px solid oklch(1 0 0 / 10%)",
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] opacity-40">{copy.name}</label>
                  <input
                    type="text"
                    value={docName}
                    onChange={(e) => setDocName(e.target.value)}
                    placeholder={copy.name}
                    className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none"
                    style={{
                      background: "oklch(1 0 0 / 7%)",
                      border: "1px solid oklch(1 0 0 / 10%)",
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] opacity-40">{copy.caseName}</label>
                  <input
                    type="text"
                    value={docCaseName}
                    onChange={(e) => setDocCaseName(e.target.value)}
                    placeholder={copy.caseName}
                    className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none"
                    style={{
                      background: "oklch(1 0 0 / 7%)",
                      border: "1px solid oklch(1 0 0 / 10%)",
                    }}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] opacity-40">
                  {copy.attachmentsLabel}
                </label>
                <label
                  className="flex items-center justify-center gap-2 py-3 rounded-lg text-xs cursor-pointer transition-opacity hover:opacity-80"
                  style={{
                    background: "oklch(1 0 0 / 5%)",
                    border: "1px dashed oklch(1 0 0 / 15%)",
                    color: "oklch(0.7 0 0)",
                  }}
                >
                  <FileText size={14} />
                  {docFile ? docFile.name : copy.selectFile}
                  <input
                    type="file"
                    accept="*/*"
                    className="hidden"
                    onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              <button
                onClick={() => void handleDocUpload()}
                disabled={
                  docUploading ||
                  !docCaseNumber.trim() ||
                  !docIdNumber.trim() ||
                  !docName.trim() ||
                  !docCaseName.trim() ||
                  !docFile
                }
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-40 transition-opacity hover:opacity-90"
                style={{
                  background:
                    "linear-gradient(135deg, oklch(0.72 0.17 75), oklch(0.62 0.14 65))",
                  color: "oklch(0.12 0.03 250)",
                }}
              >
                {docUploading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Upload size={14} />
                )}
                {docUploading ? copy.uploading : copy.upload}
              </button>
            </div>

            {/* Uploaded documents list */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] opacity-30 tracking-widest uppercase">
                  {copy.uploadedFiles}
                </p>
                <span className="text-xs opacity-30">
                  {copy.countItems((caseDocuments ?? []).length)}
                </span>
              </div>
              {caseDocuments === undefined && (
                <div className="text-xs opacity-30 text-center py-8">
                  {copy.loading}
                </div>
              )}
              {caseDocuments?.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 opacity-30">
                  <FileText size={28} className="text-white" />
                  <p className="text-xs text-white">{copy.noUploadedFiles}</p>
                </div>
              )}
              {(caseDocuments ?? []).map((doc) => (
                <div
                  key={doc._id}
                  className="flex items-center gap-3 rounded-xl px-4 py-3"
                  style={{
                    background: "oklch(0.16 0.03 240)",
                    border: "1px solid oklch(1 0 0 / 8%)",
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "oklch(0.55 0.22 25 / 15%)" }}
                  >
                    <FileText
                      size={16}
                      style={{ color: "oklch(0.75 0.18 25)" }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-white truncate">
                      {doc.fileName}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] font-mono opacity-50">
                        {doc.caseNumber}
                      </span>
                      <span className="text-[10px] opacity-25">|</span>
                      <span className="text-[10px] opacity-40">
                        {copy.hashedIdNotice}
                      </span>
                    </div>
                    <div className="text-[10px] opacity-25 mt-0.5">
                      {formatDateTime(doc.uploadedAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {doc.url && (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                        title={copy.view}
                      >
                        <Eye size={13} className="opacity-50" />
                      </a>
                    )}
                    <button
                      onClick={() => void handleDeleteDoc(doc._id)}
                      className="p-2 rounded-lg cursor-pointer opacity-40 hover:opacity-80 transition-opacity"
                      title={copy.delete}
                      style={{ background: "oklch(0.55 0.22 25 / 15%)" }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Messages ──────────────────────────────────────────────── */}
        {activeTab === "messages" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold opacity-40 tracking-widest uppercase">
                {copy.messagesTitle}
              </h2>
              <span className="text-xs opacity-30">
                {copy.countItems(filteredMessages.length)}
              </span>
            </div>
            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2.5"
              style={{
                background: "oklch(1 0 0 / 6%)",
                border: "1px solid oklch(1 0 0 / 8%)",
              }}
            >
              <Search size={13} className="text-white/40 shrink-0" />
              <input
                type="text"
                value={msgSearch}
                onChange={(e) => setMsgSearch(e.target.value)}
                placeholder={copy.searchMessagesPlaceholder}
                className="flex-1 bg-transparent outline-none text-xs text-white placeholder:text-white/30"
              />
              {msgSearch && (
                <button
                  onClick={() => setMsgSearch("")}
                  className="opacity-40 cursor-pointer"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {allMessages === undefined && (
                <div className="text-xs opacity-30 text-center py-8">
                {copy.loading}
              </div>
            )}
            {allMessages?.length === 0 && (
              <div className="text-xs opacity-30 text-center py-8">
                {copy.noMessages}
              </div>
            )}
            {filteredMessages.map((msg) => (
              <div
                key={msg._id}
                className="rounded-xl px-4 py-3 space-y-1"
                style={{
                  background: "oklch(0.16 0.03 240)",
                  border: "1px solid oklch(1 0 0 / 8%)",
                }}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">
                      {msg.senderName}
                    </span>
                    <span className="text-[10px] font-mono opacity-40">
                      {msg.senderCode}
                    </span>
                  </div>
                  <span className="text-[10px] opacity-30">
                    {formatDateTime(msg.sentAt)}
                  </span>
                </div>
                {msg.type === "text" && (
                  <p className="text-sm opacity-70 leading-relaxed">
                    {msg.text}
                  </p>
                )}
                {msg.type === "image" && (
                  <p className="text-xs opacity-40">{copy.imageFile}</p>
                )}
                {msg.type === "video" && (
                  <p className="text-xs opacity-40">{copy.videoFile}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {showBulkCases && (
        <BulkCaseModal
          userCode={sessionCode}
          deviceId={deviceId}
          onClose={() => setShowBulkCases(false)}
        />
      )}
    </div>
  );
}
