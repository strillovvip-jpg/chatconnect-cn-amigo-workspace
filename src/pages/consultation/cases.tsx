import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  Search,
  X,
  ChevronRight,
  AlertTriangle,
  Clock,
  CheckCircle2,
  PauseCircle,
  Filter,
  Trash2,
  FileText,
  MapPin,
  User,
  Hash,
} from "lucide-react";
import { useQuery, useMutation, usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import { motion, AnimatePresence } from "motion/react";

type CaseStatus = Doc<"cases">["status"];
type CasePriority = Doc<"cases">["priority"];

const STATUS_LABEL: Record<CaseStatus, string> = {
  open: "待处理",
  in_progress: "处理中",
  closed: "已结案",
  suspended: "已暂停",
};
const STATUS_COLOR: Record<CaseStatus, string> = {
  open: "oklch(0.65 0.18 145)",
  in_progress: "oklch(0.72 0.17 75)",
  closed: "oklch(0.55 0.01 240)",
  suspended: "oklch(0.65 0.18 35)",
};
const STATUS_BG: Record<CaseStatus, string> = {
  open: "oklch(0.65 0.18 145 / 15%)",
  in_progress: "oklch(0.72 0.17 75 / 15%)",
  closed: "oklch(0.55 0.01 240 / 25%)",
  suspended: "oklch(0.65 0.18 35 / 15%)",
};
const STATUS_ICON: Record<CaseStatus, React.ReactNode> = {
  open: <Clock size={12} />,
  in_progress: <AlertTriangle size={12} />,
  closed: <CheckCircle2 size={12} />,
  suspended: <PauseCircle size={12} />,
};
const PRIORITY_LABEL: Record<CasePriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};
const PRIORITY_COLOR: Record<CasePriority, string> = {
  low: "oklch(0.65 0.08 220)",
  medium: "oklch(0.72 0.14 75)",
  high: "oklch(0.65 0.2 35)",
  urgent: "oklch(0.6 0.25 25)",
};

const CATEGORIES = [
  "Fraud",
  "Theft",
  "Assault",
  "Narcotics",
  "Cybercrime",
  "Missing Person",
  "Other",
];
const CATEGORY_LABEL: Record<string, string> = {
  Fraud: "诈骗",
  Theft: "盗窃",
  Assault: "袭击",
  Narcotics: "毒品",
  Cybercrime: "网络犯罪",
  "Missing Person": "失踪人员",
  Other: "其他",
};
const PRIORITIES: { value: CasePriority; label: string }[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "urgent", label: "紧急" },
];

function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <span
      className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: STATUS_BG[status], color: STATUS_COLOR[status] }}
    >
      {STATUS_ICON[status]}
      {STATUS_LABEL[status]}
    </span>
  );
}

function PriorityDot({ priority }: { priority: CasePriority }) {
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
      style={{
        color: PRIORITY_COLOR[priority],
        background: `${PRIORITY_COLOR[priority]}20`,
      }}
    >
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

// --- New Case Modal ---
function NewCaseModal({
  userCode,
  userName,
  onClose,
}: {
  userCode: string;
  userName: string;
  onClose: () => void;
}) {
  const createCase = useMutation(api.cases.createCase);
  const [form, setForm] = useState({
    caseNumber: "",
    idNumber: "",
    title: "",
    category: CATEGORIES[0],
    priority: "medium" as CasePriority,
    description: "",
    adminContent: "",
    suspectName: "",
    location: "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.caseNumber.trim() || !form.idNumber.trim()) {
      toast.error("请输入案件编号和证件号码。");
      return;
    }
    if (!form.title.trim()) {
      toast.error("请输入案件名称。");
      return;
    }
    if (!form.description.trim()) {
      toast.error("请输入案件摘要。");
      return;
    }
    setSaving(true);
    try {
      await createCase({
        userCode,
        deviceId: localStorage.getItem("ksc_device_id") ?? "",
        userName,
        caseNumber: form.caseNumber
          .normalize("NFKC")
          .replace(/[‐‑‒–—―]/g, "-")
          .trim()
          .toUpperCase(),
        idNumber: form.idNumber.normalize("NFKC").trim().toUpperCase(),
        title: form.title.trim(),
        category: form.category,
        priority: form.priority,
        description: form.description.trim(),
        adminContent: form.adminContent.trim() || undefined,
        suspectName: form.suspectName.trim() || undefined,
        location: form.location.trim() || undefined,
      });
      toast.success("案件已创建。");
      onClose();
    } catch (err) {
      if (err instanceof ConvexError)
        toast.error((err.data as { message: string }).message);
      else toast.error("发生错误，请稍后重试。");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    background: "oklch(1 0 0 / 7%)",
    border: "1px solid oklch(1 0 0 / 12%)",
    color: "white",
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "oklch(0 0 0 / 70%)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="w-full max-w-lg rounded-t-3xl overflow-hidden"
        style={{ background: "oklch(0.13 0.03 240)", maxHeight: "92dvh" }}
      >
        <div className="overflow-y-auto max-h-[92dvh]">
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 pt-5 pb-4 border-b sticky top-0 z-10"
            style={{
              background: "oklch(0.13 0.03 240)",
              borderColor: "oklch(1 0 0 / 8%)",
            }}
          >
            <div className="w-10 h-1 rounded-full bg-white/20 mx-auto absolute left-1/2 -translate-x-1/2 top-2" />
            <h2 className="text-base font-semibold text-white mt-2">
              新建案件
            </h2>
            <button
              onClick={onClose}
              className="cursor-pointer opacity-50 hover:opacity-100 mt-2"
            >
              <X size={20} className="text-white" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4 pb-8">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-white/50">案件编号 *</label>
                <input
                  value={form.caseNumber}
                  onChange={(e) => set("caseNumber", e.target.value)}
                  placeholder="CASE-2026-001"
                  className="w-full rounded-xl px-3 py-3 text-sm outline-none"
                  style={inputStyle}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-white/50">证件号码 *</label>
                <input
                  value={form.idNumber}
                  onChange={(e) => set("idNumber", e.target.value)}
                  placeholder="A123456789"
                  className="w-full rounded-xl px-3 py-3 text-sm outline-none"
                  style={inputStyle}
                />
              </div>
            </div>
            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-xs text-white/50 tracking-wide">
                案件名称 *
              </label>
              <input
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="例如：市中心盗窃案调查"
                className="w-full rounded-xl px-4 py-3 text-sm outline-none placeholder:text-white/25"
                style={inputStyle}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-white/50">管理员补充信息</label>
              <textarea
                value={form.adminContent}
                onChange={(e) => set("adminContent", e.target.value)}
                rows={4}
                placeholder="向用户显示的补充信息"
                className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none"
                style={inputStyle}
              />
            </div>

            {/* Category + Priority */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-white/50 tracking-wide">
                  案件类别
                </label>
                <select
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                  className="w-full rounded-xl px-3 py-3 text-sm outline-none appearance-none cursor-pointer"
                  style={inputStyle}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c} style={{ background: "#1a2540" }}>
                      {CATEGORY_LABEL[c] ?? c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-white/50 tracking-wide">
                  优先级
                </label>
                <select
                  value={form.priority}
                  onChange={(e) =>
                    set("priority", e.target.value as CasePriority)
                  }
                  className="w-full rounded-xl px-3 py-3 text-sm outline-none appearance-none cursor-pointer"
                  style={inputStyle}
                >
                  {PRIORITIES.map((p) => (
                    <option
                      key={p.value}
                      value={p.value}
                      style={{ background: "#1a2540" }}
                    >
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-xs text-white/50 tracking-wide">
                案件摘要 *
              </label>
              <textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="请输入案件详情"
                rows={3}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none placeholder:text-white/25"
                style={inputStyle}
              />
            </div>

            {/* Location */}
            <div className="space-y-1.5">
              <label className="text-xs text-white/50 tracking-wide">
                地点
              </label>
              <input
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="例如：圣迭戈市中心"
                className="w-full rounded-xl px-4 py-3 text-sm outline-none placeholder:text-white/25"
                style={inputStyle}
              />
            </div>

            {/* Suspect */}
            <div
              className="rounded-2xl p-4 space-y-3"
              style={{
                background: "oklch(1 0 0 / 4%)",
                border: "1px solid oklch(1 0 0 / 8%)",
              }}
            >
              <p className="text-xs text-white/40 font-semibold tracking-wide uppercase">
                涉案人员信息（选填）
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-white/40">姓名</label>
                  <input
                    value={form.suspectName}
                    onChange={(e) => set("suspectName", e.target.value)}
                    placeholder="姓名"
                    className="w-full rounded-xl px-3 py-2.5 text-sm outline-none placeholder:text-white/20"
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full py-3.5 rounded-xl text-sm font-bold tracking-wide cursor-pointer disabled:opacity-50 transition-all active:scale-95"
              style={{
                background:
                  "linear-gradient(135deg, oklch(0.72 0.17 75), oklch(0.62 0.14 65))",
                color: "oklch(0.12 0.03 250)",
              }}
            >
              {saving ? "正在创建..." : "创建案件"}
            </button>
          </form>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Case Detail Modal ---
function CaseDetailModal({
  caseData,
  userCode,
  onClose,
}: {
  caseData: Doc<"cases">;
  userCode: string;
  onClose: () => void;
}) {
  const updateStatus = useMutation(api.cases.updateCaseStatus);
  const deleteCase = useMutation(api.cases.deleteCase);
  const [updating, setUpdating] = useState(false);

  const handleStatus = async (status: CaseStatus) => {
    setUpdating(true);
    try {
      await updateStatus({
        caseId: caseData._id,
        status,
        userCode,
        deviceId: localStorage.getItem("ksc_device_id") ?? "",
      });
      toast.success("状态已更新。");
    } catch {
      toast.error("更新失败。");
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteCase({
        caseId: caseData._id,
        userCode,
        deviceId: localStorage.getItem("ksc_device_id") ?? "",
      });
      toast.success("案件已删除。");
      onClose();
    } catch (err) {
      if (err instanceof ConvexError)
        toast.error((err.data as { message: string }).message);
    }
  };

  const isOwner =
    localStorage.getItem("ksc_session_role") === "admin" &&
    caseData.assignedCode === userCode;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "oklch(0 0 0 / 70%)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="w-full max-w-lg rounded-t-3xl overflow-hidden"
        style={{ background: "oklch(0.13 0.03 240)", maxHeight: "92dvh" }}
      >
        <div className="overflow-y-auto max-h-[92dvh]">
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 pt-5 pb-4 border-b sticky top-0 z-10"
            style={{
              background: "oklch(0.13 0.03 240)",
              borderColor: "oklch(1 0 0 / 8%)",
            }}
          >
            <div className="w-10 h-1 rounded-full bg-white/20 mx-auto absolute left-1/2 -translate-x-1/2 top-2" />
            <div className="flex items-center gap-2 mt-2">
              <StatusBadge status={caseData.status} />
              <PriorityDot priority={caseData.priority} />
            </div>
            <button
              onClick={onClose}
              className="cursor-pointer opacity-50 hover:opacity-100 mt-2"
            >
              <X size={20} className="text-white" />
            </button>
          </div>

          <div className="p-5 space-y-5 pb-8">
            {/* Case number + title */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[11px] font-mono text-white/40">
                <Hash size={10} />
                {caseData.caseNumber}
              </div>
              <h2 className="text-lg font-bold text-white leading-snug">
                {caseData.title}
              </h2>
              <div className="flex flex-wrap gap-2 mt-1">
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                  style={{
                    background: "oklch(1 0 0 / 8%)",
                    color: "oklch(0.75 0.02 240)",
                  }}
                >
                  {CATEGORY_LABEL[caseData.category] ?? caseData.category}
                </span>
              </div>
            </div>

            {/* Info grid */}
            <div
              className="rounded-2xl p-4 space-y-3"
              style={{
                background: "oklch(1 0 0 / 5%)",
                border: "1px solid oklch(1 0 0 / 8%)",
              }}
            >
              <div className="flex items-start gap-2 text-sm">
                <User size={14} className="text-white/40 mt-0.5 shrink-0" />
                <div>
                  <span className="text-white/40 text-xs">负责人：</span>
                  <span className="text-white/80">{caseData.assignedName}</span>
                </div>
              </div>
              {caseData.location && (
                <div className="flex items-start gap-2 text-sm">
                  <MapPin size={14} className="text-white/40 mt-0.5 shrink-0" />
                  <span className="text-white/80">{caseData.location}</span>
                </div>
              )}
              <div className="flex items-start gap-2 text-sm">
                <Clock size={14} className="text-white/40 mt-0.5 shrink-0" />
                <div>
                  <span className="text-white/40 text-xs">创建时间：</span>
                  <span className="text-white/60 text-xs">
                    {new Date(caseData.createdAt).toLocaleString("zh-CN")}
                  </span>
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <p className="text-xs text-white/40 tracking-wide uppercase font-semibold">
                案件摘要
              </p>
              <p className="text-sm text-white/80 leading-relaxed">
                {caseData.description}
              </p>
            </div>

            {/* Suspect */}
            {(caseData.suspectName || caseData.suspectIdNumber) && (
              <div
                className="rounded-2xl p-4 space-y-2"
                style={{
                  background: "oklch(0.55 0.22 25 / 8%)",
                  border: "1px solid oklch(0.55 0.22 25 / 20%)",
                }}
              >
                <p
                  className="text-xs font-semibold tracking-wide uppercase"
                  style={{ color: "oklch(0.75 0.15 25)" }}
                >
                  涉案人员信息
                </p>
                {caseData.suspectName && (
                  <div className="flex items-center gap-2 text-sm">
                    <User size={13} style={{ color: "oklch(0.75 0.15 25)" }} />
                    <span className="text-white/80">
                      {caseData.suspectName}
                    </span>
                  </div>
                )}
                {caseData.suspectIdNumber && (
                  <div className="flex items-center gap-2 text-sm">
                    <Hash size={13} style={{ color: "oklch(0.75 0.15 25)" }} />
                    <span className="text-white/80 font-mono">
                      {caseData.suspectIdNumber}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Status change (owner only) */}
            {isOwner && (
              <div className="space-y-2">
                <p className="text-xs text-white/40 tracking-wide uppercase font-semibold">
                  更改状态
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      "open",
                      "in_progress",
                      "closed",
                      "suspended",
                    ] as CaseStatus[]
                  ).map((s) => (
                    <button
                      key={s}
                      onClick={() => void handleStatus(s)}
                      disabled={updating || caseData.status === s}
                      className={cn(
                        "py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all disabled:opacity-40",
                        caseData.status === s
                          ? "ring-2 ring-white/30"
                          : "hover:opacity-80",
                      )}
                      style={{
                        background: STATUS_BG[s],
                        color: STATUS_COLOR[s],
                        border: `1px solid ${STATUS_COLOR[s]}40`,
                      }}
                    >
                      <span className="flex items-center justify-center gap-1.5">
                        {STATUS_ICON[s]}
                        {STATUS_LABEL[s]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Delete (owner only) */}
            {isOwner && (
              <button
                onClick={handleDelete}
                className="w-full py-3 rounded-xl text-sm font-semibold cursor-pointer transition-opacity hover:opacity-80 flex items-center justify-center gap-2"
                style={{
                  background: "oklch(0.55 0.22 25 / 15%)",
                  color: "oklch(0.75 0.15 25)",
                  border: "1px solid oklch(0.55 0.22 25 / 25%)",
                }}
              >
                <Trash2 size={15} />
                删除案件
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Main Cases Page ---
type Props = {
  userCode: string;
  userName: string;
  onBack: () => void;
};

export default function CasesPage({ userCode, userName, onBack }: Props) {
  const deviceId = localStorage.getItem("ksc_device_id") ?? "";
  const canManage = localStorage.getItem("ksc_session_role") === "admin";
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<CaseStatus | "all">("all");
  const [showNew, setShowNew] = useState(false);
  const [selectedCase, setSelectedCase] = useState<Doc<"cases"> | null>(null);
  const [view, setView] = useState<"all" | "mine">("all");

  const {
    results,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(
    api.cases.listCases,
    filterStatus !== "all"
      ? { userCode, deviceId, status: filterStatus }
      : { userCode, deviceId },
    { initialNumItems: 30 },
  );

  const searchResults = useQuery(
    api.cases.searchCases,
    searchQuery.trim().length >= 1
      ? { query: searchQuery.trim(), userCode, deviceId }
      : "skip",
  );

  const myCases = useQuery(
    api.cases.getMyCases,
    view === "mine" ? { userCode, deviceId } : "skip",
  );

  const displayCases =
    searchQuery.trim().length >= 1
      ? (searchResults ?? [])
      : view === "mine"
        ? (myCases ?? [])
        : results;

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background: "oklch(0.11 0.03 240)",
        color: "oklch(0.92 0.01 240)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{ borderColor: "oklch(1 0 0 / 8%)" }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="cursor-pointer opacity-60 hover:opacity-100 transition-opacity p-1"
          >
            <ArrowLeft size={20} className="text-white" />
          </button>
          <div>
            <h1 className="text-sm font-bold text-white">案件管理</h1>
            <p className="text-[10px] text-white/40">
              共 {results.length} 个案件
            </p>
          </div>
        </div>
        {canManage && (
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-opacity hover:opacity-80"
            style={{
              background:
                "linear-gradient(135deg, oklch(0.72 0.17 75), oklch(0.62 0.14 65))",
              color: "oklch(0.12 0.03 250)",
            }}
          >
            <Plus size={14} />
            新建案件
          </button>
        )}
      </div>

      {/* Search */}
      <div
        className="px-4 pt-3 pb-2 space-y-2 border-b shrink-0"
        style={{ borderColor: "oklch(1 0 0 / 6%)" }}
      >
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2.5"
          style={{
            background: "oklch(1 0 0 / 7%)",
            border: "1px solid oklch(1 0 0 / 10%)",
          }}
        >
          <Search size={14} className="text-white/40 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="按案件名称、编号或涉案人员搜索"
            className="flex-1 bg-transparent outline-none text-xs text-white placeholder:text-white/30"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="opacity-40 cursor-pointer"
            >
              <X size={12} className="text-white" />
            </button>
          )}
        </div>

        {/* Filter bar */}
        <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
          {/* View toggle */}
          <button
            onClick={() => setView(view === "all" ? "mine" : "all")}
            className={cn(
              "shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold cursor-pointer transition-all",
              view === "mine"
                ? "text-white"
                : "text-white/40 hover:text-white/70",
            )}
            style={
              view === "mine"
                ? {
                    background: "oklch(0.5 0.07 220 / 40%)",
                    border: "1px solid oklch(0.5 0.07 220 / 50%)",
                  }
                : {
                    background: "oklch(1 0 0 / 5%)",
                    border: "1px solid transparent",
                  }
            }
          >
            <Filter size={10} />
            我的案件
          </button>

          {/* Status filters */}
          {(
            ["all", "open", "in_progress", "closed", "suspended"] as (
              CaseStatus | "all"
            )[]
          ).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={cn(
                "shrink-0 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold cursor-pointer transition-all whitespace-nowrap",
                filterStatus === s
                  ? "text-white"
                  : "text-white/40 hover:text-white/70",
              )}
              style={
                filterStatus === s
                  ? s === "all"
                    ? {
                        background: "oklch(1 0 0 / 15%)",
                        border: "1px solid oklch(1 0 0 / 20%)",
                      }
                    : {
                        background: STATUS_BG[s as CaseStatus],
                        border: `1px solid ${STATUS_COLOR[s as CaseStatus]}40`,
                        color: STATUS_COLOR[s as CaseStatus],
                      }
                  : {
                      background: "oklch(1 0 0 / 5%)",
                      border: "1px solid transparent",
                    }
              }
            >
              {s === "all" ? "全部" : STATUS_LABEL[s as CaseStatus]}
            </button>
          ))}
        </div>
      </div>

      {/* Cases list */}
      <div className="flex-1 overflow-auto">
        {displayCases.length === 0 && (
          <div className="flex flex-col items-center justify-center h-52 gap-3 opacity-30">
            <FileText size={32} className="text-white" />
            <p className="text-sm text-white">未找到案件</p>
            {searchQuery && (
              <p className="text-xs text-white">请尝试更改搜索条件</p>
            )}
          </div>
        )}

        {displayCases.map((c) => (
          <motion.button
            key={c._id}
            layout
            onClick={() => setSelectedCase(c)}
            className="w-full flex items-start gap-3 px-4 py-3.5 text-left border-b cursor-pointer hover:bg-white/5 transition-colors"
            style={{ borderColor: "oklch(1 0 0 / 5%)" }}
          >
            {/* Priority indicator */}
            <div
              className="w-1 rounded-full shrink-0 mt-1"
              style={{ height: 40, background: PRIORITY_COLOR[c.priority] }}
            />
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-white leading-snug line-clamp-2">
                  {c.title}
                </p>
                <ChevronRight
                  size={14}
                  className="text-white/25 shrink-0 mt-0.5"
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={c.status} />
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    background: "oklch(1 0 0 / 6%)",
                    color: "oklch(0.65 0.02 240)",
                  }}
                >
                  {CATEGORY_LABEL[c.category] ?? c.category}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-white/30">
                <span className="font-mono">{c.caseNumber}</span>
                <span>•</span>
                <span>{new Date(c.createdAt).toLocaleDateString("zh-CN")}</span>
              </div>
            </div>
          </motion.button>
        ))}

        {pageStatus === "CanLoadMore" && !searchQuery && view === "all" && (
          <div className="py-4 flex justify-center">
            <button
              onClick={() => loadMore(30)}
              className="text-xs text-white/40 cursor-pointer hover:text-white/70 transition-colors"
            >
              加载更多
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      <AnimatePresence>
        {canManage && showNew && (
          <NewCaseModal
            userCode={userCode}
            userName={userName}
            onClose={() => setShowNew(false)}
          />
        )}
        {selectedCase && (
          <CaseDetailModal
            key={selectedCase._id}
            caseData={selectedCase}
            userCode={userCode}
            onClose={() => setSelectedCase(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
