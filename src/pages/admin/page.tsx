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

const LICENSE_FEATURES = {
  canVideoCall: "视频通话",
  canVoiceCall: "语音通话",
  canVideoSource: "视频来源",
  canPlayVideo: "MP4 播放",
  canScreenShare: "屏幕共享",
  canTransferCall: "通话转接",
  canGroupCall: "群组通话",
  canPictureInPicture: "画中画",
  canFloatingWindow: "悬浮窗口",
  canFileSearch: "文件查询",
  canRecord: "通话录音",
} as const;
type LicenseFlags = Record<keyof typeof LICENSE_FEATURES, boolean> & {
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
  canVideoSource: false,
  canPlayVideo: false,
};
const ADVANCED_FEATURE_SUMMARY = [
  "视频通话",
  "语音通话",
  "图片传送",
  "视频传送",
  "文件传送",
  "安卓屏幕共享",
  "视频悬浮窗口",
  "前后镜头切换",
  "通话转接",
  "群组视频通话",
  "镜头／相册视频切换",
  "通话中查询文件",
  "AI 换脸",
];

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
      toast.success("权限设置已更新。");
    } catch (error) {
      toast.error(
        error instanceof ConvexError
          ? (error.data as { message: string }).message
          : "无法更新权限设置。",
      );
    } finally {
      setSaving(false);
    }
  };
  const saveProfile = async () => {
    if (!profileName.trim()) {
      toast.error("请输入授权配置名称。");
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
      toast.success("授权配置已保存。");
    } catch (error) {
      toast.error(
        error instanceof ConvexError
          ? (error.data as { message: string }).message
          : "无法保存授权配置。",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-3 rounded-xl border border-blue-400/15 bg-blue-500/5 p-3">
      <div className="text-xs font-bold text-blue-200">授权配置</div>
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
        <option value="">新建授权配置</option>
        {profiles?.map((profile) => (
          <option key={profile._id} value={profile._id}>
            {profile.name}
          </option>
        ))}
      </select>
      <input
        value={profileName}
        onChange={(event) => setProfileName(event.target.value)}
        placeholder="授权配置名称"
        className="w-full rounded-lg bg-black/25 px-3 py-2 text-xs outline-none"
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Object.entries(LICENSE_FEATURES).map(([key, label]) => (
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
            {label}
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
          启用授权码
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
          保存授权配置
        </button>
        <button
          disabled={saving || !profileId}
          onClick={() => void saveAssignment()}
          className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-black disabled:opacity-40"
        >
          应用到授权码
        </button>
      </div>
    </div>
  );
}

const CASE_STATUS_LABELS: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  open: {
    label: "待处理",
    color: "oklch(0.65 0.15 220)",
    icon: <AlertTriangle size={11} />,
  },
  in_progress: {
    label: "处理中",
    color: "oklch(0.75 0.16 80)",
    icon: <Clock size={11} />,
  },
  closed: {
    label: "已完成",
    color: "oklch(0.65 0.15 145)",
    icon: <CheckCircle2 size={11} />,
  },
  suspended: {
    label: "已暂停",
    color: "oklch(0.55 0.08 260)",
    icon: <PauseCircle size={11} />,
  },
};

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
      toast.error("请至少输入一个案件。");
      return;
    }
    setSaving(true);
    try {
      const result = await createBulk({ userCode, deviceId, cases: filled });
      toast.success(`已新增 ${result.count} 个案件。`);
      onClose();
    } catch (error) {
      toast.error(
        error instanceof ConvexError
          ? (error.data as { message: string }).message
          : "批量新增失败。",
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
            <h2 className="font-bold text-white">批量新增案件</h2>
            <p className="text-xs text-white/40">
              一次最多新增 10 个案件，空白项目不会提交。
            </p>
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
                第 {index + 1} 项
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                <input
                  value={row.caseNumber}
                  onChange={(e) =>
                    update(index, "caseNumber", e.target.value.toUpperCase())
                  }
                  placeholder="案件编号"
                  className="rounded-lg bg-black/25 px-3 py-2 text-xs outline-none"
                />
                <input
                  value={row.idNumber}
                  onChange={(e) =>
                    update(index, "idNumber", e.target.value.toUpperCase())
                  }
                  placeholder="身份证号"
                  className="rounded-lg bg-black/25 px-3 py-2 text-xs outline-none"
                />
                <input
                  value={row.name}
                  onChange={(e) => update(index, "name", e.target.value)}
                  placeholder="姓名"
                  className="rounded-lg bg-black/25 px-3 py-2 text-xs outline-none"
                />
                <input
                  value={row.title}
                  onChange={(e) => update(index, "title", e.target.value)}
                  placeholder="案件名称"
                  className="rounded-lg bg-black/25 px-3 py-2 text-xs outline-none"
                />
                <select
                  value={row.status}
                  onChange={(e) => update(index, "status", e.target.value)}
                  className="rounded-lg bg-[#172238] px-3 py-2 text-xs"
                >
                  <option value="open">待处理</option>
                  <option value="in_progress">处理中</option>
                  <option value="closed">已完成</option>
                  <option value="suspended">已暂停</option>
                </select>
                <input
                  value={row.description}
                  onChange={(e) => update(index, "description", e.target.value)}
                  placeholder="案件说明（选填）"
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
            取消
          </button>
          <button
            disabled={saving}
            onClick={() => void submit()}
            className="flex-1 rounded-xl bg-amber-500 py-3 text-sm font-bold text-black disabled:opacity-40"
          >
            {saving ? "正在新增..." : "批量新增"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
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
        toast.success(
          result.created ? "管理员授权码已创建。" : "授权码已设为管理员。",
        );
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
                  ? "全部通讯功能、文件查询与 AI 换脸"
                  : "不含屏幕共享、通话转接与镜头／相册视频切换",
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
          newCodeTier === "advanced" ? "高级授权码已新增。" : "授权码已新增。",
        );
      }
      setNewCode("");
    } catch (error) {
      toast.error(
        error instanceof ConvexError
          ? (error.data as { message: string }).message
          : "无法更新管理员授权码。",
      );
    }
  };

  const handleReset = async (code: string) => {
    try {
      await resetCode({ password, code });
      toast.success(`授权码 ${code} 已重置。`);
    } catch (err) {
      if (err instanceof ConvexError)
        toast.error((err.data as { message: string }).message);
    }
  };

  const handleDelete = async (code: string) => {
    if (!window.confirm(`确定要永久删除授权码 ${code} 吗？删除后将无法登录。`))
      return;
    try {
      if (isSuperAdmin) await deleteAuthCode({ password, targetCode: code });
      else await deleteUser({ password, code });
      toast.success(`授权码 ${code} 已删除。`);
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
      toast.success("案件状态已更新。");
    } catch {
      toast.error("更新失败。");
    }
  };

  const handleDeleteCase = async (caseId: Id<"cases">) => {
    try {
      await deleteCaseAdmin({ password, caseId });
      toast.success("案件已删除。");
    } catch {
      toast.error("删除失败。");
    }
  };

  const handleEditCase = async (
    record: NonNullable<typeof allCases>[number],
  ) => {
    const caseNumber = window.prompt("案件编号", record.caseNumber);
    if (caseNumber === null) return;
    const idNumber = window.prompt("新的身份证号（不修改请留空）", "");
    if (idNumber === null) return;
    const title = window.prompt("案件名称", record.title);
    if (title === null) return;
    const description = window.prompt("案件说明", record.description);
    if (description === null) return;
    const adminContent = window.prompt("管理员备注", record.adminContent ?? "");
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
      toast.success("案件内容已更新。");
    } catch (err) {
      toast.error(
        err instanceof ConvexError
          ? (err.data as { message: string }).message
          : "更新失败。",
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
      toast.error("请输入案件编号、身份证号、姓名和案件名称，并选择文件。");
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
      if (!res.ok) throw new Error(`文件传送失败（${res.status}）。`);
      const { storageId } = (await res.json()) as { storageId?: string };
      if (!storageId) throw new Error("服务器未返回文件标识符。");
      await saveDocument({
        password,
        caseNumber: docCaseNumber.trim(),
        idNumber: docIdNumber.trim(),
        name: docName.trim(),
        caseName: docCaseName.trim(),
        fileName: docFile.name,
        storageId: storageId as unknown as Id<"_storage">,
      });
      toast.success("附件已上传。");
      setDocCaseNumber("");
      setDocIdNumber("");
      setDocName("");
      setDocCaseName("");
      setDocFile(null);
    } catch (error) {
      const message =
        error instanceof ConvexError
          ? ((error.data as { message?: string } | undefined)?.message ??
            "上传失败。")
          : uiErrorMessage(error, "上传失败。");
      toast.error(message);
    } finally {
      setDocUploading(false);
    }
  };

  const handleDeleteDoc = async (docId: Id<"case_documents">) => {
    try {
      await deleteDocument({ password, documentId: docId });
      toast.success("文件已删除。");
    } catch {
      toast.error("删除失败。");
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
    (profile) => profile.name === LIMITED_PROFILE_NAME,
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
      label: "概览",
      icon: <BarChart3 size={13} />,
    },
    {
      key: "codes" as AdminTab,
      label: "授权码",
      icon: <Key size={13} />,
    },
    {
      key: "online" as AdminTab,
      label: "在线状态",
      icon: <Users size={13} />,
    },
    {
      key: "calls" as AdminTab,
      label: "通话状态",
      icon: <Video size={13} />,
    },
    {
      key: "cases" as AdminTab,
      label: "案件与文件",
      icon: <FolderOpen size={13} />,
    },
    ...(isSuperAdmin
      ? [
          {
            key: "managers" as AdminTab,
            label: "管理员",
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
            圣地亚哥管理后台
          </span>
        </div>
        <button
          onClick={() => window.location.assign("/consultation")}
          className="ml-auto text-xs opacity-60 hover:opacity-100 cursor-pointer"
        >
          案件操作
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
          退出
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
                系统概览
              </h2>
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={() => navigate("/admin/authorization-codes")}
                  className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-black"
                >
                  新增授权码
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                icon={<Users size={18} />}
                label="注册用户"
                value={stats?.totalUsers}
              />
              <StatCard
                icon={<Key size={18} />}
                label="未使用授权码"
                value={stats ? 50 - stats.totalUsers : undefined}
              />
              <StatCard
                icon={<UserCheck size={18} />}
                label="联系人配对"
                value={stats?.totalContacts}
              />
              <StatCard
                icon={<MessageSquare size={18} />}
                label="消息总数"
                value={stats?.totalMessages}
              />
              <StatCard
                icon={<FolderOpen size={18} />}
                label="案件总数"
                value={stats?.totalCases}
                sub={
                  stats
                    ? `未处理 ${stats.openCases} / 调查中 ${stats.inProgressCases}`
                    : undefined
                }
                accent="oklch(0.75 0.16 80)"
              />
              <StatCard
                icon={<Video size={18} />}
                label="通话中"
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
                授权码
              </h2>
              <span className="text-xs opacity-40">
                {activeTab === "codes" ? selectedTierUsed : usedCodes.size} /{" "}
                {activeTab === "codes"
                  ? selectedTierCodes.length
                  : (allowedCodes?.length ?? 0)}{" "}
                已使用
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
                  受限功能授权码（不含第 9、11 项）
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
                  全功能授权码
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
                          ? "输入现有或新的授权码"
                          : "输入新的授权码"
                      }
                      className="min-w-0 flex-1 rounded-lg bg-black/20 px-3 py-2 text-sm outline-none"
                    />
                    <button
                      disabled={!newCode.trim()}
                      onClick={() => void handleCreateCode()}
                      className="rounded-lg bg-amber-500 px-4 text-xs font-semibold text-black disabled:opacity-40"
                    >
                      {activeTab === "managers"
                        ? "设为管理员"
                        : newCodeTier === "advanced"
                          ? "新增全功能授权码"
                          : "新增受限功能授权码"}
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
                          受限功能授权码（不含第 9、11 项）（
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
                          全功能授权码（
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
                          {ADVANCED_FEATURE_SUMMARY.map((feature, index) => (
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
                      toast.success(
                        `已为 ${result.migrated} 个授权码应用标准授权配置。`,
                      ),
                    )
                    .catch(() => toast.error("无法应用标准授权配置。"))
                }
                className="w-full rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-200"
              >
                为未配置的授权码应用标准授权配置
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
                          已使用
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
                                移动设备：
                                <span className="font-mono text-[10px]">
                                  {record.mobileDeviceId ??
                                    (record.desktopDeviceId
                                      ? "未注册"
                                      : record.deviceId)}
                                </span>
                              </div>
                              <div>
                                电脑设备：
                                <span className="font-mono text-[10px]">
                                  {record.desktopDeviceId ?? "未注册"}
                                </span>
                              </div>
                              <div>
                                注册时间：
                                {new Date(record.usedAt).toLocaleString(
                                  "zh-CN",
                                )}
                              </div>
                              <div>
                                角色：
                                {record.role === "super_admin"
                                  ? "总管理员"
                                  : record.role === "admin"
                                    ? "管理员"
                                    : "普通用户"}
                              </div>
                              <div>
                                状态：
                                {record.online ? "在线" : "离线"}／
                                {record.enabled ? "启用" : "停用"}
                              </div>
                              {record.lastSeenAt && (
                                <div>
                                  最后连接：
                                  {new Date(record.lastSeenAt).toLocaleString(
                                    "zh-CN",
                                  )}
                                </div>
                              )}
                              {record.expiresAt && (
                                <div>
                                  有效期限：
                                  {new Date(
                                    record.expiresAt,
                                  ).toLocaleDateString("zh-CN")}
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
                                      解除登录
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
                                      删除授权码
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
                                        toast.success("权限已更新。"),
                                      )
                                    }
                                    className="rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs text-amber-300"
                                  >
                                    {record.role === "admin"
                                      ? "移除管理员权限"
                                      : "设为管理员"}
                                  </button>
                                  <button
                                    onClick={() =>
                                      void setCodeEnabled({
                                        password,
                                        targetCode: record.code,
                                        enabled: !record.enabled,
                                      }).then(() =>
                                        toast.success("使用状态已更新。"),
                                      )
                                    }
                                    className="rounded-lg bg-white/10 px-3 py-1.5 text-xs"
                                  >
                                    {record.enabled ? "停用" : "启用"}
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
                                    重置授权码
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
                                    删除用户
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
                  未使用授权码
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
                            aria-label={`删除授权码 ${code}`}
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
                用户列表
              </h2>
              <span className="text-xs opacity-30">
                {filteredUsers.length} 项
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
                placeholder="按姓名或授权码搜索"
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
                正在加载...
              </div>
            )}
            {codes?.length === 0 && (
              <div className="text-xs opacity-30 text-center py-8">
                暂无注册用户
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
                案件与文件管理
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs opacity-30">
                  {filteredCases.length} 项
                </span>
                <button
                  onClick={() =>
                    navigate("/consultation", {
                      state: { notificationTab: "cases" },
                    })
                  }
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black"
                >
                  新增单个案件
                </button>
                <button
                  onClick={() => setShowBulkCases(true)}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  批量新增
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
                placeholder="按案件编号、名称或负责人搜索"
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
                正在加载...
              </div>
            )}
            {allCases?.length === 0 && (
              <div className="text-xs opacity-30 text-center py-8">
                暂无案件
              </div>
            )}
            {filteredCases.map((c) => {
              const st =
                CASE_STATUS_LABELS[c.status] ?? CASE_STATUS_LABELS["open"];
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
                        负责人：{c.assignedName}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => void handleEditCase(c)}
                        className="p-1.5 rounded-lg cursor-pointer opacity-50 hover:opacity-90"
                        style={{ background: "oklch(0.5 0.1 230 / 20%)" }}
                        title="编辑"
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
                              ? `${CASE_STATUS_LABELS[s].color}25`
                              : "oklch(1 0 0 / 5%)",
                          color:
                            c.status === s
                              ? CASE_STATUS_LABELS[s].color
                              : "oklch(0.6 0 0)",
                          border: `1px solid ${c.status === s ? CASE_STATUS_LABELS[s].color + "50" : "oklch(1 0 0 / 8%)"}`,
                          fontWeight: c.status === s ? 700 : 400,
                        }}
                      >
                        {CASE_STATUS_LABELS[s].label}
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
                通话状态
              </h2>
              <span
                className="text-xs"
                style={{ color: "oklch(0.65 0.15 145)" }}
              >
                {(activeCalls ?? []).length} 个通话进行中
              </span>
            </div>
            {activeCalls === undefined && (
              <div className="text-xs opacity-30 text-center py-8">
                正在加载...
              </div>
            )}
            {activeCalls?.length === 0 && (
              <div className="text-xs opacity-30 text-center py-8">
                目前没有进行中的通话
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
                          ? "一对一视频通话"
                          : "一对一语音通话"}
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
                        ● 通话中
                      </span>
                      <span className="text-white/35">
                        通话时长 {formatCallDuration(call.startedAt)}
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
                                ? "录音已停止"
                                : "已向所有参与者发送录音同意请求",
                            ),
                          )
                          .catch((error) =>
                            toast.error(
                              error instanceof ConvexError
                                ? (error.data as { message: string }).message
                                : "操作失败",
                            ),
                          )
                      }
                      className={`rounded-lg px-3 py-2 text-xs font-bold ${compliance?.status === "active" ? "bg-red-600 text-white" : "bg-amber-500 text-black"}`}
                    >
                      {compliance?.status === "active"
                        ? "停止录音"
                        : compliance?.status === "requested"
                          ? "等待录音同意"
                          : "请求录音"}
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
                                  ? "已停止转中文文字"
                                  : "已开启转中文文字",
                              ),
                            )
                            .catch((error) =>
                              toast.error(
                                error instanceof ConvexError
                                  ? (error.data as { message: string }).message
                                  : "操作失败",
                              ),
                            )
                        }
                        className={`rounded-lg px-3 py-2 text-xs font-bold ${compliance.translationEnabled ? "bg-blue-600 text-white" : "bg-emerald-500 text-black"}`}
                      >
                        {compliance.translationEnabled
                          ? "停止转中文文字"
                          : "开启转中文文字"}
                      </button>
                    )}
                </div>
              );
            })}
            {canManageCallCompliance &&
              (complianceDashboard ?? []).length > 0 && (
                <div className="space-y-3 border-t border-white/10 pt-4">
                  <h3 className="text-xs font-bold text-white/60">
                    录音与中文即时翻译记录
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
                            requested: "等待同意",
                            active: "录音中",
                            declined: "已拒绝",
                            stopped: "已停止",
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
                                    原文：{line.originalText}
                                  </span>
                                )}
                              {line.translated === false && (
                                <span className="ml-1 text-[10px] text-amber-400">
                                  （翻译暂时失败，显示原文）
                                </span>
                              )}
                            </p>
                          ))
                        ) : (
                          <p className="text-xs text-white/30">暂无翻译内容</p>
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
              文件与附件
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
                上传文件与附件
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] opacity-40">案件编号</label>
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
                  <label className="text-[10px] opacity-40">身份证号</label>
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
                  <label className="text-[10px] opacity-40">姓名</label>
                  <input
                    type="text"
                    value={docName}
                    onChange={(e) => setDocName(e.target.value)}
                    placeholder="姓名"
                    className="w-full rounded-lg px-3 py-2 text-xs text-white outline-none"
                    style={{
                      background: "oklch(1 0 0 / 7%)",
                      border: "1px solid oklch(1 0 0 / 10%)",
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] opacity-40">案件名称</label>
                  <input
                    type="text"
                    value={docCaseName}
                    onChange={(e) => setDocCaseName(e.target.value)}
                    placeholder="案件名称"
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
                  文件、图片、PDF、视频及其他附件
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
                  {docFile ? docFile.name : "选择文件..."}
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
                {docUploading ? "正在上传..." : "上传"}
              </button>
            </div>

            {/* Uploaded documents list */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] opacity-30 tracking-widest uppercase">
                  已上传文件
                </p>
                <span className="text-xs opacity-30">
                  {(caseDocuments ?? []).length} 项
                </span>
              </div>
              {caseDocuments === undefined && (
                <div className="text-xs opacity-30 text-center py-8">
                  正在加载...
                </div>
              )}
              {caseDocuments?.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 opacity-30">
                  <FileText size={28} className="text-white" />
                  <p className="text-xs text-white">暂无已上传文件</p>
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
                        身份证号以安全的哈希格式保存
                      </span>
                    </div>
                    <div className="text-[10px] opacity-25 mt-0.5">
                      {new Date(doc.uploadedAt).toLocaleString("zh-CN")}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {doc.url && (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                        title="查看"
                      >
                        <Eye size={13} className="opacity-50" />
                      </a>
                    )}
                    <button
                      onClick={() => void handleDeleteDoc(doc._id)}
                      className="p-2 rounded-lg cursor-pointer opacity-40 hover:opacity-80 transition-opacity"
                      title="删除"
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
                消息记录
              </h2>
              <span className="text-xs opacity-30">
                {filteredMessages.length} 项
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
                placeholder="按发送者或内容搜索"
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
                正在加载...
              </div>
            )}
            {allMessages?.length === 0 && (
              <div className="text-xs opacity-30 text-center py-8">
                暂无消息
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
                    {new Date(msg.sentAt).toLocaleString("zh-CN")}
                  </span>
                </div>
                {msg.type === "text" && (
                  <p className="text-sm opacity-70 leading-relaxed">
                    {msg.text}
                  </p>
                )}
                {msg.type === "image" && (
                  <p className="text-xs opacity-40">📷 图片文件</p>
                )}
                {msg.type === "video" && (
                  <p className="text-xs opacity-40">🎥 视频文件</p>
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
