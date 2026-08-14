# 联系人换脸视讯与外部来宾邀请实施计划

## 1. 锁定协议与测试基线

- 为 `live_calls.mediaMode`、联系人校验与 AI 权限新增失败测试。
- 为联系人换脸发起预检、普通通话不回归、原始 camera 不发布新增前端测试。
- 为 UUID＋六位密码 Guest 路由、canonical HTTPS 与旧 hash 协议淘汰新增契约测试。

## 2. 扩展既有联系人通话状态机

- 在 schema、`callState.prepareP2P`、incoming/outgoing/status/join 回传中加入向后兼容的媒体模式。
- 后端仅对 `face_swap` 发起方校验完整 AI 权限与联系人关系；被叫方仍只校验普通视讯权限。
- 保留现有来电通知、接听、拒绝、超时、转接与结束逻辑。

## 3. 接入联系人换脸发起端

- 在联系人操作区增加仅全功能码可见的换脸视讯入口。
- 创建来电前依序完成 native availability、FaceLatent、媒体权限与换脸启用预检。
- 让 `CallContext`/通知上下文传递媒体模式；发起方接听后用 native room 加入并发布处理后视频，跳过 Web camera。
- 将失败阶段与原始 native/backend error 显示给用户，并保证失败清理不会遗留来电或房间。

## 4. 统一外部来宾生产流程

- 验证 Convex 只产生 `https://tokoyochet.com/video_call/<UUID>`。
- 构建当前 GuestVideoCall bundle，并部署到 tokoyochet.com，替换旧 `#key=wvi_...` 页面。
- 以浏览器验证密码页、错误密码、正确加入 token、第三人限制及结束失效。

## 5. 构建、部署与发行验证

- 执行 TypeScript、Vitest、Convex、build-chain、Vite build 与 Capacitor sync。
- 部署正确 Convex 与 Web；核对线上 bundle/Convex endpoint/路由。
- 使用 Xcode 26 完成 iOS archive；检查版本、commit marker、Amigo key 注入、签名与处理轨契约。
- 上传新 TestFlight build；若缺双机实测条件，仅把真实设备端到端验收列为唯一外部条件，不以编译代替实测。

## 6. 审查与主版本同步

- 执行独立代码审查并修复高风险问题。
- 提交 feature 分支，正常合并到 main 并 push，不 force push。
- clean clone 复验依赖安装、Web build 与 iOS sync。
