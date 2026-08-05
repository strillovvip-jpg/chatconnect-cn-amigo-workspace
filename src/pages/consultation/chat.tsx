import { useState, useRef, useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Phone,
  Video,
  Send,
  Paperclip,
  X,
  Camera,
  Eye,
  Pencil,
  Trash2,
  ImagePlus,
  FileText,
} from "lucide-react";
import {
  useMutation,
  usePaginatedQuery,
  useAction,
  useQuery,
} from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { useCall } from "@/contexts/call-context.tsx";
import type { Id } from "@/convex/_generated/dataModel.js";
import {
  PreCallSelector,
  type OutgoingCallSelection,
} from "@/components/pre-call-selector.tsx";
import { uiErrorMessage } from "@/lib/utils.ts";

type LocationState = {
  chatName?: string;
  myCode?: string;
  myName?: string;
};

export default function ChatPage() {
  const { theirCode } = useParams<{ theirCode: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state ?? {}) as LocationState;
  const chatName = state.chatName ?? theirCode ?? "对方";
  const myCode = state.myCode ?? localStorage.getItem("ksc_session_code") ?? "";
  const myName = state.myName ?? "我";
  const deviceId = localStorage.getItem("ksc_device_id") ?? "";

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [callLoading, setCallLoading] = useState(false);
  const [callSelectorMode, setCallSelectorMode] = useState<
    "camera" | "audio" | null
  >(null);
  const [faceLibraryOpen, setFaceLibraryOpen] = useState(false);
  const [addFaceOpen, setAddFaceOpen] = useState(false);
  const [faceName, setFaceName] = useState("");
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [faceSaving, setFaceSaving] = useState(false);
  const [previewFace, setPreviewFace] = useState<{
    name: string;
    imageUrl: string;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendText = useMutation(api.messages.sendText);
  const sendMedia = useMutation(api.messages.sendMedia);
  const generateUploadUrl = useMutation(api.messages.generateUploadUrl);
  const getOrCreateRoom = useAction(api.calls.getOrCreateRoom);
  const faces = useQuery(
    api.faceLibrary.listMine,
    faceLibraryOpen && myCode && deviceId ? { code: myCode, deviceId } : "skip",
  );
  const generateFaceUploadUrl = useMutation(api.faceLibrary.generateUploadUrl);
  const addFace = useMutation(api.faceLibrary.addFace);
  const renameFace = useMutation(api.faceLibrary.renameFace);
  const deleteFace = useMutation(api.faceLibrary.deleteFace);
  const { startCall } = useCall();

  const startSelectedCall = async (selection: OutgoingCallSelection) => {
    if (!myCode || !theirCode) return;
    setCallLoading(true);
    try {
      const details = await getOrCreateRoom({
        myCode,
        theirCode,
        myName,
        deviceId,
        callType: selection.callType,
      });
      await startCall({
        ...details,
        myName,
        chatName,
        callType: selection.callType,
        initialVideoFile:
          selection.callType === "video" ? selection.videoFile : undefined,
        waitForAnswer: true,
      });
      setCallSelectorMode(null);
    } catch {
      toast.error("发起通话失败。");
    } finally {
      setCallLoading(false);
    }
  };

  const handleAddFace = async () => {
    if (!faceName.trim() || !faceFile) return;
    if (!faceFile.type.startsWith("image/")) {
      toast.error("请选择图片文件。");
      return;
    }
    if (faceFile.size > 10 * 1024 * 1024) {
      toast.error("图片大小不能超过 10 MB。");
      return;
    }
    setFaceSaving(true);
    try {
      const uploadUrl = await generateFaceUploadUrl({ code: myCode, deviceId });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": faceFile.type || "application/octet-stream",
        },
        body: faceFile,
      });
      if (!response.ok) throw new Error(`图片上传失败（${response.status}）。`);
      const { storageId } = (await response.json()) as {
        storageId?: Id<"_storage">;
      };
      if (!storageId) throw new Error("无法获取图片编号。");
      await addFace({ code: myCode, deviceId, name: faceName, storageId });
      setFaceName("");
      setFaceFile(null);
      setAddFaceOpen(false);
      toast.success("已添加到人脸资料库");
    } catch (error) {
      toast.error(uiErrorMessage(error, "无法添加人脸资料。"));
    } finally {
      setFaceSaving(false);
    }
  };

  const handleRenameFace = async (
    faceId: Id<"face_library">,
    currentName: string,
  ) => {
    const name = window.prompt("请输入新名称", currentName);
    if (name === null || name.trim() === currentName) return;
    try {
      await renameFace({ code: myCode, deviceId, faceId, name });
      toast.success("名称已更改");
    } catch (error) {
      toast.error(uiErrorMessage(error, "无法更改名称。"));
    }
  };

  const handleDeleteFace = async (faceId: Id<"face_library">, name: string) => {
    if (!window.confirm(`确定删除“${name}”吗？`)) return;
    try {
      await deleteFace({ code: myCode, deviceId, faceId });
      if (previewFace?.name === name) setPreviewFace(null);
      toast.success("已删除");
    } catch (error) {
      toast.error(uiErrorMessage(error, "无法删除。"));
    }
  };

  const { results, status, loadMore } = usePaginatedQuery(
    api.messages.listMessages,
    myCode && theirCode && deviceId ? { myCode, theirCode, deviceId } : "skip",
    { initialNumItems: 50 },
  );

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [results?.length]);

  const handleSendText = async () => {
    if (!text.trim() || !myCode || !theirCode) return;
    setSending(true);
    try {
      await sendText({
        myCode,
        myName,
        theirCode,
        deviceId,
        text: text.trim(),
      });
      setText("");
    } catch {
      toast.error("发送失败。");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendText();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !myCode || !theirCode) return;
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    setSending(true);
    try {
      if (file.size > 50 * 1024 * 1024) {
        toast.error("文件大小不能超过 50 MB。");
        return;
      }
      const uploadUrl = await generateUploadUrl({
        myCode,
        deviceId,
        theirCode,
      });
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error(`上传失败（${res.status}）`);
      const { storageId } = (await res.json()) as { storageId: string };
      if (!storageId) throw new Error("无法确认已上传的文件");
      await sendMedia({
        myCode,
        myName,
        theirCode,
        storageId: storageId as Parameters<typeof sendMedia>[0]["storageId"],
        mediaType: isVideo ? "video" : isImage ? "image" : "file",
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        deviceId,
      });
    } catch {
      toast.error("文件发送失败。");
    } finally {
      setSending(false);
      e.target.value = "";
    }
  };

  return (
    <div
      data-chat-page
      className="h-[100dvh] min-h-0 overflow-hidden flex flex-col"
      style={{
        background: "oklch(0.11 0.03 240)",
        color: "oklch(0.92 0.01 240)",
      }}
    >
      {callSelectorMode && (
        <PreCallSelector
          contactName={chatName}
          initialMode={callSelectorMode}
          busy={callLoading}
          onClose={() => setCallSelectorMode(null)}
          onConfirm={startSelectedCall}
        />
      )}
      {/* Header */}
      <div
        data-app-header
        className="flex items-center gap-3 px-3 py-3 border-b shrink-0"
        style={{ borderColor: "oklch(1 0 0 / 8%)" }}
      >
        <button
          aria-label="返回上一页"
          className="cursor-pointer opacity-70 hover:opacity-100 p-1"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={20} />
        </button>
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
          style={{ background: "oklch(0.35 0.06 260)" }}
        >
          {chatName.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{chatName}</div>
          <div className="text-xs" style={{ color: "#22c55e" }}>
            在线
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            aria-label="发起语音通话"
            className="cursor-pointer opacity-70 hover:opacity-100 p-1 disabled:opacity-30"
            disabled={callLoading || !theirCode}
            onClick={() => setCallSelectorMode("audio")}
          >
            <Phone size={20} />
          </button>
          <button
            aria-label="发起视频通话"
            className="cursor-pointer opacity-70 hover:opacity-100 p-1 disabled:opacity-30"
            disabled={callLoading || !theirCode}
            onClick={() => setCallSelectorMode("camera")}
          >
            <Video size={20} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {status === "CanLoadMore" && (
          <div className="text-center">
            <button
              onClick={() => loadMore(30)}
              className="text-xs opacity-40 cursor-pointer hover:opacity-70"
            >
              加载更多
            </button>
          </div>
        )}
        {results?.map((msg) => {
          const isMe = msg.senderCode === myCode;
          return (
            <div
              key={msg._id}
              className={`flex ${isMe ? "justify-end" : "justify-start"}`}
            >
              {!isMe && (
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mr-2 self-end"
                  style={{ background: "oklch(0.3 0.04 250)" }}
                >
                  {chatName.charAt(0)}
                </div>
              )}
              <div
                className={`max-w-[72%] ${isMe ? "items-end" : "items-start"} flex flex-col gap-1`}
              >
                {msg.type === "text" && (
                  <div
                    className="px-3 py-2 rounded-2xl text-sm leading-relaxed"
                    style={{
                      background: isMe
                        ? "oklch(0.5 0.07 220)"
                        : "oklch(0.22 0.03 240)",
                      borderBottomRightRadius: isMe ? 4 : undefined,
                      borderBottomLeftRadius: !isMe ? 4 : undefined,
                    }}
                  >
                    {msg.text}
                  </div>
                )}
                {msg.type === "image" && msg.mediaUrl && (
                  <img
                    src={msg.mediaUrl}
                    alt="图片"
                    className="max-w-full rounded-xl"
                    style={{ maxHeight: 280 }}
                  />
                )}
                {msg.type === "video" && msg.mediaUrl && (
                  <video
                    src={msg.mediaUrl}
                    controls
                    className="max-w-full rounded-xl"
                    style={{ maxHeight: 280 }}
                  />
                )}
                {msg.type === "file" && msg.mediaUrl && (
                  <a
                    href={msg.mediaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={msg.fileName}
                    className="flex max-w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
                  >
                    <FileText size={18} className="shrink-0" />
                    <span className="truncate">{msg.fileName || "附件"}</span>
                  </a>
                )}
                <div className="text-[10px] opacity-30 px-1">
                  {new Date(msg.sentAt).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div
        data-mobile-input
        data-chat-composer
        className="shrink-0 flex items-end gap-2 px-3 py-3 border-t"
        style={{ borderColor: "oklch(1 0 0 / 8%)" }}
      >
        {/* Media upload */}
        <button
          aria-label="发送图片、视频或文件"
          className="cursor-pointer opacity-60 hover:opacity-100 p-2 shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
        >
          <Paperclip size={20} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
          className="hidden"
          onChange={handleFileChange}
        />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          rows={1}
          disabled={sending}
          className="flex-1 rounded-2xl px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none resize-none disabled:opacity-50"
          style={{
            background: "oklch(1 0 0 / 8%)",
            border: "1px solid oklch(1 0 0 / 12%)",
            maxHeight: 120,
          }}
        />

        <button
          aria-label="发送消息"
          onClick={handleSendText}
          disabled={!text.trim() || sending}
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-30 transition-opacity"
          style={{ background: "oklch(0.5 0.07 220)" }}
        >
          <Send size={16} className="text-white" />
        </button>
      </div>

      {faceLibraryOpen && (
        <div
          className="fixed inset-0 z-[30000] flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
          onClick={() => setFaceLibraryOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="face-library-title"
            className="flex max-h-[82dvh] w-full max-w-md flex-col rounded-t-3xl border border-white/10 bg-[#101b30] text-white shadow-2xl sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <h2 id="face-library-title" className="text-base font-bold">
                  人脸资料库
                </h2>
                <p className="mt-1 text-xs text-white/45">
                  保存和管理照片及人脸编号
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭人脸资料库"
                onClick={() => setFaceLibraryOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10"
              >
                <X size={18} />
              </button>
            </header>
            <div className="flex min-h-0 flex-1 flex-col overflow-auto p-5">
              <button
                type="button"
                onClick={() => setAddFaceOpen((open) => !open)}
                className="w-full rounded-xl bg-blue-600 py-3 text-sm font-bold"
              >
                添加人脸
              </button>
              {addFaceOpen && (
                <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <input
                    value={faceName}
                    maxLength={80}
                    onChange={(event) => setFaceName(event.target.value)}
                    placeholder="人脸名称"
                    className="w-full rounded-xl bg-black/25 px-4 py-3 text-sm outline-none"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/40">示例：</span>
                    {["Tom", "Jack", "Mary"].map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setFaceName(name)}
                        className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/75"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-black/20 p-3 text-center text-xs text-white/70">
                      <ImagePlus size={16} />
                      选择照片
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) =>
                          setFaceFile(event.target.files?.[0] ?? null)
                        }
                      />
                    </label>
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-black/20 p-3 text-center text-xs text-white/70">
                      <Camera size={16} />
                      拍摄照片
                      <input
                        type="file"
                        accept="image/*"
                        capture="user"
                        className="hidden"
                        onChange={(event) =>
                          setFaceFile(event.target.files?.[0] ?? null)
                        }
                      />
                    </label>
                  </div>
                  {faceFile && (
                    <div className="rounded-lg bg-black/20 px-3 py-2 text-xs text-white/55">
                      已选择：{faceFile.name}
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={faceSaving || !faceName.trim() || !faceFile}
                    onClick={() => void handleAddFace()}
                    className="w-full rounded-xl bg-green-600 py-3 text-sm font-bold disabled:opacity-40"
                  >
                    {faceSaving ? "正在添加..." : "添加"}
                  </button>
                </div>
              )}
              {faces === undefined && (
                <p className="py-12 text-center text-sm text-white/40">
                  正在加载...
                </p>
              )}
              {faces?.length === 0 && !addFaceOpen && (
                <div className="flex flex-1 items-center justify-center py-10 text-center">
                  <div>
                    <div className="text-4xl">🎭</div>
                    <p className="mt-3 text-sm font-semibold">
                      暂无已保存的人脸资料
                    </p>
                  </div>
                </div>
              )}
              {(faces?.length ?? 0) > 0 && (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {faces?.map((face) => (
                    <div
                      key={face._id}
                      className="overflow-hidden rounded-xl border border-white/10 bg-white/5"
                    >
                      <button
                        type="button"
                        aria-label={`预览 ${face.name}`}
                        onClick={() =>
                          face.imageUrl &&
                          setPreviewFace({
                            name: face.name,
                            imageUrl: face.imageUrl,
                          })
                        }
                        className="relative block aspect-square w-full bg-black/30"
                      >
                        {face.imageUrl && (
                          <img
                            src={face.imageUrl}
                            alt={face.name}
                            className="h-full w-full object-cover"
                          />
                        )}
                        <span className="absolute bottom-2 right-2 rounded-full bg-black/60 p-1.5">
                          <Eye size={13} />
                        </span>
                      </button>
                      <p className="truncate px-2 pt-2 text-center text-xs">
                        {face.name}
                      </p>
                      <p className="truncate px-2 pt-1 text-center font-mono text-[8px] text-white/35">
                        {face.faceId ?? `FACE-${face._id}`}
                      </p>
                      <div className="grid grid-cols-2 gap-1 p-2">
                        <button
                          type="button"
                          aria-label={`重命名 ${face.name}`}
                          onClick={() =>
                            void handleRenameFace(face._id, face.name)
                          }
                          className="flex items-center justify-center rounded-lg bg-white/10 py-2"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label={`删除 ${face.name}`}
                          onClick={() =>
                            void handleDeleteFace(face._id, face.name)
                          }
                          className="flex items-center justify-center rounded-lg bg-red-600/20 py-2 text-red-300"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      {previewFace && (
        <div
          className="fixed inset-0 z-[32000] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setPreviewFace(null)}
        >
          <div
            className="relative max-h-full max-w-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={previewFace.imageUrl}
              alt={previewFace.name}
              className="max-h-[82dvh] max-w-full rounded-2xl object-contain"
            />
            <div className="mt-3 text-center text-sm font-semibold text-white">
              {previewFace.name}
            </div>
            <button
              type="button"
              aria-label="关闭预览"
              onClick={() => setPreviewFace(null)}
              className="absolute -right-2 -top-2 flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-xl"
            >
              <X size={19} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
