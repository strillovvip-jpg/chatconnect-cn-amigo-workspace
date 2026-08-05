# 简体中文独立站部署说明

本目录是英文站代码的独立简体中文副本。它可以与英文站共用物理 VPS，但不得共用任何应用数据、后端项目、密钥、授权码或网站目录。

## 隔离原则

中文站必须单独拥有：

- 新域名与 TLS 证书
- 新 Convex 项目、部署和数据库
- 新 LiveKit 项目、API Key 和 API Secret
- 新 Web Push VAPID 密钥对
- 新总管理员授权码、管理员授权码和普通授权码
- 新环境变量、SSH 部署密钥与 GitHub Secrets
- 新 VPS 网站目录、Nginx 站点配置和备份目录

不得从英文站复制数据库、授权码、设备绑定、用户、联系人、消息、案件、文件、通话记录、录音或推送订阅。共用 VPS 只表示共用硬件与操作系统。

## 明天需要提供的资料

1. 新域名（是否同时启用 `www`）
2. 新 VPS 的 IP、SSH 用户、SSH 私钥和已确认的主机指纹
3. 新 VPS 上专用于中文站的网站目录，例如 `/var/www/chinese-portal`
4. 新 LiveKit 项目的 `LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET`
5. 新 Convex 项目名称，或允许在部署时创建一个全新项目
6. 一个全新的总管理员授权码（不要使用英文站的码）
7. Web Push 通知使用的联系邮箱

## 环境变量清单

先复制 `.env.example` 为本机专用的 `.env.local`，再替换所有占位符。`.env.local` 已被 Git 忽略，不要提交。

### 前端构建变量（值会进入浏览器包）

- `VITE_CONVEX_URL`：新中文 Convex 的 `*.convex.cloud` 地址
- `VITE_CONVEX_SITE_URL`：同一新中文 Convex 的 `*.convex.site` 地址
- `VITE_VAPID_PUBLIC_KEY`：新中文站的 VAPID 公钥
- `VITE_HERCULES_OIDC_AUTHORITY`：可选 OIDC 服务地址
- `VITE_HERCULES_OIDC_CLIENT_ID`：可选 OIDC 客户端 ID
- `VITE_HERCULES_OIDC_RESPONSE_TYPE`：可选，默认 `code`
- `VITE_HERCULES_OIDC_SCOPE`：可选 OIDC scopes
- `VITE_HERCULES_OIDC_REDIRECT_URI`：必须指向新中文域名
- `VITE_HERCULES_OIDC_PROMPT`：可选 OIDC prompt

前端变量不是秘密。任何私钥或 API Secret 都不得以 `VITE_` 开头。

### Convex 服务端变量（只设置在新中文 Convex 部署）

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `VAPID_SUBJECT`，例如 `mailto:admin@新域名`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `ROLE_MIGRATION_SECRET`：全新随机值，用于首次初始化角色
- `SUPER_ADMIN_CODE`：全新的中文站总管理员授权码
- `AUTH_CODE_IMPORT_SECRET`：与迁移密钥不同的全新随机值

示例命令（实际值不要写入 shell 历史或提交到 Git）：

```bash
npx convex env set LIVEKIT_URL 'wss://NEW_CN_LIVEKIT_HOST' --prod
npx convex env set LIVEKIT_API_KEY 'NEW_CN_LIVEKIT_API_KEY' --prod
npx convex env set LIVEKIT_API_SECRET 'NEW_CN_LIVEKIT_API_SECRET' --prod
npx convex env set VAPID_SUBJECT 'mailto:admin@NEW_CN_DOMAIN.example' --prod
npx convex env set VAPID_PUBLIC_KEY 'NEW_CN_VAPID_PUBLIC_KEY' --prod
npx convex env set VAPID_PRIVATE_KEY 'NEW_CN_VAPID_PRIVATE_KEY' --prod
npx convex env set ROLE_MIGRATION_SECRET 'NEW_RANDOM_ROLE_SECRET' --prod
npx convex env set SUPER_ADMIN_CODE 'NEW_CN_SUPER_ADMIN_CODE' --prod
npx convex env set AUTH_CODE_IMPORT_SECRET 'NEW_RANDOM_IMPORT_SECRET' --prod
```

### 可选 AI Worker 变量

`ai-worker/.env.example` 列出：

- `AI_PROVIDER`
- `WORKER_API_TOKEN`
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_AGENT_NAME`
- `VIDEO_PROCESSING_MODE`
- `FACE_DETECTION_INTERVAL`
- `FACE_DETECTION_SCALE`
- `FACE_TRACK_TIMEOUT_SECONDS`
- `FACE_TRACK_MAX_MISSED_DETECTIONS`
- `FRAME_PROVIDER`
- `MOBILE_TEST_PAGE_URL`：移动端回传测试页的新中文站 HTTPS 地址

如果不启用 AI Worker，保持 `AI_PROVIDER=mock`，不要部署 Worker 服务。

### VPS 部署变量

- `CN_VPS_HOST`
- `CN_VPS_USER`
- `CN_VPS_WEBROOT`
- `CN_DOMAIN`
- `CN_ENABLE_WWW`：`0` 只启用根域名；`1` 同时启用 `www`
- `CN_SSH_KEY`
- `CN_CONVEX_CLOUD_HOST`
- `CN_CONVEX_SITE_HOST`

部署脚本会拒绝缺少变量、非专用 `/var/www/<目录>` 或仍含占位符的配置。

## 创建全新 Convex 后端

1. 安装依赖：`npm ci`
2. 登录独立的 Convex 账号或团队。
3. 运行 `npx convex dev`，明确选择“创建新项目”，不要连接英文站现有部署。
4. 确认生成的 `VITE_CONVEX_URL` 与 `VITE_CONVEX_SITE_URL` 都属于新项目。
5. 使用上方清单设置新项目的服务端环境变量。
6. 运行 `npx convex deploy` 发布到新中文生产部署。
7. 使用新的 `ROLE_MIGRATION_SECRET` 调用 `roleManagement:initializeRoles`，建立由 `SUPER_ADMIN_CODE` 指定的总管理员。
8. 通过后台或 `scripts/import-auth-codes.mjs` 导入全新授权码；不要导入英文站的任何码。

首次初始化后应立即保存离线备份，并避免再次执行会重置角色的迁移操作。

### 批量导入 50 个全新授权码

授权码文件必须位于源码目录之外，每行一个授权码，正好 50 行且不得重复。导入前先确认这是全新的中文站 Convex 项目，因为批量导入会先清空该项目现有的 `allowed_codes`，再写入这 50 个授权码。

```bash
AUTH_CODE_IMPORT_SECRET='NEW_RANDOM_IMPORT_SECRET' \
INITIAL_ADMIN_CODES='ADMIN_CODE_1,ADMIN_CODE_2' \
npm run import-auth-codes -- /absolute/private/path/cn-auth-codes.txt --prod
```

也可以用 `AUTH_CODES_FILE` 指定文件路径。源码已忽略 `AUTH_CODES*.txt`，但仍建议导入后安全删除明文文件，只保留加密的离线备份，切勿提交到 Git 或放进交付压缩包。

## 建立独立 Web Push 密钥

在安全终端生成一套全新的 VAPID 密钥：

```bash
npx web-push generate-vapid-keys
```

公钥同时填入 `VITE_VAPID_PUBLIC_KEY` 与 Convex 的 `VAPID_PUBLIC_KEY`。私钥只填入 Convex 的 `VAPID_PRIVATE_KEY`，不得放入前端 `.env.local`、GitHub Variables 或源码。

## 配置新域名与 VPS

1. 将新域名的 `A` 记录指向新 VPS；如启用 `www`，也建立相应记录并设置 `CN_ENABLE_WWW=1`。
2. 在 VPS 上创建一个新的专用网站目录，不要使用英文站目录。
3. 安装 Nginx 与 Certbot，并为新域名单独申请证书；`CN_ENABLE_WWW=1` 时，证书必须同时覆盖根域名与 `www`。
4. 证书路径必须为 `/etc/letsencrypt/live/<新域名>/`，部署脚本使用此路径。
5. 设置上述 `CN_*` 变量后运行：

```bash
npm run build
bash scripts/deploy-vps.sh
```

脚本会渲染 `deploy/nginx-chatconnect.conf` 中的占位符，备份中文站旧版本，部署新文件，检查 Nginx，并确认线上 JavaScript 指向新中文 Convex。它不会接触英文站目录或 Nginx 站点名称。

## GitHub Actions 配置

工作流仅允许手动触发。需要建立：

GitHub Secrets：

- `CN_VPS_HOST`
- `CN_VPS_DEPLOY_KEY`
- `CN_VPS_KNOWN_HOSTS`

GitHub Variables：

- `CN_VITE_CONVEX_URL`
- `CN_VITE_CONVEX_SITE_URL`
- `CN_VITE_VAPID_PUBLIC_KEY`
- `CN_VPS_USER`
- `CN_VPS_WEBROOT`
- `CN_DOMAIN`
- `CN_ENABLE_WWW`
- `CN_CONVEX_CLOUD_HOST`
- `CN_CONVEX_SITE_HOST`

不要把 LiveKit Secret、VAPID Private Key、角色迁移密钥或授权码放入 GitHub Variables；这些只存在于新 Convex 的服务端环境中。

## 上线前验证

- `npm test`
- `npm run build`
- 确认生成文件不包含英文站域名、VPS IP、Convex deployment ID 或授权码
- 确认 `VITE_CONVEX_URL` 指向新中文项目
- 确认 LiveKit token 由新中文 Convex 使用新 LiveKit 密钥签发
- 确认新旧网站的授权码、联系人、消息和案件互相不可见
- 测试手机与电脑登录、来电、群组通话、转接、推送、案件查询和文件上传
- `nginx -t`
- 验证新域名 HTTP 自动跳转 HTTPS，HTTPS 返回 200
- 验证英文站仍正常运行且文件、配置与数据库没有变化
