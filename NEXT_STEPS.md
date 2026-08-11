# NEXT_STEPS — iOS 构建与真机验证交接

最后更新：2026-08-06
仓库根：`/workspace`，项目目录：`/workspace/chatconnect-cn-amigo-workspace`

> 本文件是断点交接文档。任何人（或下次会话的 Agent）接手时，先读本文件再继续。

## 一、当前状态

- 目标：App 在真机 iPhone 上启动正常、首页不黑屏、可进入主要页面（登录 → 通话 → Amigo 换脸）。
- 本环境为 Linux 沙箱，**无 xcodebuild / Xcode / Swift 编译器**，无法执行 iOS 原生编译与真机运行。web 层已全部验证通过。
- 截止当前，所有改动已提交到 git（`main` 分支，本地仓库）。**没有未提交的修改。**

## 二、已完成（已验证）

| 项目 | 结果 |
|------|------|
| 依赖安装 | `npm install` 完成，`npm ls --depth=0` 无错误 |
| Capacitor | core/cli/ios 均 8.5.0 |
| `npm run sync:ios` | 成功，patch 脚本自动恢复 Amigo 依赖与插件注册 |
| `npm run build` | 通过（tsc + vite，2463 modules） |
| `npm run lint` | 通过（eslint） |
| `npm run test` | 通过（5 files / 28 tests） |
| 日本版首页 | 已重构为黑金日式登录页，品牌为 `頌進 / ソン・ジン / 信頼・絆・未来`，含认証コード登录、QR图片读取登录、帮助展开区，浏览器真实渲染无报错 |
| pbxproj 结构 | 括号平衡、文件引用无缺失 |
| Info.plist | plistlib 解析合法，无 storyboard 双入口 |
| Swift 文件 | AppDelegate/SceneDelegate/AmigoFaceSwapPlugin 括号平衡 |
| Capacitor API 核对 | `CAPPlugin/CAPPluginCall/CAPPluginMethod/CAPBridgedPlugin/CAPLog/PluginConfig` 均存在，`resolve/reject/getString/getConfig` 签名匹配 |
| CocoaPods 残留 | 无 Podfile/Pods/链接标志（Capacitor 8 走 SPM） |
| App.xcworkspace | 存在，FileRef 指向 App.xcodeproj（优先用 workspace） |

### 本轮关键修复（上一会话已完成并提交）
- 黑屏根因防护：`src/main.tsx` 全局 error/unhandledrejection 兜底 + `renderFatal`；`app-error-boundary` 显示首条错误文字；`use-service-worker` 原生平台注销 SW 并清 caches；`App.tsx` 懒加载 consultation/chat/admin 并剥离登录页通话 provider；`amigo-boot` SDK 初始化延后到登录后；`ChinesePortal` 会话恢复 5 秒超时。
- iOS 入口：`AppDelegate` 用 `@main`（Capacitor 8 模板）；`Info.plist` 移除 `UIMainStoryboardFile`/`UISceneStoryboardFile`，`UIRequiredDeviceCapabilities` 改 `arm64`，新增摄像头/麦克风/相册权限文案；`SceneDelegate` 与 Capacitor 8 `SceneDelegateProxy`（仅 3 个方法）对齐；`SceneManifest` 指向 `SceneDelegate`。
- SPM：`ios/App/CapApp-SPM/Package.swift` 使用**本地 binary target**（`AmigoFaceSwapSDK` → `Vendor/AmigoFaceSwapSDK.xcframework`），依赖仅 `capacitor-swift-pm` 与 `LiveKit`，完全绕开 GitHub 私有仓库与 Token；`packageClassList: ["AmigoFaceSwapPlugin"]`。
- 补丁脚本 `scripts/patch-ios-spm.mjs`：每次 `cap sync ios` 后重写 `Package.swift` 为本地 binary target 并恢复插件注册（必须用 `npm run sync:ios`，不能用裸 `cap sync ios`）。
- 安装脚本 `scripts/install-local-amigo-sdk.sh`：从 `~/Downloads/AmigoFaceSwapSDK.xcframework.zip`（可传参指定）解包 SDK 到 `ios/App/CapApp-SPM/Vendor/`。

### 本轮首页改造（2026-08-06）
- `src/pages/ChinesePortal.tsx` 已改成日本版首页，仅保留日文文案和日本版品牌：`頌進 / ソン・ジン / 信頼・絆・未来`。
- 首页结构：品牌区 → 日式主标题 → 认証コード输入 → お名前（任意）→ 登录按钮 → `または` 分隔 → `QRコードでログイン` → 帮助展开区 → 安全声明。
- `QRコードでログイン` 当前实现为：在支持 `BarcodeDetector` 的浏览器/移动端，从相册或相机选择 QR 图片后自动解析 `code` 并填入认证码输入框。
- 登录后跳转逻辑未变：`admin/super_admin` → `/admin`，其他角色 → `/consultation`。
- `index.html` 与 `public/site.webmanifest` 已切换为日本版标题/描述/图标，新增 `public/icon/shojin-180.png`、`shojin-192.png`、`shojin-512.png`。

## 三、未完成 / 阻塞

1. **iOS 原生编译（Build）未在本环境执行** — 无 Xcode。需在 Mac 上运行：
   ```bash
   cd /workspace/chatconnect-cn-amigo-workspace
   bash scripts/verify-ios.sh
   ```
   脚本优先用 `ios/App/App.xcworkspace`，构建到 `/tmp/chatconnect-dd`，完整日志在 `/tmp/ios-build-errors.log`，失败时打印 `error:` 行。
2. **AmigoFaceSwapSDK Swift API 签名未确认** — `AmigoFaceSwap.initialize(apiKey:onProgress:)`、`enrollFace(from:)`、`processFrame(_:using:lipMode:)`（返回 CIImage?）、`LipMode.innerLips`、`clearModelCache()` 均按 SDK 常规用法编写，**须在 Mac 编译时对照真实 SDK 确认**。若报错，把第一条 error 原文回传。
3. **真机运行与黑屏验证** — 无法在本环境做。需用户选择 DEVELOPMENT_TEAM（Apple 签名）后 Build 到真机。
4. **平台能力** — 本环境对 GitHub 无 push 权限，提交仅存本地，改动通过对话汇报。

## 四、下一条要执行的命令（按顺序）

在 **macOS + Xcode** 环境：

```bash
# 1) 首次：安装依赖并安装本地 Amigo SDK（默认读 ~/Downloads/AmigoFaceSwapSDK.xcframework.zip，可传参指定）
cd chatconnect-cn-amigo-workspace
npm install
npm run install:amigo-sdk

# 2) 同步（补丁会自动恢复本地 binary target）并构建
npm run sync:ios
npm run build

# 3) 命令行 Build，收集完整错误
bash scripts/verify-ios.sh

# 4) 若 Build Succeeded：用 Xcode 打开 workspace 装真机
open ios/App/App.xcworkspace
#    - Signing & Capabilities 选择你的 Development Team
#    - 选择真机设备，Run
```

## 五、真机验证顺序（最终目标）

1. 首页（登录页）正常显示、无黑屏。
2. LiveKit 视频/语音通话可建立。
3. 通话中可切换 AI 换脸源。
4. 持续通话观察发热/帧率/崩溃，回传现象。

## 六、已知命令速查

| 命令 | 用途 |
|------|------|
| `npm run install:amigo-sdk` | 解包 `AmigoFaceSwapSDK.xcframework.zip` 到 `ios/App/CapApp-SPM/Vendor/`（默认读 ~/Downloads，可传路径参数） |
| `npm run sync:ios` | cap sync ios + 自动补丁（必用这个，别用裸 cap sync） |
| `npm run build` | web 构建（tsc + vite） |
| `npm run lint` | eslint |
| `npm run test` | vitest |
| `bash scripts/verify-ios.sh` | Mac 端 iOS 命令行 Build（唯一能验证原生编译的方式） |
