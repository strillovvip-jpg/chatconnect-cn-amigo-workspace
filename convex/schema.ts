import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
  }).index("by_token", ["tokenIdentifier"]),

  auth_codes: defineTable({
    code: v.string(),
    deviceId: v.string(),
    mobileDeviceId: v.optional(v.string()),
    mobileAppDeviceId: v.optional(v.string()),
    desktopDeviceId: v.optional(v.string()),
    name: v.string(),
    department: v.optional(v.string()),
    usedAt: v.string(),
    firstLoginAt: v.optional(v.number()),
    lastLoginAt: v.optional(v.number()),
  })
    .index("by_code", ["code"])
    .index("by_device", ["deviceId"])
    .index("by_name", ["name"]),

  user_presence: defineTable({
    userId: v.string(),
    lastSeenAt: v.number(),
    online: v.optional(v.boolean()),
    lastOnlineAt: v.optional(v.number()),
    lastOfflineAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  push_subscriptions: defineTable({
    userId: v.string(),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_endpoint", ["endpoint"]),

  allowed_codes: defineTable({
    code: v.string(),
    role: v.union(
      v.literal("super_admin"),
      v.literal("admin"),
      v.literal("user"),
    ),
    enabled: v.optional(v.boolean()),
    unlimitedDevices: v.optional(v.boolean()),
    licenseProfileId: v.optional(v.id("license_profiles")),
    expiresAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  }).index("by_code", ["code"]),

  license_profiles: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    features: v.object({
      canVideoCall: v.boolean(),
      canVoiceCall: v.boolean(),
      canAIFace: v.boolean(),
      canVideoSource: v.boolean(),
      canPlayVideo: v.boolean(),
      canScreenShare: v.boolean(),
      canTransferCall: v.boolean(),
      canGroupCall: v.boolean(),
      canPictureInPicture: v.boolean(),
      canFloatingWindow: v.boolean(),
      canFileSearch: v.boolean(),
      canRecord: v.boolean(),
    }),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),

  audit_logs: defineTable({
    actorCode: v.string(),
    action: v.string(),
    targetType: v.string(),
    targetId: v.optional(v.string()),
    success: v.boolean(),
    details: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"])
    .index("by_actor", ["actorCode"]),

  contacts: defineTable({
    ownerCode: v.string(),
    targetCode: v.string(),
    targetName: v.string(),
    targetDepartment: v.optional(v.string()),
    addedAt: v.string(),
  })
    .index("by_owner", ["ownerCode"])
    .index("by_owner_target", ["ownerCode", "targetCode"]),

  friend_requests: defineTable({
    requesterUserId: v.string(),
    targetUserId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("cancelled"),
    ),
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
    notificationId: v.optional(v.string()),
  })
    .index("by_target_status", ["targetUserId", "status"])
    .index("by_requester_status", ["requesterUserId", "status"])
    .index("by_pair", ["requesterUserId", "targetUserId"]),

  notifications: defineTable({
    notificationId: v.string(),
    userId: v.string(),
    type: v.union(
      v.literal("friend_invite"),
      v.literal("friend_accepted"),
      v.literal("friend_rejected"),
      v.literal("friend_cancelled"),
      v.literal("video_call"),
      v.literal("audio_call"),
      v.literal("missed_call"),
      v.literal("call_transfer"),
      v.literal("group_invite"),
      v.literal("group_video_invite"),
      v.literal("case_shared"),
      v.literal("document_shared"),
      v.literal("text_message"),
      v.literal("media_message"),
      v.literal("admin_announcement"),
      v.literal("system_announcement"),
      v.literal("auth_code_expiring"),
      v.literal("account_disabled"),
    ),
    title: v.string(),
    message: v.string(),
    data: v.any(),
    status: v.union(
      v.literal("unread"),
      v.literal("read"),
      v.literal("dismissed"),
      v.literal("expired"),
    ),
    priority: v.union(
      v.literal("low"),
      v.literal("normal"),
      v.literal("high"),
      v.literal("urgent"),
    ),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  })
    .index("by_notification_id", ["notificationId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_user_created", ["userId", "createdAt"]),

  cases: defineTable({
    caseNumber: v.string(),
    title: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("in_progress"),
      v.literal("closed"),
      v.literal("suspended"),
    ),
    priority: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("urgent"),
    ),
    category: v.string(),
    description: v.string(),
    assignedCode: v.string(),
    assignedName: v.string(),
    suspectName: v.optional(v.string()),
    suspectIdNumber: v.optional(v.string()),
    idNumberHash: v.optional(v.string()),
    adminContent: v.optional(v.string()),
    location: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_case_number", ["caseNumber"])
    .index("by_assigned", ["assignedCode"])
    .index("by_status", ["status"])
    .index("by_created", ["createdAt"]),

  group_calls: defineTable({
    roomName: v.string(),
    serverUrl: v.string(),
    title: v.string(),
    createdByCode: v.string(),
    createdByName: v.string(),
    callType: v.union(v.literal("audio"), v.literal("video")),
    isActive: v.boolean(),
    createdAt: v.string(),
  })
    .index("by_active", ["isActive"])
    .index("by_created", ["createdAt"]),

  live_calls: defineTable({
    callId: v.string(),
    roomName: v.string(),
    type: v.union(v.literal("audio"), v.literal("video")),
    status: v.union(
      v.literal("ringing"),
      v.literal("accepted"),
      v.literal("connecting"),
      v.literal("connected"),
      v.literal("active"),
      v.literal("rejected"),
      v.literal("cancelled"),
      v.literal("expired"),
      v.literal("missed"),
      v.literal("failed"),
      v.literal("ended"),
    ),
    participantCodes: v.array(v.string()),
    createdByCode: v.string(),
    callerUserId: v.optional(v.string()),
    calleeUserId: v.optional(v.string()),
    callerCode: v.optional(v.string()),
    calleeCode: v.optional(v.string()),
    callerName: v.optional(v.string()),
    calleeName: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    connectedAt: v.optional(v.number()),
    callerConnectedAt: v.optional(v.number()),
    calleeConnectedAt: v.optional(v.number()),
    lastActivityAt: v.optional(v.number()),
    endedBy: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    notificationId: v.optional(v.string()),
    createdAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index("by_call_id", ["callId"])
    .index("by_room", ["roomName"])
    .index("by_status", ["status"])
    .index("by_callee_status", ["calleeUserId", "status"])
    .index("by_caller", ["callerUserId"]),

  call_compliance: defineTable({
    callId: v.string(),
    participantCodes: v.array(v.string()),
    consentedCodes: v.array(v.string()),
    declinedCodes: v.array(v.string()),
    status: v.union(
      v.literal("requested"),
      v.literal("active"),
      v.literal("declined"),
      v.literal("stopped"),
    ),
    requestedBy: v.string(),
    requestedAt: v.number(),
    activatedAt: v.optional(v.number()),
    stoppedAt: v.optional(v.number()),
    translationEnabled: v.optional(v.boolean()),
  })
    .index("by_call", ["callId"])
    .index("by_status", ["status"]),

  call_transcripts: defineTable({
    callId: v.string(),
    speakerCode: v.string(),
    speakerName: v.string(),
    text: v.string(),
    originalText: v.optional(v.string()),
    sourceLanguage: v.optional(v.string()),
    translated: v.optional(v.boolean()),
    createdAt: v.number(),
  }).index("by_call_time", ["callId", "createdAt"]),

  call_recordings: defineTable({
    callId: v.string(),
    participantCode: v.string(),
    participantName: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    createdAt: v.number(),
  }).index("by_call", ["callId"]),

  call_transfers: defineTable({
    callId: v.string(),
    roomName: v.string(),
    fromUserId: v.string(),
    remoteUserId: v.string(),
    targetUserId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("joining"),
      v.literal("completed"),
      v.literal("rejected"),
      v.literal("cancelled"),
      v.literal("expired"),
      v.literal("failed"),
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    failureReason: v.optional(v.string()),
    notificationId: v.optional(v.string()),
  })
    .index("by_call", ["callId"])
    .index("by_target_status", ["targetUserId", "status"])
    .index("by_from", ["fromUserId"]),

  chat_groups: defineTable({
    name: v.string(),
    avatar: v.optional(v.string()),
    ownerUserId: v.string(),
    maxMembers: v.number(),
    status: v.union(v.literal("active"), v.literal("dissolved")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_status", ["status"]),

  chat_group_members: defineTable({
    groupId: v.id("chat_groups"),
    userId: v.string(),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
    joinedAt: v.number(),
    status: v.union(
      v.literal("active"),
      v.literal("left"),
      v.literal("removed"),
    ),
  })
    .index("by_group", ["groupId"])
    .index("by_group_user", ["groupId", "userId"])
    .index("by_user_status", ["userId", "status"]),

  chat_group_messages: defineTable({
    groupId: v.id("chat_groups"),
    senderUserId: v.string(),
    senderName: v.string(),
    type: v.union(
      v.literal("text"),
      v.literal("image"),
      v.literal("video"),
      v.literal("file"),
    ),
    text: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    sentAt: v.number(),
  }).index("by_group", ["groupId"]),

  chat_group_calls: defineTable({
    groupId: v.id("chat_groups"),
    callId: v.string(),
    roomName: v.string(),
    type: v.union(v.literal("video"), v.literal("audio")),
    status: v.union(
      v.literal("ringing"),
      v.literal("active"),
      v.literal("ended"),
    ),
    createdBy: v.string(),
    startedAt: v.number(),
    lastActivityAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    maxParticipants: v.number(),
  })
    .index("by_group_status", ["groupId", "status"])
    .index("by_call_id", ["callId"]),

  chat_group_call_participants: defineTable({
    groupCallId: v.id("chat_group_calls"),
    userId: v.string(),
    status: v.union(
      v.literal("invited"),
      v.literal("ringing"),
      v.literal("joined"),
      v.literal("declined"),
      v.literal("left"),
      v.literal("removed"),
      v.literal("blocked"),
    ),
    joinedAt: v.optional(v.number()),
    leftAt: v.optional(v.number()),
    livekitIdentity: v.optional(v.string()),
    isHost: v.boolean(),
    notificationId: v.optional(v.string()),
  })
    .index("by_call", ["groupCallId"])
    .index("by_call_user", ["groupCallId", "userId"])
    .index("by_user_status", ["userId", "status"]),

  face_library: defineTable({
    faceId: v.optional(v.string()),
    ownerCode: v.string(),
    name: v.string(),
    storageId: v.id("_storage"),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerCode"])
    .index("by_face_id", ["faceId"]),

  messages: defineTable({
    // Canonical chat room ID: alphabetically sorted pair e.g. "ACODE:BCODE"
    roomId: v.string(),
    senderCode: v.string(),
    senderName: v.string(),
    type: v.union(
      v.literal("text"),
      v.literal("image"),
      v.literal("video"),
      v.literal("file"),
    ),
    text: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    mediaUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    sentAt: v.string(),
  }).index("by_room", ["roomId"]),

  case_documents: defineTable({
    caseNumber: v.string(),
    idNumber: v.optional(v.string()),
    idNumberHash: v.optional(v.string()),
    fileName: v.string(),
    storageId: v.id("_storage"),
    uploadedByCode: v.string(),
    uploadedByName: v.string(),
    uploadedAt: v.string(),
  })
    .index("by_case_number", ["caseNumber"])
    .index("by_id_number", ["idNumber"]),

  case_access_grants: defineTable({
    token: v.string(),
    caseId: v.id("cases"),
    userCode: v.string(),
    deviceId: v.string(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),
});
