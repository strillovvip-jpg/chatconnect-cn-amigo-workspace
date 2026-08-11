import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import {
  Crown,
  Loader2,
  LogOut,
  MessageCircle,
  Paperclip,
  Phone,
  Plus,
  Send,
  Shield,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useCall } from "@/contexts/call-context.tsx";
import type { Doc, Id } from "@/convex/_generated/dataModel.js";
import { uiErrorMessage } from "@/lib/utils.ts";

type Props = { userCode: string; userName: string };
const deviceId = () => localStorage.getItem("ksc_device_id") ?? "";
const ROLE_LABEL: Record<string, string> = {
  owner: "オーナー",
  admin: "管理者",
  member: "メンバー",
};

export default function GroupCallPage({ userCode, userName }: Props) {
  const creds = { code: userCode, deviceId: deviceId() };
  const groups = useQuery(api.groups.listMine, creds);
  const createGroup = useMutation(api.groups.create);
  const addMember = useMutation(api.groups.addMember);
  const updateMember = useMutation(api.groups.updateMember);
  const leaveGroup = useMutation(api.groups.leaveOrDissolve);
  const sendMessage = useMutation(api.groups.sendMessage);
  const generateUploadUrl = useMutation(api.groups.generateUploadUrl);
  const createCall = useAction(api.secureGroupCalls.create);
  const joinCall = useAction(api.secureGroupCalls.join);
  const hostAction = useAction(api.secureGroupCalls.hostAction);
  const { startCall } = useCall();
  const [modal, setModal] = useState<"group" | "member" | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Id<"chat_groups"> | null>(
    null,
  );
  const details = useQuery(
    api.groups.get,
    selectedGroup ? { ...creds, groupId: selectedGroup } : "skip",
  );
  const messages = useQuery(
    api.groups.messages,
    selectedGroup ? { ...creds, groupId: selectedGroup } : "skip",
  );
  const [name, setName] = useState("");
  const [codes, setCodes] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const uploadAttachment = async (file: File) => {
    if (!selectedGroup) return;
    if (file.size > 50 * 1024 * 1024)
      throw new Error("添付ファイルは 50 MB 以下にしてください。");
    const uploadUrl = await generateUploadUrl({
      ...creds,
      groupId: selectedGroup,
    });
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!response.ok) throw new Error("添付ファイルのアップロードに失敗しました。");
    const { storageId } = (await response.json()) as {
      storageId: Id<"_storage">;
    };
    const type = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : "file";
    await sendMessage({
      ...creds,
      groupId: selectedGroup,
      type,
      text: file.name,
      storageId,
    });
  };

  const run = async (
    task: () => Promise<unknown>,
    success = "操作が完了しました",
  ) => {
    setBusy(true);
    try {
      await task();
      toast.success(success);
    } catch (error) {
      toast.error(uiErrorMessage(error, "操作に失敗しました。"));
    } finally {
      setBusy(false);
    }
  };
  const begin = (groupId: Id<"chat_groups">, type: "video" | "audio") =>
    run(async () => {
      const info = await createCall({ ...creds, groupId, type });
      await startCall({ ...info, myName: userName, mode: "group" });
    }, "グループ通話を開始しました");
  const join = (activeCall: Doc<"chat_group_calls">) =>
    run(async () => {
      const info = await joinCall({ ...creds, groupCallId: activeCall._id });
      await startCall({ ...info, myName: userName, mode: "group" });
    }, "グループ通話に参加しました");

  return (
    <div className="flex h-full flex-col text-white">
      <div className="border-b border-white/5 p-4">
        <button
          onClick={() => setModal("group")}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 text-sm font-semibold"
        >
          <Plus size={16} />
          グループを作成
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-auto p-4">
        {groups === undefined && (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin" />
          </div>
        )}
        {groups?.length === 0 && (
          <div className="py-14 text-center text-sm text-white/40">
            まだ参加しているグループがありません
          </div>
        )}
        {groups?.map((group) => (
          <section
            key={group._id}
            className="rounded-2xl border border-white/10 bg-white/5 p-4"
          >
            <button
              className="flex w-full items-center gap-3 text-left"
              onClick={() => setSelectedGroup(group._id)}
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-900">
                <Users size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{group.name}</div>
                <div className="text-xs text-white/45">
                  {group.memberCount}/{group.maxMembers} 名 ·{" "}
                  {ROLE_LABEL[group.myRole] ?? group.myRole}
                </div>
              </div>
              <MessageCircle size={17} className="text-white/45" />
            </button>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {group.activeCall ? (
                <button
                  disabled={busy}
                  onClick={() => void join(group.activeCall!)}
                  className="col-span-2 rounded-xl bg-green-600 py-2.5 text-sm font-semibold"
                >
                  進行中の{group.activeCall.type === "video" ? "ビデオ" : "音声"}通話に参加
                </button>
              ) : (
                <>
                  <button
                    disabled={busy}
                    onClick={() => void begin(group._id, "video")}
                    className="flex items-center justify-center gap-2 rounded-xl bg-white/10 py-2.5 text-sm"
                  >
                    <Video size={15} />
                    グループビデオ通話
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void begin(group._id, "audio")}
                    className="flex items-center justify-center gap-2 rounded-xl bg-white/10 py-2.5 text-sm"
                  >
                    <Phone size={15} />
                    グループ音声通話
                  </button>
                </>
              )}
            </div>
          </section>
        ))}
      </div>

      {selectedGroup && details && (
        <div className="fixed inset-0 z-[24000] bg-[#101b30] text-white">
          <div className="mx-auto flex h-full max-w-2xl flex-col">
            <header className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
              <button
                onClick={() => setSelectedGroup(null)}
                className="rounded-lg bg-white/10 p-2"
              >
                <X size={18} />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-bold">{details.group.name}</h2>
                <p className="text-xs text-white/45">
                  {details.members.length} 名のメンバー
                </p>
              </div>
              {details.members.find((item) => item.userId === userCode)
                ?.role !== "member" && (
                <button
                  onClick={() => setModal("member")}
                  className="rounded-lg bg-blue-600 p-2"
                  title="メンバーを追加"
                >
                  <UserPlus size={18} />
                </button>
              )}
            </header>
            <div className="border-b border-white/10 p-3">
              <div className="flex gap-2 overflow-x-auto">
                {details.members.map((member) => (
                  <div
                    key={member._id}
                    className="min-w-[150px] rounded-xl bg-white/5 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-900 text-xs">
                        {member.name.slice(0, 1)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold">
                          {member.name}
                        </p>
                        <p className="text-[10px] text-white/40">
                          {member.userId}
                        </p>
                      </div>
                      {member.role === "owner" ? (
                        <Crown size={13} className="text-yellow-400" />
                      ) : member.role === "admin" ? (
                        <Shield size={13} className="text-blue-400" />
                      ) : null}
                    </div>
                    {details.members.find((item) => item.userId === userCode)
                      ?.role === "owner" &&
                      member.role !== "owner" && (
                        <div className="mt-2 flex gap-1">
                          <button
                            title={
                              member.role === "admin"
                                ? "管理者を解除"
                                : "管理者に設定"
                            }
                            onClick={() =>
                              void run(() =>
                                updateMember({
                                  ...creds,
                                  groupId: selectedGroup,
                                  targetCode: member.userId,
                                  action:
                                    member.role === "admin"
                                      ? "demote"
                                      : "promote",
                                }),
                              )
                            }
                            className="flex-1 rounded bg-white/10 p-1"
                          >
                            <Shield size={12} className="mx-auto" />
                          </button>
                          <button
                            title="メンバーを削除"
                            onClick={() =>
                              void run(() =>
                                updateMember({
                                  ...creds,
                                  groupId: selectedGroup,
                                  targetCode: member.userId,
                                  action: "remove",
                                }),
                              )
                            }
                            className="flex-1 rounded bg-red-500/15 p-1 text-red-300"
                          >
                            <UserMinus size={12} className="mx-auto" />
                          </button>
                        </div>
                      )}
                    {details.activeCall &&
                      details.callParticipants.find(
                        (item) => item.userId === userCode,
                      )?.isHost &&
                      details.callParticipants.find(
                        (item) => item.userId === member.userId,
                      )?.status === "joined" &&
                      member.userId !== userCode && (
                        <div className="mt-2 flex gap-1">
                          <button
                            onClick={() =>
                              void run(
                                () =>
                                  hostAction({
                                    ...creds,
                                    groupCallId: details.activeCall!._id,
                                    targetCode: member.userId,
                                    action: "cohost",
                                  }),
                                "共同ホストに設定しました",
                              )
                            }
                            className="flex-1 rounded bg-blue-500/15 p-1 text-[10px]"
                          >
                            共同ホスト
                          </button>
                          <button
                            onClick={() =>
                              void run(
                                () =>
                                  hostAction({
                                    ...creds,
                                    groupCallId: details.activeCall!._id,
                                    targetCode: member.userId,
                                    action: "remove",
                                  }),
                                "このメンバーを通話から退出させました",
                              )
                            }
                            className="flex-1 rounded bg-red-500/15 p-1 text-[10px] text-red-300"
                          >
                            通話から退出
                          </button>
                        </div>
                      )}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-auto p-4">
              {messages?.map((item) => (
                <div
                  key={item._id}
                  className={`flex ${item.senderUserId === userCode ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 ${item.senderUserId === userCode ? "bg-blue-600" : "bg-white/10"}`}
                  >
                    <p className="text-[10px] text-white/55">
                      {item.senderName}
                    </p>
                    {item.text && (
                      <p className="whitespace-pre-wrap text-sm">{item.text}</p>
                    )}
                    {item.url && item.type === "image" && (
                      <img
                        src={item.url}
                        alt={item.text ?? "グループ画像"}
                        className="mt-2 max-h-64 rounded-lg object-contain"
                      />
                    )}
                    {item.url && item.type === "video" && (
                      <video
                        src={item.url}
                        controls
                        playsInline
                        className="mt-2 max-h-64 rounded-lg"
                      />
                    )}
                    {item.url && item.type === "file" && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 block text-xs underline"
                      >
                        添付資料を開く
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <form
              className="flex gap-2 border-t border-white/10 p-3 pb-[max(.75rem,var(--app-safe-area-bottom))]"
              onSubmit={(event) => {
                event.preventDefault();
                const text = message.trim();
                if (!text) return;
                setMessage("");
                void run(
                  () =>
                    sendMessage({
                      ...creds,
                      groupId: selectedGroup,
                      type: "text",
                      text,
                    }),
                  "メッセージを送信しました",
                );
              }}
            >
              <label
                className="flex cursor-pointer items-center justify-center rounded-xl bg-white/10 px-3"
                title="画像・動画・ファイルを送信"
              >
                <Paperclip size={17} />
                <input
                  type="file"
                  accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.zip"
                  className="hidden"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file)
                      void run(() => uploadAttachment(file), "添付ファイルを送信しました");
                  }}
                />
              </label>
              <input
                value={message}
                maxLength={5000}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="グループメッセージを入力"
                className="min-w-0 flex-1 rounded-xl bg-white/10 px-4 py-3 text-sm outline-none"
              />
              <button
                disabled={!message.trim() || busy}
                className="rounded-xl bg-blue-600 px-4"
              >
                <Send size={17} />
              </button>
            </form>
            <div className="flex gap-2 px-3 pb-3">
              {details.activeCall &&
                details.callParticipants.find(
                  (item) => item.userId === userCode,
                )?.isHost && (
                  <button
                    onClick={() =>
                      void run(
                        () =>
                          hostAction({
                            ...creds,
                            groupCallId: details.activeCall!._id,
                            action: "end",
                          }),
                        "グループ通話を終了しました",
                      )
                    }
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 py-2 text-xs"
                  >
                    全員の通話を終了
                  </button>
                )}
              {details.members.find((item) => item.userId === userCode)
                ?.role === "owner" ? (
                <button
                  onClick={() =>
                    void run(async () => {
                      await leaveGroup({
                        ...creds,
                        groupId: selectedGroup,
                        dissolve: true,
                      });
                      setSelectedGroup(null);
                    }, "グループを解散しました")
                  }
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600/20 py-2 text-xs text-red-300"
                >
                  <Trash2 size={14} />
                  グループを解散
                </button>
              ) : (
                <button
                  onClick={() =>
                    void run(async () => {
                      await leaveGroup({
                        ...creds,
                        groupId: selectedGroup,
                        dissolve: false,
                      });
                      setSelectedGroup(null);
                    }, "グループから退出しました")
                  }
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/10 py-2 text-xs"
                >
                  <LogOut size={14} />
                  グループを退出
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div
          className="fixed inset-0 z-[25000] flex items-end justify-center bg-black/70"
          onClick={() => setModal(null)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-[#16233b] p-5 pb-10"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">
                {modal === "group" ? "グループを作成" : "グループメンバーを追加"}
              </h2>
              <button onClick={() => setModal(null)}>
                <X size={18} />
              </button>
            </div>
            {modal === "group" && (
              <input
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="グループ名"
                className="mb-3 w-full rounded-xl bg-white/10 px-4 py-3 outline-none"
              />
            )}
            <input
              value={codes}
              onChange={(event) => setCodes(event.target.value.toUpperCase())}
              placeholder={
                modal === "group"
                  ? "メンバー認証コード（カンマ区切り・任意）"
                  : "メンバー認証コード"
              }
              className="w-full rounded-xl bg-white/10 px-4 py-3 outline-none"
            />
            <button
              disabled={
                busy || (modal === "group" && !name.trim()) || !creds.deviceId
              }
              onClick={() =>
                void run(async () => {
                  if (modal === "group")
                    await createGroup({
                      ...creds,
                      name,
                      memberCodes: codes.split(/[,，\s]+/).filter(Boolean),
                    });
                  else if (selectedGroup)
                    await addMember({
                      ...creds,
                      groupId: selectedGroup,
                      targetCode: codes,
                    });
                  setModal(null);
                  setName("");
                  setCodes("");
                })
              }
              className="mt-4 w-full rounded-xl bg-blue-600 py-3 font-semibold disabled:opacity-40"
            >
              {busy ? "処理中..." : "確認"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
