import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  LogOut,
  Search,
  Users,
  MessageSquare,
  UserPlus,
  X,
  UserCheck,
  Trash2,
  Building2,
  Video,
  Phone,
  FileText,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { motion } from "motion/react";
import CasesPage from "./cases.tsx";
import GroupCallPage from "./group-call.tsx";
import CaseDocSearch from "./case-doc-search.tsx";
import { useCall } from "@/contexts/call-context.tsx";
import { useFeatures } from "@/contexts/feature-context.tsx";
import { NotificationBellButton } from "@/contexts/notification-context.tsx";
import {
  PreCallSelector,
  type OutgoingCallSelection,
} from "@/components/pre-call-selector.tsx";

type Tab = "messages" | "cases" | "contacts" | "groupcall" | "docsearch";

type Props = {
  userName: string;
  userCode: string;
  onLogout: () => void;
};

type SearchResult = {
  code: string;
  name: string;
  department?: string;
};

function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const sz =
    size === "sm"
      ? "w-8 h-8 text-xs"
      : size === "lg"
        ? "w-14 h-14 text-lg"
        : "w-11 h-11 text-sm";
  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-bold shrink-0 text-white",
        sz,
      )}
      style={{ background: "oklch(0.32 0.07 265)" }}
    >
      {name.charAt(0)}
    </div>
  );
}

function AddContactModal({
  userCode,
  onClose,
  initialSearch,
}: {
  userCode: string;
  onClose: () => void;
  initialSearch?: string;
}) {
  const [searchInput, setSearchInput] = useState(initialSearch ?? "");
  const [debouncedSearch] = useDebounce(searchInput, 350);
  const results = useQuery(
    api.contacts.searchUser,
    debouncedSearch.trim().length >= 1
      ? {
          query: debouncedSearch.trim(),
          requesterCode: userCode,
          deviceId: localStorage.getItem("ksc_device_id") ?? "",
        }
      : "skip",
  ) as SearchResult[] | undefined | null;

  const addContact = useMutation(api.contacts.addContact);
  const [addingCode, setAddingCode] = useState<string | null>(null);

  const handleAdd = async (target: SearchResult) => {
    setAddingCode(target.code);
    try {
      await addContact({
        ownerCode: userCode,
        targetCode: target.code,
        deviceId: localStorage.getItem("ksc_device_id") ?? "",
      });
      toast.success(`已向 ${target.name} 发送好友请求。`);
      onClose();
    } catch (err) {
      if (err instanceof ConvexError) {
        toast.error((err.data as { message: string }).message);
      } else {
        toast.error("发生错误，请稍后重试。");
      }
    } finally {
      setAddingCode(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "oklch(0 0 0 / 65%)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: "spring", stiffness: 340, damping: 30 }}
        className="w-full max-w-sm rounded-t-3xl p-5 pb-8 space-y-4"
        style={{
          background: "oklch(0.15 0.03 240)",
          border: "1px solid oklch(1 0 0 / 8%)",
        }}
      >
        {/* Handle */}
        <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-2" />

        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">添加联系人</h2>
          <button
            onClick={onClose}
            className="cursor-pointer opacity-50 hover:opacity-100 transition-opacity"
          >
            <X size={20} className="text-white" />
          </button>
        </div>

        <div
          className="flex items-center gap-3 rounded-2xl px-4 py-3"
          style={{
            background: "oklch(1 0 0 / 7%)",
            border: "1px solid oklch(1 0 0 / 10%)",
          }}
        >
          <Search size={16} className="text-white/40 shrink-0" />
          <input
            autoFocus
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="按姓名或授权码搜索"
            className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/30"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              className="opacity-40 cursor-pointer"
            >
              <X size={14} className="text-white" />
            </button>
          )}
        </div>

        <div className="min-h-[80px]">
          {debouncedSearch.trim().length >= 1 && results === undefined && (
            <div className="text-xs opacity-30 text-center py-4">
              正在搜索...
            </div>
          )}
          {debouncedSearch.trim().length >= 1 &&
            results !== undefined &&
            (Array.isArray(results) && results.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 opacity-30">
                <Search size={22} className="text-white" />
                <p className="text-xs text-white">未找到匹配结果</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(results ?? []).map((r) => (
                  <div
                    key={r.code}
                    className="flex items-center justify-between rounded-2xl px-4 py-3"
                    style={{
                      background: "oklch(1 0 0 / 5%)",
                      border: "1px solid oklch(1 0 0 / 8%)",
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar name={r.name} size="sm" />
                      <div>
                        <div className="text-sm font-medium text-white">
                          {r.name}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {r.department && (
                            <span className="flex items-center gap-1 text-[10px] text-white/40">
                              <Building2 size={9} />
                              {r.department}
                            </span>
                          )}
                          <span className="text-[10px] font-mono text-white/30">
                            {r.code}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => void handleAdd(r)}
                      disabled={addingCode === r.code}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer disabled:opacity-50 transition-opacity"
                      style={{
                        background: "oklch(0.55 0.22 25)",
                        color: "white",
                      }}
                    >
                      <UserPlus size={12} />
                      添加
                    </button>
                  </div>
                ))}
              </div>
            ))}
          {debouncedSearch.trim().length === 0 && (
            <p className="text-xs text-white/25 text-center py-4">
              请输入姓名或授权码
            </p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

type ContactDoc = {
  _id: string;
  targetCode: string;
  targetName: string;
  targetDepartment?: string;
};

function ContactsTab({
  userCode,
  userName,
  contacts,
  onStartCall,
  callingCode,
  onRemoveContact,
  navigate,
}: {
  userCode: string;
  userName: string;
  contacts: ContactDoc[] | undefined;
  onStartCall: (code: string, name: string, type: "audio" | "video") => void;
  callingCode: string | null;
  onRemoveContact: (code: string, name: string) => Promise<void>;
  navigate: (path: string, opts?: { state?: Record<string, string> }) => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 350);
  const addContact = useMutation(api.contacts.addContact);
  const [addingCode, setAddingCode] = useState<string | null>(null);

  // Server search for users to add
  const serverResults = useQuery(
    api.contacts.searchUser,
    debouncedSearch.trim().length >= 1
      ? {
          query: debouncedSearch.trim(),
          requesterCode: userCode,
          deviceId: localStorage.getItem("ksc_device_id") ?? "",
        }
      : "skip",
  ) as SearchResult[] | undefined;

  // Filter existing contacts locally
  const filteredContacts = (contacts ?? []).filter((c) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      c.targetName.toLowerCase().includes(q) ||
      c.targetCode.toLowerCase().includes(q) ||
      (c.targetDepartment ?? "").toLowerCase().includes(q)
    );
  });

  // Already-added codes
  const addedCodes = new Set((contacts ?? []).map((c) => c.targetCode));

  // Server results not yet in contacts
  const newUsers = (serverResults ?? []).filter((r) => !addedCodes.has(r.code));

  const handleAdd = async (target: SearchResult) => {
    setAddingCode(target.code);
    try {
      await addContact({
        ownerCode: userCode,
        targetCode: target.code,
        deviceId: localStorage.getItem("ksc_device_id") ?? "",
      });
      toast.success(`已将 ${target.name} 添加到联系人。`);
    } catch (err) {
      if (err instanceof ConvexError) {
        toast.error((err.data as { message: string }).message);
      } else {
        toast.error("发生错误，请稍后重试。");
      }
    } finally {
      setAddingCode(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div
        className="px-4 pt-3 pb-2 border-b"
        style={{ borderColor: "oklch(1 0 0 / 6%)" }}
      >
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2.5"
          style={{
            background: "oklch(1 0 0 / 6%)",
            border: "1px solid oklch(1 0 0 / 8%)",
          }}
        >
          <Search size={14} className="text-white/40 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="按姓名或授权码搜索并添加"
            className="flex-1 bg-transparent outline-none text-xs text-white placeholder:text-white/30"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="opacity-40 cursor-pointer"
            >
              <X size={12} className="text-white" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* Server search results — new users to add */}
        {debouncedSearch.trim().length >= 1 && newUsers.length > 0 && (
          <div className="px-4 pt-3 pb-2">
            <p className="text-[10px] text-white/40 mb-2 uppercase tracking-wider font-semibold">
              添加用户
            </p>
            <div className="space-y-2">
              {newUsers.map((r) => (
                <div
                  key={r.code}
                  className="flex items-center justify-between rounded-2xl px-4 py-3"
                  style={{
                    background: "oklch(1 0 0 / 5%)",
                    border: "1px solid oklch(1 0 0 / 8%)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={r.name} size="sm" />
                    <div>
                      <div className="text-sm font-medium text-white">
                        {r.name}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {r.department && (
                          <span className="flex items-center gap-1 text-[10px] text-white/40">
                            <Building2 size={9} />
                            {r.department}
                          </span>
                        )}
                        <span className="text-[10px] font-mono text-white/30">
                          {r.code}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => void handleAdd(r)}
                    disabled={addingCode === r.code}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer disabled:opacity-50 transition-opacity"
                    style={{
                      background: "oklch(0.55 0.22 25)",
                      color: "white",
                    }}
                  >
                    <UserPlus size={12} />
                    添加
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No results message */}
        {debouncedSearch.trim().length >= 1 &&
          serverResults !== undefined &&
          newUsers.length === 0 &&
          filteredContacts.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 gap-2 opacity-30">
              <Search size={22} className="text-white" />
              <p className="text-xs text-white">未找到与“{search}”匹配的用户</p>
            </div>
          )}

        {/* Existing contacts */}
        {!search.trim() && contacts?.length === 0 && (
          <div className="flex flex-col items-center justify-center h-52 gap-3 opacity-30">
            <UserCheck size={32} className="text-white" />
            <p className="text-sm text-white">暂无联系人</p>
            <p className="text-xs text-white">按姓名或授权码搜索并添加</p>
          </div>
        )}

        {filteredContacts.length > 0 && (
          <div>
            {search.trim() && (
              <p className="text-[10px] text-white/40 px-4 pt-3 pb-1 uppercase tracking-wider font-semibold">
                联系人
              </p>
            )}
            {filteredContacts.map((contact) => (
              <motion.div
                key={contact._id}
                layout
                className="flex items-center gap-3 px-4 py-3 border-b group"
                style={{ borderColor: "oklch(1 0 0 / 5%)" }}
              >
                <Avatar name={contact.targetName} />
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() =>
                    navigate(`/consultation/chat/${contact.targetCode}`, {
                      state: {
                        chatName: contact.targetName,
                        myCode: userCode,
                        myName: userName,
                      },
                    })
                  }
                >
                  <div className="text-sm font-medium text-white">
                    {contact.targetName}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {contact.targetDepartment && (
                      <span className="flex items-center gap-1 text-[10px] text-white/40">
                        <Building2 size={9} />
                        {contact.targetDepartment}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-white/25">
                      {contact.targetCode}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() =>
                      void onStartCall(
                        contact.targetCode,
                        contact.targetName,
                        "audio",
                      )
                    }
                    disabled={callingCode === contact.targetCode}
                    className="p-2 rounded-lg cursor-pointer hover:bg-white/10 transition-colors disabled:opacity-30"
                    title="语音通话"
                  >
                    <Phone size={15} className="text-green-400/70" />
                  </button>
                  <button
                    onClick={() =>
                      void onStartCall(
                        contact.targetCode,
                        contact.targetName,
                        "video",
                      )
                    }
                    disabled={callingCode === contact.targetCode}
                    className="p-2 rounded-lg cursor-pointer hover:bg-white/10 transition-colors disabled:opacity-30"
                    title="视频通话"
                  >
                    <Video size={15} className="text-blue-400/70" />
                  </button>
                  <button
                    onClick={() =>
                      navigate(`/consultation/chat/${contact.targetCode}`, {
                        state: {
                          chatName: contact.targetName,
                          myCode: userCode,
                          myName: userName,
                        },
                      })
                    }
                    className="p-2 rounded-lg cursor-pointer hover:bg-white/10 transition-colors"
                    title="发送消息"
                  >
                    <MessageSquare size={15} className="text-white/60" />
                  </button>
                  <button
                    onClick={() =>
                      void onRemoveContact(
                        contact.targetCode,
                        contact.targetName,
                      )
                    }
                    className="p-2 rounded-lg cursor-pointer hover:bg-white/10 transition-colors"
                    title="移除联系人"
                  >
                    <Trash2 size={15} className="text-red-400/70" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ConsultationPage({
  userName,
  userCode,
  onLogout,
}: Props) {
  const { can } = useFeatures();
  const location = useLocation();
  const requestedTab = (location.state as { notificationTab?: Tab } | null)
    ?.notificationTab;
  const [activeTab, setActiveTab] = useState<Tab>(requestedTab ?? "messages");
  const navigate = useNavigate();
  const deviceId = localStorage.getItem("ksc_device_id") ?? "";
  const session = useQuery(
    api.authCodes.getSessionRole,
    userCode && deviceId ? { code: userCode, deviceId } : "skip",
  );
  const isAdmin = session?.role === "admin" || session?.role === "super_admin";
  const { startCall } = useCall();
  const getOrCreateRoom = useAction(api.calls.getOrCreateRoom);
  const [callingCode, setCallingCode] = useState<string | null>(null);
  const [callTarget, setCallTarget] = useState<{
    code: string;
    name: string;
    initialMode: "camera" | "audio";
  } | null>(null);

  useEffect(() => {
    if (session && !isAdmin && activeTab === "cases") {
      setActiveTab("messages");
      navigate("/consultation", { replace: true });
      toast.error("您无权访问此页面。");
    }
  }, [activeTab, isAdmin, navigate, session]);

  const handleStartCall = async (
    targetCode: string,
    targetName: string,
    selection: OutgoingCallSelection,
  ) => {
    const { callType } = selection;
    if (!can(callType === "video" ? "canVideoCall" : "canVoiceCall")) {
      toast.error("此授权码不包含该通话功能。");
      return;
    }
    if (callingCode) return;
    setCallingCode(targetCode);
    try {
      const details = await getOrCreateRoom({
        myCode: userCode,
        theirCode: targetCode,
        myName: userName,
        deviceId: localStorage.getItem("ksc_device_id") ?? "",
        callType,
      });
      await startCall({
        ...details,
        myName: userName,
        chatName: targetName,
        callType,
        initialVideoFile:
          selection.callType === "video" ? selection.videoFile : undefined,
        waitForAnswer: true,
      });
    } catch {
      toast.error("无法发起通话，请稍后重试。");
    } finally {
      setCallingCode(null);
      setCallTarget(null);
    }
  };

  const contacts = useQuery(
    api.contacts.getContacts,
    userCode
      ? {
          ownerCode: userCode,
          deviceId: localStorage.getItem("ksc_device_id") ?? "",
        }
      : "skip",
  );
  const removeContact = useMutation(api.contacts.removeContact);

  const handleRemoveContact = async (
    targetCode: string,
    targetName: string,
  ) => {
    try {
      await removeContact({
        ownerCode: userCode,
        targetCode,
        deviceId: localStorage.getItem("ksc_device_id") ?? "",
      });
      toast.success(`已将 ${targetName} 从联系人中移除。`);
    } catch {
      toast.error("无法移除此联系人。");
    }
  };

  return (
    <div
      className="h-[100dvh] min-h-0 overflow-hidden flex flex-col"
      style={{
        background: "oklch(0.11 0.03 240)",
        color: "oklch(0.92 0.01 240)",
      }}
    >
      {callTarget && (
        <PreCallSelector
          contactName={callTarget.name}
          initialMode={callTarget.initialMode}
          busy={callingCode === callTarget.code}
          onClose={() => setCallTarget(null)}
          onConfirm={(selection) =>
            handleStartCall(callTarget.code, callTarget.name, selection)
          }
        />
      )}
      {/* Header */}
      <div
        data-app-header
        className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{ borderColor: "oklch(1 0 0 / 8%)" }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative">
            <div
              aria-label="美国国旗"
              className="grid h-9 w-12 place-items-center overflow-hidden rounded-md border border-white/15 bg-white text-2xl shadow-sm"
            >
              🇺🇸
            </div>
            <span
              className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2"
              style={{
                background: "#22c55e",
                borderColor: "oklch(0.11 0.03 240)",
              }}
            />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-[0.2em] text-white">
              U.S.A
            </div>
            <div className="max-w-[140px] truncate text-[11px] font-medium text-white/80">
              {userName}
            </div>
            <div className="text-[10px]" style={{ color: "#22c55e" }}>
              ● 在线
            </div>
          </div>
          <NotificationBellButton />
        </div>
        <div className="flex items-center gap-4">
          {isAdmin && (
            <button
              className="cursor-pointer flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all hover:scale-105"
              style={{
                background: "oklch(0.78 0.15 75)",
                color: "oklch(0.13 0.04 250)",
              }}
              onClick={() => navigate("/admin")}
            >
              <Shield size={14} />
              管理后台
            </button>
          )}
          <button
            className="cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
            onClick={onLogout}
          >
            <LogOut size={20} className="text-white" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex border-b shrink-0"
        style={{ borderColor: "oklch(1 0 0 / 8%)" }}
      >
        {(
          [
            {
              key: "messages" as Tab,
              label: "消息",
              icon: <MessageSquare size={13} />,
            },
            {
              key: "docsearch" as Tab,
              label: "案件查询",
              icon: <FileText size={13} />,
            },
            {
              key: "contacts" as Tab,
              label: "联系人",
              icon: <Users size={13} />,
            },
            ...(isAdmin
              ? [
                  {
                    key: "cases" as Tab,
                    label: "案件管理",
                    icon: <Search size={13} />,
                  },
                ]
              : []),
            ...(can("canGroupCall")
              ? [
                  {
                    key: "groupcall" as Tab,
                    label: "群组通话",
                    icon: <Video size={13} />,
                  },
                ]
              : []),
          ] satisfies { key: Tab; label: string; icon: React.ReactNode }[]
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-3 text-sm transition-all cursor-pointer border-b-2",
              activeTab === tab.key
                ? "border-red-500 text-red-400"
                : "border-transparent opacity-50 hover:opacity-80",
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* Messages tab */}
        {activeTab === "messages" && (
          <div>
            {contacts === undefined && (
              <div className="text-xs opacity-30 text-center py-8">
                正在加载...
              </div>
            )}
            {contacts?.length === 0 && (
              <div className="flex flex-col items-center justify-center h-52 gap-3 opacity-30">
                <MessageSquare size={32} className="text-white" />
                <p className="text-sm text-white">暂无消息</p>
                <p className="text-xs text-white">请先在“联系人”中添加用户</p>
              </div>
            )}
            {(contacts ?? []).map((contact) => (
              <button
                key={contact._id}
                className="w-full flex items-center gap-3 px-4 py-3 cursor-pointer text-left hover:bg-white/5 transition-colors border-b"
                style={{ borderColor: "oklch(1 0 0 / 5%)" }}
                onClick={() =>
                  navigate(`/consultation/chat/${contact.targetCode}`, {
                    state: {
                      chatName: contact.targetName,
                      myCode: userCode,
                      myName: userName,
                    },
                  })
                }
              >
                <div className="relative shrink-0">
                  <Avatar name={contact.targetName} />
                  <span
                    className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2"
                    style={{
                      background: "#22c55e",
                      borderColor: "oklch(0.11 0.03 240)",
                    }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white">
                    {contact.targetName}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {contact.targetDepartment && (
                      <span className="flex items-center gap-1 text-[10px] text-white/40">
                        <Building2 size={9} />
                        {contact.targetDepartment}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-white/25">
                      {contact.targetCode}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Document search tab */}
        {activeTab === "docsearch" && <CaseDocSearch userCode={userCode} />}

        {/* Cases tab — full-page takeover */}
        {isAdmin && activeTab === "cases" && (
          <CasesPage
            userCode={userCode}
            userName={userName}
            onBack={() => setActiveTab("messages")}
          />
        )}

        {/* Group call tab */}
        {can("canGroupCall") && activeTab === "groupcall" && (
          <GroupCallPage userCode={userCode} userName={userName} />
        )}

        {/* Contacts tab */}
        {activeTab === "contacts" && (
          <ContactsTab
            userCode={userCode}
            userName={userName}
            contacts={contacts}
            onStartCall={(code, name, type) =>
              setCallTarget({
                code,
                name,
                initialMode: type === "audio" ? "audio" : "camera",
              })
            }
            callingCode={callingCode}
            onRemoveContact={handleRemoveContact}
            navigate={navigate}
          />
        )}
      </div>
    </div>
  );
}
