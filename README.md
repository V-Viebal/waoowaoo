<p align="center">
  <a href="https://www.vvicat.com/">
    <img src="images/cta-banner.png" alt="探索 AI 影视的下一代创作流 | 立即加入 vvicat 在线网页版内测候补" width="800">
  </a>
</p>

<p align="center">
  <img src="public/banner.png" alt="vvicat" width="600">
</p>

<h1 align="center">vvicat AI 影视 Studio</h1>

<p align="center">
  一款基于 AI 技术的短剧/漫画视频制作工具，支持从小说文本自动生成分镜、角色、场景，并制作成完整视频。
</p>

<p align="center">
  <a href="README_en.md">English</a> · <a href="https://www.vvicat.com/">加入内测候补</a> · <a href="https://github.com/saturndec/vvicat/issues">反馈问题</a>
</p>

> [!IMPORTANT]
> ⚠️ **测试版声明**：本项目目前处于测试初期阶段，由于暂时只有我一个人开发，存在部分 bug 和不完善之处。我们正在快速迭代更新中，**欢迎进群反馈问题和需求，及时关注项目更新！目前更新会非常频繁，后续会增加大量新功能以及优化效果，我们的目标是成为行业最强AI工具！**

<img src="https://github.com/user-attachments/assets/d190bf41-488d-47df-a5df-06346ef0f2f5" width="30%">

---
## ✨ 功能特性

- 🎬 **AI 剧本分析** — 自动解析小说，提取角色、场景、剧情
- 🎨 **角色 & 场景生成** — AI 生成一致性人物和场景图片
- 📽️ **分镜视频制作** — 自动生成分镜头并合成视频
- 🎙️ **AI 配音** — 多角色语音合成
- 🌐 **多语言支持** — 中文 / 英文界面，右上角一键切换

---

## 🚀 快速开始

**前提条件**：安装 [Docker Desktop](https://docs.docker.com/get-docker/)

### 方式一：拉取预构建镜像（最简单）

无需克隆仓库，下载即用：

```bash
# 下载 docker-compose.yml
curl -O https://raw.githubusercontent.com/saturndec/vvicat/main/docker-compose.yml

# 启动所有服务
docker compose up -d
```

> ⚠️ 当前为测试版，版本间数据库不兼容。升级请先清除旧数据：

```bash
docker compose down -v
docker rmi ghcr.io/saturndec/vvicat:latest
curl -O https://raw.githubusercontent.com/saturndec/vvicat/main/docker-compose.yml
docker compose up -d
```

> 启动后请**清空浏览器缓存**并重新登录，避免旧版本缓存导致异常。

### 方式二：克隆仓库 + Docker 构建（完全控制）

```bash
git clone https://github.com/saturndec/vvicat.git
cd vvicat
docker compose up -d
```

更新版本：
```bash
git pull
docker compose down && docker compose up -d --build
```

### 方式三：本地开发模式（开发者）

```bash
git clone https://github.com/saturndec/vvicat.git
cd vvicat

# 复制环境变量配置文件（必须在 npm install 之前完成）
cp .env.example .env
# ⚠️ 编辑 .env，填入你的 AI API Key（NEXTAUTH_URL 默认已是 http://localhost:3000，无需修改）

npm install

# 只启动基础设施
# 注意：docker-compose.yml 将服务映射到非标准端口，.env.example 已按此预设
mysql:13306  redis:16379  minio:19000
docker compose up mysql redis minio -d

# 初始化数据库表结构（首次必须执行，跳过会导致启动后报错）
npx prisma db push

# 启动开发服务器
npm run dev
```

> [!WARNING]
> 跳过 `npx prisma db push` 会导致所有数据库表不存在，启动后报错 `The table 'tasks' does not exist`。请务必先运行此命令再启动开发服务器。

---

访问 [http://localhost:13000](http://localhost:13000)（方式一、二）或 [http://localhost:3000](http://localhost:3000)（方式三）开始使用！

> 首次启动会自动完成数据库初始化，无需任何额外配置。

> [!TIP]
> **如果遇到网页卡顿**：HTTP 模式下浏览器可能限制并发连接。可安装 [Caddy](https://caddyserver.com/docs/install) 启用 HTTPS：
> ```bash
> caddy run --config Caddyfile
> ```
> 然后访问 [https://localhost:1443](https://localhost:1443)

---

## 🔧 API 配置

启动后进入**设置中心**配置 AI 服务的 API Key，内置配置教程。

> 💡 **注意**：目前仅推荐使用各服务商官方 API，第三方兼容格式（OpenAI Compatible）尚不完善，后续版本会持续优化。

---

## 📦 技术栈

- **框架**: Next.js 15 + React 19
- **数据库**: MySQL + Prisma ORM
- **队列**: Redis + BullMQ
- **样式**: Tailwind CSS v4
- **认证**: NextAuth.js

---

## 📦 页面功能预览

![4f7b913264f7f26438c12560340e958c67fa833a](https://github.com/user-attachments/assets/fa0e9c57-9ea0-4df3-893e-b76c4c9d304b)
![67509361cbe6809d2496a550de5733b9f99a9702](https://github.com/user-attachments/assets/f2fb6a64-5ba8-4896-a064-be0ded213e42)
![466e13c8fd1fc799d8f588c367ebfa24e1e99bf7](https://github.com/user-attachments/assets/09bbff39-e535-4c67-80a9-69421c3b05ee)
![c067c197c20b0f1de456357c49cdf0b0973c9b31](https://github.com/user-attachments/assets/688e3147-6e95-43b0-b9e7-dd9af40db8a0)

---

## 🤝 参与方式

本项目由核心团队独立维护。欢迎你通过以下方式参与：

- 🐛 提交 [Issue](https://github.com/saturndec/vvicat/issues) 反馈 Bug
- 💡 提交 [Issue](https://github.com/saturndec/vvicat/issues) 提出功能建议
- 🔧 提交 Pull Request 供参考 — 我们会认真审阅每一个 PR 的思路，但最终由团队自行实现修复，不会直接合并外部 PR

---

**Made with ❤️ by vvicat team**

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=saturndec/vvicat&type=date&legend=top-left)](https://www.star-history.com/#saturndec/vvicat&type=date&legend=top-left)

---

## OmniVoice 集成部署

vvicat 通过 `@omnivoice/sdk` 接入 OmniVoice-Studio 后端,提供第三个语音 provider(与 fal、bailian 并列),覆盖 TTS / 声音克隆 / 声音设计三条路径。

### 环境变量

```bash
# 必填:服务端可达的 OmniVoice 后端地址
OMNIVOICE_BASE_URL=http://omnivoice-backend:3900

# 可选:请求超时(默认 5 分钟,长任务保险丝)
OMNIVOICE_REQUEST_TIMEOUT_MS=300000
```

### SDK 包

`@omnivoice/sdk` 已 vendored 到仓库 `vendor/omnivoice-sdk/`(只包含构建产物 `dist/`,~148 KB)。无需 sibling 仓库或额外构建步骤,`npm install` 直接可用。

升级 SDK 版本时:从 OmniVoice-Studio 仓库重新构建 `bun run build` 后,把 `dist/` 拷过来覆盖即可。

### 后端部署要点

- OmniVoice 后端的 voice profile 持久化在容器内 `omnivoice_data/`。**部署时必须挂载该目录**,否则容器重启会丢音色,vvicat 中已绑定的 voiceId 全部 dangling。
- 推荐用 OmniVoice 官方 Docker 镜像,在 docker-compose 里加上 service + volume。
- vvicat 后端服务对 OmniVoice 后端 reachable 即可,**不需要 apiKey、不需要用户配置**(用户在 voice-design 对话框选 provider 即可)。

### 验收

- 健康检查:`GET /api/providers/omnivoice/health` 返回 `{ available: true, version, device }`
- 资源库声音设计 + 克隆功能可用
- OmniVoice 后端离线时,fal/bailian voice line 路径不受影响

### 已知跟进项(Follow-ups from Task 15 + Task 17)

- **MediaObject ownership schema**:`MediaObject` 表无 `userId` 列。当前 voice-clone 接口靠 `voices/<userId>/...` storage key 前缀做归属判断。后续应:加 `userId` 列(migration + 反向关系回填),或把克隆接口入参从 `refAudioMediaId` 改为 `globalVoiceId`(走 `GlobalVoice.userId`)。
- **资源库克隆 UI 入口**:`/api/asset-hub/voice-clone` 已就绪,但前端尚未串接(`useVoiceCreation` 当前的上传流程不创建 MediaObject)。需要扩展上传路由让它返回 MediaObject id,或把克隆接口改为接 `globalVoiceId`。
- **默认音频模型选择**:Task 17 留下的口子 — `DefaultModelCards.tsx` 的 audio 选项来自用户的 `customModels`,omnivoice 是 catalog-only,目前不出现在默认下拉里。Task 17 的 catalog fallback 让 runtime 不再 fail,但用户体验上 OmniVoice 仅通过 voice-design 对话框 provider 下拉触达。
