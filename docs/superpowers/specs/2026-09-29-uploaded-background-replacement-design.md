# 换脸视讯自订背景设计

## 规格状态

**产品设计已完成，但生产实现被 Amigo SDK v1.0.2 的逐帧输出契约阻塞。**

在 Amigo 提供可验证的 strict/drop API 或逐帧 `faceSwapApplied` 状态之前，正式 build 必须同时回传 `nativeRealtimeLiveKit=false`、`strictFaceSwapFrames=false` 与 `nativeBackgroundReplacement=false`，停用生产换脸通话及背景入口，也不得以像素差异、相似度阈值或「非 nil 就算成功」取代严格状态。

## 决策摘要

在既有「人脸设定」中新增独立的背景照片设定。用户可选择、预览、更换或移除一张背景照片；照片只保存在该装置，并依当前授权账号隔离。

取得符合下述严格契约的 Amigo SDK 后，换脸视讯沿用现有实时发布架构，但所有 SDK 调用先通过 `StrictFaceSwapAdapter`：

`LiveKit camera frame → StrictFaceSwapAdapter → Vision 人像遮罩 → 背景合成 → LiveKit processed track`

只有 adapter 从 SDK 取得「本帧确实已换脸」的明确状态与对应 `CIImage`，并且启用背景时 Vision 也成功产生人像遮罩，才可发布。任何一步失败都输出黑色隐私帧，不得把原始摄像头画面作为回退。

本功能不改变人脸注册、联系人、邀请链接、密码、通话信令、双向语音或普通视讯。

## 方案选择与官方 API 结论

### 采用方案与前置条件

保留现有 `LocalVideoTrack.createCameraTrack(...processor:)` 与 `AmigoRealtimeVideoProcessor`。先把官方 SDK 升级到满足以下任一契约的版本：

- strict per-frame API：任何未换脸、降级或内部 fallback 都只回传 `nil`/drop 或抛错；或
- 逐帧结果包含不可模糊的 `faceSwapApplied: Bool`，只有 `true` 的影像可发布。

`StrictFaceSwapAdapter` 把新 SDK 转成内部 `.processed(CIImage)` 或 `.blocked(reason)` 两种结果。之后在 `.processed` 影像渲染到输出 `CVPixelBuffer` 前，使用 iOS Vision `VNGeneratePersonSegmentationRequest` 产生人物遮罩，并把换脸后的前景合成到用户背景。

这条路径具备现成的黑帧 bootstrap 与错误隐私回退，且联系人和外部来宾已经共用同一条 processed track。

### Amigo v1.0.2 无法满足严格契约

Amigo SDK v1.0.2 虽公开 `AmigoLiveSession.backgroundImage`，但实际 binary 行为并非逐帧 fail-closed：换脸关闭、找不到脸或 landmark、推理失败、遮罩失败及背景分割失败时，session 可能把输入 `CIImage` 交给输出完成流程，而这些逐帧回退不会可靠地透过 `didEncounterError` 标示。

因此无法只凭 `session(_:didOutput:)` 判断画面已经换脸及替换背景。直接把该 delegate 发布到 LiveKit 会存在原始镜头外泄风险，不符合本项目既有隐私要求，本次不采用。

v1.0.2 的静态 `processFrame` 也不能作为严格证明。公开签名只有 `throws -> CIImage?`，没有 `faceSwapApplied`；binary 的 `runFullPipeline` 在特定滤镜输出为 nil 时会保留并从共同 return path 回传输入 `CIImage`，同样可能出现「非 nil 但未换脸」。官方 iOS 指南只说明无脸时可能回传 nil，并没有提供可验证的成功状态。

公开契约依据：[Amigo API Reference](https://sdk.amigoai.io/docs/api-reference) 与 [Amigo iOS Integration Guide](https://sdk.amigoai.io/docs/ios-integration)。

因此现有 `processFrame != nil` 判断最多符合一般展示用途，不能满足本项目「永不发布原始脸」的硬性隐私条件。

### 其他未采用方案

- **同时保留官方 session 与现有 camera processor**：两者会竞争摄像头，并造成发布来源不明确。
- **网页 CSS 背景或远端叠图**：无法移除真实背景，外部来宾也看不到单一已处理轨。
- **深度镜头或绿幕限定方案**：装置限制较大，不符合上传普通背景照片的需求。
- **使用 SDK 私有背景方法**：私有 symbol 没有相容性承诺，不可作为生产依赖。
- **用像素差、SSIM 或脸部相似度猜测是否换脸**：可降低已知 fallback 风险，但无法证明输出身份属于目标 `FaceLatent`，不作为安全边界。
- **只相信 `processFrame != nil`**：v1.0.2 binary 已证明存在非 nil 原图路径，不采用。

## 目标

1. 用户可在 App 内选择任意有效的静态背景照片，并在换脸视讯中取代真实背景。
2. 联系人和外部来宾看到同一条「换脸后人物＋自订背景」处理轨。
3. 背景照片在 App 重启后仍保留，但同一装置的不同授权账号不能看到或使用彼此的背景。
4. 未设背景或主动移除背景时，换脸视讯维持现有行为，不影响 `FaceLatent` 或 `faceReady`。
5. 原始摄像头画面永远不发布到 LiveKit，也不作为错误回退。

## 不在本次范围

- 网页端上传或管理主持人的背景。
- 将背景照片上传至 Convex、对象储存或其他服务器。
- 多张背景图库、云端同步、动态背景、影片背景、模糊强度或绿幕参数。
- 通话进行中即时更换背景；第一版只在下一次建立换脸视讯时套用最新设定。
- 修改普通视讯、联系人信令、外部邀请、六位密码、房间人数限制或语音路径。
- 修改 Amigo SDK binary 或调用其私有方法。

## 用户流程

### 背景设定

「人脸设定」弹窗分成两个互不相依的区块：

1. **人脸照片**：维持现有选择照片、`enrollFace`、取得并保留 `FaceLatent` 的流程。
2. **背景照片（选填）**：新增选择、预览、更换与移除操作。

背景入口沿用既有换脸功能权限；本次不新增授权层级，也不会让原本无换脸权限的受限码取得入口。

背景照片操作规则：

- 接受系统照片选择器提供、可由 iOS 解码的静态图片；动画图片与影片必须拒绝。
- 前端先检查 MIME 类型为图片、档案不超过 10 MB，并确认可解码。
- 原生层先用 ImageIO 读取 metadata，不完整解码原图：只接受单帧、宽高各不超过 16,384 像素且总像素不超过 80 MP 的来源，再以 thumbnail/downsample API 修正方向、限制长边为 1920 像素并储存标准化 JPEG。
- 储存成功后才更新预览与「背景已启用」状态；失败时保留先前有效背景。
- 「移除背景」只删除当前账号在该装置的背景与缩图，不清除人脸、`FaceLatent` 或 `faceReady`。
- 选择背景不调用 `enrollFace`；重新启用人脸也不改变背景。

### 建立换脸视讯

建立联系人或外部来宾换脸视讯时：

1. 确认原生层仍持有有效 `FaceLatent`。
2. 读取当前授权账号对应的本机背景；未设背景时使用 `nil`。
3. 将背景交给同一个 `AmigoRealtimeVideoProcessor` 后，再启动现有原生 LiveKit 房间。
4. 仅发布 processor 产出的换脸或换脸加背景画面。
5. 房间、邀请、密码、联系人通知、接听、拒接、挂断及麦克风继续走现有链路。

## 状态与账号隔离

背景状态与人脸状态分开管理：

| 状态                | 来源                                                           | 影响                                 |
| ------------------- | -------------------------------------------------------------- | ------------------------------------ |
| `faceReady`         | 原生层是否持有有效 `FaceLatent`                                | 决定能否建立换脸视讯                 |
| `backgroundState`   | 当前账号 manifest 与完整图验证结果：`none`、`ready`、`invalid` | 决定正常换脸、执行背景替换或阻止通话 |
| `backgroundPreview` | 当前账号本机缩图                                               | 只用于设定画面预览                   |

- `backgroundState=none` 不是错误，也不影响建立换脸视讯；`invalid` 必须阻止通话直到更换或移除。
- 背景不可作为 `faceReady` 的替代条件。
- App 重启后背景可以恢复；若 SDK 的 `FaceLatent` 已因进程重启而消失，用户仍须依现有规则重新启用人脸。
- 登出或切换授权码时，UI 立即清除前一账号预览。若有 pending/published processor，原生层必须先让旧 generation 只输出黑帧、取消发布并完成安全 drain，之后才释放旧背景并查询新账号状态；不可把 active processor 的背景直接设为 `nil`。
- 本机档案目录使用不可反推的账号 scope。原生层以每次安装产生、保存在 Keychain 的 256-bit 随机 secret，对标准化授权码与 `deviceId` 组合值计算 HMAC-SHA-256。
- 日志只能记录 scope 的短前缀，不得记录授权码、`deviceId` 或背景内容。
- `RAVE`、`RAVE1`、全功能码及其他账号遵守相同隔离规则，不存在管理码共享背景的例外。

## 本机储存

原生插件负责所有背景档案：

- 完整背景储存在 App 的 `Application Support` 目录，每次写入使用新的随机 generation 档名，不原地覆盖当前有效档。
- 同时产生最长边不超过 320 像素的 JPEG 缩图，供设定 UI 读取；桥接层不回传完整大图 Base64。
- 每个 scope 另存一份不含授权资料的 manifest，作为当前 generation 的原子指针，记录 `state=ready|none`、版本、generation、完整图尺寸与 checksum，用来区分「从未设定」「已移除」和「设定过但完整图损坏或遗失」。
- 新完整图与缩图先写入 generation-named 临时档、同步并验证，再原子移动为该 generation 的正式档，最后以原子 replace 切换 manifest 指针。只有 manifest commit 成功后才删除旧 generation；任何中途 crash 都保留旧指针与旧有效档。
- 设定新背景失败时不删除旧背景。
- 明确移除时先原子提交 `state=none` tombstone manifest，再删除旧 generation；crash 后遗留的 orphan 档不会恢复背景，并在下次启动清理。重复移除视为成功。
- App 更新不删除背景；删除 App 会随 App 沙盒一并移除。
- 原生层再次执行 10 MB encoded-size 检查，不信任只由 JS 检查的值；标准化重编码时移除 EXIF、GPS 与其他 metadata。
- 背景目录设定 `NSURLIsExcludedFromBackupKey` 与 `FileProtectionType.complete`；HMAC secret 使用 `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`。照片不写入相簿、不进入 iCloud 备份或文件同步，也不上传服务器。

## 前端与原生桥接契约

在现有 `AmigoFaceSwap` Capacitor plugin 增加以下三项固定命名的能力。

### `setBackgroundImage`

输入：

- `imageData`：与现有人脸选择流程一致的本机图片资料。
- `userCode` 与 `deviceId`：只用于原生层计算本机 HMAC scope，不得写档或记录日志。

成功回传：

- `success: true`
- `hasBackground: true`
- `backgroundState: "ready"`
- 标准化后的宽、高与轻量预览资料。

只有解码、标准化、缩图与原子储存全部成功才 resolve。错误保留阶段、错误码与原始描述，每个 `CAPPluginCall` 只 resolve 或 reject 一次。

### `getBackgroundStatus`

输入当前 `userCode` 与 `deviceId`，由原生层计算相同 scope 后回传：

- `hasBackground`
- `backgroundState: "none" | "ready" | "invalid"`
- 可选的轻量预览资料
- 标准化后的宽、高

没有 manifest 时回传无背景。manifest 表示已设定但完整图遗失或 checksum 不一致时回传明确的 `BACKGROUND_IMAGE_INVALID`，保留 configured 状态直到用户明确更换或移除，不能影响人脸状态。若只有缩图遗失或损坏，则从验证通过的完整图重新产生缩图，不阻断通话。

### `clearBackgroundImage`

输入当前 `userCode` 与 `deviceId`。原生层计算相同 scope，原子提交 `state=none` tombstone manifest，并删除先前 generation 的完整图与缩图；tombstone 保留，回传 `hasBackground: false`、`backgroundState: "none"`。

前端 `bridge.ts` 提供相同的强类型方法；非 iOS 原生环境回传不支持状态，不伪装成功。

现有 `getPipelineCapabilities` 增加 `nativeBackgroundReplacement` 与 `strictFaceSwapFrames`。只有新 SDK 通过 strict 契约测试，且原生实现明确同时回传 `nativeRealtimeLiveKit=true`、`strictFaceSwapFrames=true` 与 `nativeBackgroundReplacement=true` 时才显示换脸通话及背景区块。

Amigo v1.0.2、旧 TestFlight build、浏览器与 Android 都视为不支援。UI 隐藏不是安全边界：`connectNativeRoom`、所有实时 publisher 入口及背景 set/get/clear 都必须先检查绑定到已验证 SDK artifact 的三项 capability，任一为 false 就在读档、启动摄像头或连接 LiveKit 前拒绝并回传 `STRICT_FACE_SWAP_SDK_REQUIRED`。

### 扩充 `connectNativeRoom`

JS 在每一次由 App 发起的 connect 或 reconnect 前产生一个不含账号资料的 UUID `attemptId`，并在注册 `nativePublisherFatal` listener 后，将 `attemptId`、当前 `userCode` 与 `deviceId` 一起传给 `connectNativeRoom`。原生层在该 attempt 开始时重新计算 scope、读取该账号背景，并建立不可变背景快照；不能依赖用户曾经开启「人脸设定」弹窗，也不能沿用全域最后一张背景。

LiveKit 在同一个 `Room` 内部进行的 transport reconnect 仍属于同一个 `attemptId`、内部 generation 与背景快照，不重新读取账号或产生新 attempt。只有 App 明确销毁旧 room 并再次调用 connect 才建立新 attempt。

resolve、reject、`getNativeRoomStatus`、disconnect、readiness 与 fatal event 都回传同一个 `attemptId`。连接成功状态另含 `processedVideoReady: true` 与 `backgroundEnabled`。缺少 attempt/scope、背景载入失败或尚未出现安全处理帧时不得回传 connected success。

所有会改变 native room 的命令都必须带 `expectedAttemptId`，包括 disconnect、启用/停用换脸视讯、camera suspend/re-arm 与 fatal acknowledge。原生层只在 ID 与当前 attempt 完全相符时 compare-and-act；旧 promise 或旧 UI 发出的命令回传 `ignoredStaleAttempt=true`，不得中断或改变较新的通话。

### 原生 fatal event

plugin 增加 `nativePublisherFatal` event，至少包含 `attemptId`、内部 connection generation、room name、stage、code 与安全化 message。事件不包含 token、授权码、`deviceId` 或图片资料。

- event 以 `attemptId` 作为 JS 的权威关联键；native generation 只供内部并发隔离。JS 只处理当前 attempt 与当前 room 的事件，旧事件直接忽略。
- fatal 状态在原生层保持 sticky，直到 JS 调用 `acknowledgeNativePublisherFatal({ attemptId })`。即使 fatal 发生在 connect promise resolve/reject 前，随后结果或 status 也必须带回该 fatal，不能遗失事件。
- fatal 发生时 native 先原子 invalidate generation、取消发布并断开该 native `Room`，阻止 LiveKit internal reconnect 复活媒体，再发 sticky event；JS 清理不是隐私阻挡的第一道防线。
- 外部邀请收到 fatal event 后只执行一次 `endFaceSwapInvite`、断开 host/viewer room 并关闭通话 UI。
- 联系人换脸通话收到 fatal event 后只执行一次既有 hangup/end-call 流程。
- fatal generation 标记为不可自动重连；必须由用户重新发起，避免每 10 秒恢复逻辑不断重连失败的 publisher。

## 原生实时媒体架构

### 处理顺序

现有 `AmigoRealtimeVideoProcessor.process(frame:)` 按以下顺序处理每一帧：

1. 若换脸未启用、没有 `FaceLatent` 或 `strictFaceSwapFrames=false`，回传黑色隐私帧。
2. 将 LiveKit `VideoFrame` 转成输入 `CVPixelBuffer`；失败则回传黑帧。
3. 调用 `StrictFaceSwapAdapter.process(...)`；adapter 内部只能使用具备 strict/drop 或 `faceSwapApplied` 契约的官方 SDK API。
4. adapter 回传 `.blocked`、SDK 抛错、无脸或未明确标示已换脸时回传黑帧。
5. 没有设定背景时，把 SDK 成功回传的换脸 `CIImage` 渲染到输出 buffer，维持现有行为。
6. 有设定背景时，对同一输入 `CVPixelBuffer` 执行 Vision 人像分割；成功后把 SDK 换脸输出当作前景、用户照片当作背景进行合成。
7. 只有合成成功才渲染输出；分割、遮罩对齐、合成或输出配置失败一律回传黑帧。
8. 输出 `VideoFrame` 保留输入的 dimensions、rotation 与 timestamp，再由现有 `.camera` track 发布。

```text
camera CVPixelBuffer ────────────────┐
        │                            │
        ▼                            ▼
StrictFaceSwapAdapter         Vision person mask
        │                            │
        └──── swapped foreground ────┤
                                     ▼
account-scoped background ──▶ CIBlendWithMask
                                     │
                                     ▼
                         processed CVPixelBuffer
                                     │
                                     ▼
                         LiveKit camera-source track
                           ┌─────────┴─────────┐
                           ▼                   ▼
                  contact recipient     external guest
```

联系人与外部邀请共用这条发布路径，不维护两套背景合成逻辑。

### 人像遮罩与背景合成

- 使用 `VNGeneratePersonSegmentationRequest`，`qualityLevel=.balanced`，输出 8-bit 单通道遮罩。
- Vision request 与实时处理队列为一对一拥有关系，不跨并发队列同时执行。
- 唯一合成坐标系定义为「摄像头原始、未镜像的 CVPixelBuffer 像素坐标」。`VideoFrame.rotation` 明确映射为 Vision orientation，Vision 结果再用逆矩阵还原到原始 buffer 坐标；前镜头镜像只留给本地预览呈现，不烘焙进发布 frame。
- strict SDK 输出 extent 必须是有限值，并在平移到原点后与输入 buffer 宽高一致；不一致时回传黑帧。遮罩使用相同逆方向矩阵、缩放与裁切到该精确 extent，禁止沿用上一帧遮罩。
- 背景在通话启动前解码为 `CIImage`，按输出比例 aspect-fill 并裁切；每帧不可重新读取磁碟或重新解码 JPEG。
- 使用 `CIBlendWithMask` 合成。可施加固定、极小的边缘柔化以减少锯齿，但第一版不提供用户调节参数。
- 输出继续使用现有缓存 BGRA `CVPixelBuffer`，背景尺寸或画面尺寸改变时才重建缓存。
- 每个从 pool 取得的输出或隐私 buffer 在渲染前先以 stride-aware CPU 写入不透明黑色 BGRA；`CIContext.render` 没有成功回传值，即使渲染静默失败也只能留下黑色，不能留下上一帧像素。

### Amigo 全 App 排他执行

Amigo CoreML engine 视为单例资源。新增 app-wide execution coordinator，以互斥 lease 管理 `.initializing`、`.enrolling`、`.diagnostic`、`.clearing` 与 `.liveReserved(attemptId)`：

- live preflight 前取得 attempt-scoped reservation，并同时锁定不可变 `FaceLatent`。即使 video 进入 intentional/system suspended 且旧 track 已 drain，reservation 仍持续到整个 attempt teardown 或 terminal fatal 的所有 retired processor drain 完成后才释放。
- `.clearing` 与所有其他 lease 互斥；任何 SDK 操作进行时不得执行 `clearModelCache()`。live reservation 存在时，enroll、单帧诊断与模型清理回传明确的 `SDK_BUSY_LIVE_SESSION`，不与实时帧并发，也不得替换该 attempt 的 latent。
- enroll 或 initialize 进行中不能启动 live preflight；UI 显示对应阶段，不另开第二条 SDK queue。
- LiveKit capturer 自己的串行队列不等于全 App 排他；所有 plugin 入口都必须经过 coordinator。

### 唯一发布路径

- 生产换脸视讯继续使用现有 `LocalVideoTrack.createCameraTrack`，明确维持 track source 为 `.camera`。
- processor 的第一帧继续是黑色 dimension bootstrap，避免发布初始化期间的原始画面。
- 新 track 先在本机 `start()`，processor 确认至少一帧成功通过 Amigo，并在启用背景时同时通过 Vision 与合成后，才把 `processedVideoReady` 标记为 true 并发布 track。预检逾时会停止 track 且不会让后端看到 active CAMERA source。
- `connectNativeRoom` 只有在安全帧预检、track 发布与 connection commit 全部成功后才 resolve；既有后端 host-ready 检查因此不会只凭黑色 bootstrap 误判可通话。
- 不建立 `AmigoLiveSession`、第二个 camera session、第二条 buffer track 或 Web 默认 camera track。
- v1.0.2 单帧 `processFrame` 可保留给 enroll 后诊断，但不得作为生产实时发布路径；生产只能通过 strict adapter。

## 生命周期与失败行为

- 建立通话前没有有效 `FaceLatent` 时沿用 `FACE_SWAP_NOT_READY`，不启动摄像头、不产生联系人来电。
- 若当前账号没有背景档，按正常换脸建立通话。
- 若状态表示已有背景，但通话启动时背景无法读取或解码，建立通话失败并回报 `BACKGROUND_IMAGE_INVALID`；不能悄悄改用真实背景。
- strict adapter 回传 blocked、SDK 错误或无脸时输出黑帧，并保留节流诊断。
- 背景启用时，Vision 分割或合成任一步失败都输出黑帧；不能回传只有换脸但保留真实背景的帧。
- 首个有效处理帧在摄像头启动后 15 秒仍未出现时，停止未发布的 track、中止建立换脸视讯并清理房间。
- 首帧成功后，暂时找不到脸、SDK 合法回传 `nil` 或人物离开镜头时继续输出黑帧但不自动挂断；这属于安全的可恢复状态。
- publishing 状态下摄像头连续 5 秒完全没有输入 frame，或同一个不可恢复的处理错误连续 3 秒时，原生层停止发布并发出当前 generation 的 `nativePublisherFatal`；JS 随后结束对应邀请或联系人通话。单纯「没有侦测到脸」不得计入不可恢复错误；媒体服务重置依下述 system suspended/re-arm 处理，不在事件发生当下直接判 fatal。
- `setNativeFaceSwapEnabled(false)` 进入下述 intentional suspended 状态，不把它映射到会输出输入画面的 vendor session 属性。
- 背景选择、写档与移除使用独立 loading 状态，不复用人脸「启用中」或建立视讯状态。
- 背景 API、通话建立 API 与断线清理保证每个请求只完成一次，避免 Capacitor call 卡住。

## 媒体状态机与重新启用

每个 room attempt 的 video publisher 只能处于以下状态之一：

`idle → preflighting → publishing → suspended → preflighting`，任何状态都可进入 `tearingDown → idle` 或 terminal `fatal`。

- **preflighting**：本机启动 track、等待首个 strict-safe frame；尚未发布到 LiveKit。
- **publishing**：已通过预检并发布；只有此状态启用输入 frame watchdog。
- **intentional suspended**：用户关闭摄像头或 App 进入背景。先 invalidate 旧 publication generation，再取消发布、停止并 drain track；LiveKit room 与既有音讯行为保持不变，watchdog 暂停，不因背景停留时间自动结束整通电话。
- **system suspended**：摄像头 interruption 或 media-services reset。处理方式同样先 fail closed 并停止旧 track；系统通知恢复后才尝试 re-arm。
- **re-arm**：用户重新开镜头、App 回到前景或系统 interruption 结束时，建立新的 publication generation，重新载入同一个 attempt 的锁定背景快照，执行完整的本机 safe-frame preflight，再发布新 track。不能只把旧 processor 的 enabled 改回 true。
- re-arm 15 秒内没有 safe frame或发布失败时进入 `fatal`，由 sticky fatal event 结束对应视讯；旧 fatal attempt 不会自行复活。

## 并发与资源释放

- 背景影像、Vision request 与缓存 buffer 由 processor 的串行处理上下文持有。
- 背景只在 connection generation 开始时建立不可变快照，通话期间不更换。若 native room 正在连接或已连接，`setBackgroundImage` 与 `clearBackgroundImage` 必须拒绝并回传 `BACKGROUND_CHANGE_DURING_CALL`；用户结束通话后才能变更。
- 每个 publication generation 锁定 `backgroundRequired`。一旦为 true，即使背景对象意外缺失也只能输出黑帧；绝不能进入「未设背景」分支并显示真实环境。
- 只有新的 App-created `attemptId` 才以该次传入的 `userCode`、`deviceId` 读取磁碟并锁定 attempt-level `{ backgroundRequired, image }` 快照。LiveKit transport reconnect 与同 attempt 的 publication re-arm 都继承该快照，不重新读取磁碟。
- 取消连线、发布失败、挂断与账号切换先 invalidate publication generation，使所有处理中 frame 只能 drop/black，再取消发布并停止 track。
- 背景载入、track start、safe-frame preflight、publish、commit、unpublish 与 teardown completion 都在单一 session coordinator 上排序，并在改变状态前检查 `attemptId` 与 generation；不得从 LiveKit processor queue 直接执行 room teardown。
- LiveKit 2.16 的 `stopCapture` 不保证处理队列已经排空。processor 以 in-flight counter 提供 drain barrier：停止 track 后等待现有工作结束；若等待超过 2 秒，旧 processor 进入 retirement pool 并继续被强引用到 counter 为零，期间 generation gate 仍阻止任何 frame/callback 输出。
- 只有 drain 完成后才释放 retired processor 对背景、遮罩与缓存的引用；attempt-level 背景快照保留到整个 attempt teardown。每帧在 Amigo/adapter 后、Vision/合成后及 return/callback 前各检查一次 publication generation。
- 所有 readiness callback、逾时任务与 fatal event 都携带 `attemptId` 与内部 generation。旧 attempt/generation 的迟到 frame、callback 或 event 不得写入新 processor、改变新状态或结束新房间。

## 隐私与安全

- 背景照片及缩图只存在 iOS App 沙盒，不上传后端。
- 日志不得包含图片 Base64、原始授权码、`deviceId`、完整本机路径或可识别的档名。
- LiveKit 只发布 processor 输出；所有错误路径必须证明会产生黑帧或停止发布。
- 账号切换时，上一账号的背景对象从 UI、bridge 与 native processor 内存释放。
- 无背景时显示真实背景是用户主动未启用替换的既有行为；只要用户已启用背景，任何背景处理失败都必须 fail closed。
- 「不得发布原始镜头」指不得发布 SDK 未确认已换脸的 fallback frame。「背景替换」依赖 Vision 人像分割，头发与人物边缘可能有少量视觉误差，不能宣称数学上的零背景像素泄漏；但不得在分割失败时整帧回退真实背景。

## 效能与装置范围

- 最低系统维持项目现况 iOS 16；iPhone 13 在支援范围内。
- 无背景时完全跳过 Vision 分割，不增加 strict 换脸路径负担。
- 有背景时以现有 1280×720、24 fps 为目标；摄像头继续丢弃迟到帧，不能累积处理队列增加延迟。
- Vision 使用 `.balanced`，背景与输出 buffer 均缓存；不执行每帧 JPEG 解码或档案读取。
- 真机验收观察实际帧率、端到端延迟、内存与温度。连续 10 分钟通话不得出现记忆体持续增长、App 被系统终止或画面回退成原始镜头。
- 若 iPhone 13 无法稳定处理 720p/24 fps，实施阶段只能下调「背景启用时」的 capture fps 或尺寸，并以双机画质验收；不得通过跳过遮罩或发布未替换背景来换取效能。

## 相容性与迁移

- v1.0.2 既有 TestFlight build 已把 `nativeRealtimeLiveKit=true` 写在 binary 内，无法靠新前端 capability 关闭。取得 strict SDK 前，后端先启用全域 face-swap media kill switch：联系人 `face_swap` token、外部邀请建立/加入与既有 active invite 一律拒绝或失效，但普通视讯、语音与讯息不受影响。
- kill switch 启用流程同时把所有 active 联系人 `face_swap` call 与外部 invite 标为 ended，并透过 LiveKit Room Service remove participant/delete room，强制断开已加入的 v1.0.2 native CAMERA publisher；JWT 停止签发或过期本身不视为断线。后端确认相关房间与 CAMERA publication 数量归零后，才把 kill switch rollout 标记为完成。
- strict build 上线时，native bridge 回传 bundle build number 与固定的 `sdkContractId`。后端只为 allowlist 中通过审核的 build/contract 签发换脸 token；缺少、旧版或不相符一律回传 `STRICT_FACE_SWAP_UPDATE_REQUIRED`。TestFlight 同时停止旧 build 的测试资格，避免用户继续使用已知 v1.0.2 路径。
- rollout 顺序固定为：先部署 server kill switch → 取得并验证 strict SDK → 发布新 build → 双机验收 → 后端只对白名单 strict build 开启换脸。不得先开放客户端再补 server gate。
- 新 Amigo XCFramework 必须固定精确版本与 artifact checksum，并保留 public interface 供 CI 审查；不能自动漂移到未验证版本。
- strict capability 只有在 vendor 文件明确承诺所有未换脸路径 drop/throw，或逐帧回传 `faceSwapApplied`，并通过真机 failure-injection/无脸测试后才能设为 true。
- 不迁移或删除既有 `FaceLatent`、人脸照片记录或授权码资料。
- 没有本机背景的既有用户自动视为 `hasBackground=false`。
- 普通视讯继续走原有 Web/LiveKit 摄像头路径，不执行 Amigo 或 Vision 背景处理。
- 联系人换脸与外部来宾换脸继续使用现有 token、room、inviteId、六位密码及音讯配置，只扩充主持人的既有 native video processor。
- 新桥接方法只在新 iOS build 可用；旧 build 不显示背景设定入口。
- 在 strict SDK 尚未取得或验证失败时，原生 capability 固定为 `nativeRealtimeLiveKit=false`、`nativeBackgroundReplacement=false` 与 `strictFaceSwapFrames=false`，原生 connect 也强制拒绝。若 strict build 回滚，后端立即恢复全域 kill switch 并关闭三项 capability；背景功能没有新增服务器储存资料，因此不需要资料迁移回滚。

## 测试计划

### 前端与桥接

- 选择有效图片只调用背景 API，不调用 `enrollFace`、不改变 `faceReady`。
- 非图片、动画图片、超过 10 MB 或无法解码的档案显示明确错误。
- 设定失败时旧预览仍在；成功时显示新预览。
- 移除背景后显示未设定，且人脸仍为已启用。
- 切换授权码后不会显示上一账号预览。
- 非原生或旧原生版本不显示不可用入口。
- v1.0.2、缺少 strict capability 或 artifact contract 不相符时，原生背景方法与 native room connect 在读档、摄像头及 LiveKit 动作前拒绝。

### 后端 rollout gate

- kill switch 开启时，联系人换脸 token、外部邀请建立与来宾加入全部拒绝，既有 active invite 失效；普通视讯、语音、讯息及联系人行为维持正常。
- 在一通已连接的 v1.0.2 联系人换脸视讯与一间 active invite room 中开启 kill switch，断言 call/invite 状态转 ended、LiveKit participant/CAMERA publication 被移除，并等到零 active face-swap room；不能只等待旧 JWT 到期。
- 缺少 build/contract、旧 TestFlight build、伪造未知 contract 与低于 allowlist 的 build 都无法取得换脸 token，也不会产生联系人来电通知。
- 只有 allowlist strict build 可建立联系人换脸与外部邀请；关闭 allowlist 会立即恢复 fail-closed。

### 原生储存与合成

- 图片方向、尺寸限制、缩图、备份排除、原子写入、覆盖、移除与损坏档处理。
- ImageIO metadata 预检拒绝多帧来源、超出 16,384 像素边长、超过 80 MP 与伪装成图片的资料，并证明下采样前不会完整配置原图像素内存。
- manifest 存在但完整图遗失或 checksum 错误时保持 configured-invalid，通话必须失败；只有明确移除才转为未设定。仅缩图损坏时必须从完整图重建，不把有效背景判为失效。
- 在新完整图、缩图、manifest pointer 与 clear tombstone 的每一个写入阶段模拟 crash；重启后只能读到旧完整 generation、新完整 generation 或明确 none，不能读到半套档案。
- 同一 scope 可在重启后恢复；不同 scope 无法读取彼此背景。
- 直向、横向与前镜头旋转的遮罩和换脸输出精确对齐。
- aspect-fill 背景不会出现空白边或错误拉伸。
- 对带人工 ground-truth 人物遮罩的测试片段，排除人物轮廓 3 像素边缘带后，至少 98% 的真实背景像素须与预期 aspect-fill 背景保持每通道 8/255 以内差异，且不得出现大于全帧 2% 的连续真实背景泄漏区；轮廓边缘另做真机视觉验收。
- strict adapter blocked、Vision/合成失败时得到黑帧，不会得到原始画面或保留真实背景的换脸画面。
- 无背景时完全不调用 Vision，输出与现有 processor 行为一致。
- pending connect、取消、失败、重连与 disconnect 都会释放背景和相关缓存。
- 不开启设定弹窗直接建立通话、App 重启后重连及账号切换后重连，都会依该次 connect scope 取得正确背景。
- 所有输出 buffer 预先写成不透明黑色；模拟 CI render 不产出时不会重现旧 frame。
- 直向/横向、四种 rotation、前镜头预览镜像与不同 CI extent 的 fixture 均验证同一未镜像 buffer 坐标，不使用 stale mask。

### 媒体隐私契约

- processor 未就绪、没有 latent、strict capability 缺失、首帧 bootstrap、输入转换失败、adapter blocked、SDK 抛错、无脸、Vision 失败、遮罩失败、合成失败及 buffer 配置失败都断言 `rawCameraPublished=false`。
- 用测试版 SDK 注入「非 nil 原始输入＋`faceSwapApplied=false`」时，adapter 必须阻挡该帧；生产版本若没有可注入或可观察的等价状态，strict 契约视为未通过。
- 生产换脸通话只建立一个 `.camera` source track，且一定挂载 `AmigoRealtimeVideoProcessor`。
- 不得调用 `AmigoLiveSession` 或 Web 默认 camera track。
- 安全帧预检成功前 LiveKit 不存在 active CAMERA publication；成功后 `connectNativeRoom` 才回传 `processedVideoReady=true`。
- fatal event 只结束相同 generation 的邀请或联系人通话，并阻止自动重连；快速挂断重连和快速切换账号不会让旧 frame/event 进入新通话。
- 旧 attempt 的 disconnect、camera toggle、re-arm 与 acknowledge 命令全部回传 ignored，不能改变新 attempt。
- 暂时遮住脸或人物离开超过 5 秒只维持黑帧，不触发 fatal；停止输入 frame 或注入不可恢复错误才触发 fatal。
- fatal 在 connect resolve 前发生、listener 短暂重建或 JS 恢复时仍可由 sticky status 取得，并在 acknowledge 后只处理一次。
- intentional camera-off 与 App 背景会暂停 video 但维持既有 room/audio 行为；重新启用必须新建 generation、重新预检再发布。
- enrollment、diagnostic 与 live lease 的并发测试证明 Amigo SDK 不会由两个 queue 同时调用。
- intentional/system suspended 期间 attempt-level live reservation 与 latent 仍保持；enroll 与 clearModelCache 必须被拒绝，直到 attempt 完整 teardown/fatal drain。

### 回归与真机端到端

1. iPhone 13 选择背景、关闭并重开 App，当前账号预览与状态仍正确。
2. 建立联系人换脸视讯，被叫方看到换脸人物与所选背景，双方语音正常。
3. 建立外部邀请，Safari 来宾输入六位密码后看到相同合成画面，双方语音正常。
4. 移除背景后，两条通话链恢复既有普通换脸画面。
5. 切换另一个授权码后，不会套用或预览前一账号背景。
6. 遮住脸、快速移动、旋转手机及注入处理错误时，远端只看到黑帧或有效合成帧，不会看到原始镜头。
7. 普通联系人视讯、邀请链接、密码、接听、拒接、挂断与现有拖曳自我预览全部维持通过。
8. 连续 10 分钟真机通话检查帧率、温度、内存与重连清理。

### 发布门槛

- 先取得满足 strict 契约的 Amigo SDK；未取得时本规格维持 blocked，不能进入 production implementation 或开放 capability。
- 完整前端测试、lint、production build 与既有 build-chain 检查通过。
- Capacitor iOS assets 同步验证通过，Xcode generic iOS 编译与 Archive 通过。
- 在可连线真机完成背景选择、App 重启恢复、联系人通话及外部 Safari 来宾通话后，才建立新的 TestFlight build。
- TestFlight 上传或提交测试审核仍依既有发布流程执行，不以模拟器或单元测试取代双机验收。

## 完成标准

只有同时满足以下条件才可称为完成：

- 背景选择、预览、更换、移除与账号隔离通过测试。
- App 重启后可恢复当前账号背景。
- 联系人与外部来宾实际看到同一条 processed track 的合成画面。
- 未设背景时换脸功能与现况一致。
- 启用背景后，不论人脸、分割或合成错误都没有发布原始镜头或真实背景。
- 普通视讯、语音、房间、邀请与权限回归测试通过。
- iPhone 13 真机完成至少一次联系人通话、一次外部来宾通话与 10 分钟稳定性测试。

## 给 Amigo 官方的必要 SDK 请求

在开始生产实现前，需向 Amigo 支援提供 v1.0.2 的以下事实与请求：

1. `AmigoLiveSessionDelegate.didOutput` 没有处理状态，session 的无脸、推理与背景合成失败路径会 finalize 输入影像。
2. 静态 `processFrame` 的公开结果只有 `CIImage?`，binary 仍存在非 nil 输入影像共同 return path。
3. 本项目需要以下任一公开、受版本保证的能力：
   - `processFrameStrict`：任何未换脸或降级路径只回传 nil/throw，绝不回传输入；或
   - `ProcessedFrame(image:, faceSwapApplied:, failureReason:)`，让发布端只接受 `faceSwapApplied == true`。
4. 需提供可重复的 failure-injection 或 conformance test，涵盖无脸、landmark、CoreML 推理、mask/filter 与背景合成失败。
5. 新 XCFramework 需有明确版本、release notes 与 checksum；仅口头说明不足以开启 production capability。
