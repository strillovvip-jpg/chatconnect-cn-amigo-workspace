# 联系人换脸视讯与外部来宾邀请设计

## 目标

在不建立第二套普通通话系统的前提下，完成两条可验证链路：

1. 全功能授权码可从既有联系人发起换脸视讯；被叫联系人沿用现有来电、接听、拒接、挂断与 LiveKit 房间流程。
2. 全功能授权码可建立 `https://tokoyochet.com/video_call/<inviteId>` 外部邀请；来宾输入独立六位密码后加入一对一房间。

普通视讯、语音、联系人与既有权限行为保持不变。

## 联系人换脸视讯

### 权限与信令

- `live_calls` 增加媒体模式：`standard` 或 `face_swap`；旧记录没有字段时按 `standard` 处理。
- 发起联系人换脸视讯必须同时满足 `canVideoCall`、`canAIFace` 与 `canVideoSource`。前端仅控制入口，Convex `prepareP2P` 再执行权威校验。
- 后端确认被叫方是发起方现有联系人。被叫方仅需拥有普通视讯权限，不需要 AI 权限。
- `incomingCall`、`outgoingCall` 与加入授权回传媒体模式，让双方都知道本次通话类型，但来电通知、接受、拒绝、超时、挂断与房间状态仍复用 `callState`。

### 防止失败来电

发起顺序固定为：

1. 检查原生能力与已存在的 `FaceLatent`。
2. 请求摄像头与麦克风权限。
3. 启用原生换脸处理器并执行就绪检查。
4. 通过后端权限校验并建立 ringing call。

前 3 步失败时不调用 `prepareP2P`，因此不会产生来电通知。后端失败也不会创建通知。错误必须保留阶段、错误码与原始消息。

### 媒体发布

- 发起方在收到对方接听后取得同一房间的两个不同 identity/token：原生发布者 token 只允许发布摄像头、禁止订阅；Web companion token 只允许发布麦克风并订阅，token 层禁止 camera。
- 原生发布者先使用 `nativeAmigoRoom.connect` 加入并发布 Amigo `processFrame` 处理后的自定义视频轨；不启动 Web/LiveKit 默认 camera track，不允许以原始镜头作为失败回退。成功后 Web companion 才加入，以发布麦克风并显示及播放被叫方媒体。
- 被叫方继续使用现有 Web LiveKit 加入与普通摄像头/麦克风发布，正常订阅发起方处理后轨道。
- `CallContext` 对 `face_swap` 发起方的 Web companion 跳过所有本地麦克风、camera 与 VideoSourceManager 初始化；通话 UI、计时、来电状态与挂断仍使用同一上下文。额外 identity 通过 metadata/identity 过滤，不计入对方人数，也不会被选为自我远端画面。挂断时同时断开原生房间并结束同一 `live_calls` 记录。
- 原生发布失败时终止通话、清理房间状态，并显示准确失败阶段；不会改为发布原始画面。

## 外部来宾邀请

- 后端只使用可信的 `https://tokoyochet.com` 作为公开 origin，不接受 Capacitor WebView 的 `window.location.origin` 生成网址。
- `inviteId` 使用 UUID；密码使用独立六位数字，密码只以 salted hash 保存，不放入 URL。
- LiveKit 房间限制两人；正确密码验证后才签发 guest token；邀请结束、过期或已有来宾时拒绝加入。
- 生产 `tokoyochet.com` 必须部署当前仓库的 `GuestVideoCallPage` 与 `adorable-parakeet-350` Convex 配置，淘汰旧 `#key=wvi_...` 页面协议。
- 操作端继续用原生处理轨加入外部邀请房间；来宾网页只提供密码、摄像头、麦克风、加入与挂断。

## 兼容与回滚

- `mediaMode` 为可选字段，缺失即 `standard`，保证现有通话记录与客户端兼容。
- 普通通话入口显式发送 `standard`；换脸入口显式发送 `face_swap`。
- Web 部署前保留现有生产构建备份；失败时只回滚静态站点，不回滚后端已兼容的 HTTPS URL 修复。
- 所有 Secret 保留在 Convex、Xcode Build Settings 或 CI Secret，不进入 Git。

## 验收

- 后端测试证明普通授权码即使直接调用 API 也无法发起联系人换脸视讯；非联系人不可被呼叫；普通被叫联系人可接听。
- 前端测试证明原生预检失败不会调用创建来电；换脸发起方不会发布 Web 原始 camera track；普通视讯不受影响。
- 外部邀请测试证明 URL 为 canonical HTTPS、无 hash key、错误密码拒绝、第三人拒绝、结束后失效。
- 当前 Web build 部署至 tokoyochet.com 后，浏览器实际显示六位密码页并使用新 Convex deployment。
- iOS build/archive 验证原生处理轨路径；最终双机画面与声音验收需要两台真实设备。
