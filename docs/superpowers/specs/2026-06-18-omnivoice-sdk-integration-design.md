# OmniVoice-Studio SDK 接入 vvicat — 设计文档

- **日期**: 2026-06-18
- **方向**: 仅 TTS / 声音克隆 / 声音设计(不接 dub 视频配音管线)
- **运行模式**: 服务器侧共享后端
- **GlobalVoice 兼容**: 复用现有 `voiceId` + 扩展 `voiceType`,零 schema 改动
- **计费**: 服务商 provider + 服务价计费
- **生成参数**: 钉死后端默认值(numStep=16, speed=1.0, language="Auto")

---

## 1. 背景与目标

vvicat 当前的语音生成支持两个 provider:

- **fal**(IndexTTS2)— 上传参考音频做克隆,emotion prompt 控制情绪
- **bailian**(QwenTTS + qwen-voice-design)— 自然语言 prompt 设计音色 → 拿到 voiceId 后做 TTS

OmniVoice-Studio 是一个开源、本地优先的 TTS 后端,提供:

- 同时具备**克隆**(参考音频)与**设计**(`vd_states` 结构化或 `instruct` 自然语言)两种音色构建方式
- 持久化 voice profile,以 `id` 寻址
- TTS 同步生成 16-bit mono WAV(24 kHz),无需任务轮询

接入目标:把 OmniVoice 作为 vvicat 的第三个 audio provider,提供与 bailian 平权的克隆 + 设计 + TTS 能力,服务于 voice line 生成与角色音色资源库。

**非目标**:本期不接入 OmniVoice 的视频配音(dub)管线、不接 SSE 进度桥接、不重构现有 fal/bailian 路径。

---

## 2. 架构

### 2.1 Provider 镜像模式

新建 `src/lib/providers/omnivoice/`,与 `src/lib/providers/bailian/` 对称:

```
src/lib/providers/omnivoice/
├── index.ts            # re-exports
├── catalog.ts          # ensureOmnivoiceCatalogRegistered()
├── client.ts           # OmniVoice SDK 单例(per-baseUrl 缓存)
├── types.ts            # 内部类型
├── tts.ts              # synthesizeWithOmnivoiceTTS(profileId, text)
├── voice-design.ts     # createOmnivoiceVoiceDesign(input)
├── voice-clone.ts      # createOmnivoiceClone(refAudio, name, ...)
├── voice-manage.ts     # listProfiles / deleteProfile / getProfile
├── voice-cleanup.ts    # 删 GlobalVoice 时清理后端 profile
└── audio.ts            # generateOmnivoiceAudio() — 接 generators/audio 接口
```

### 2.2 修改的现有文件

| 文件 | 改动 |
|---|---|
| [src/lib/providers/official/model-registry.ts](src/lib/providers/official/model-registry.ts) | `OfficialProviderKey` 加 `'omnivoice'` |
| [src/lib/voice/provider-voice-binding.ts](src/lib/voice/provider-voice-binding.ts) | 加 `OmnivoiceVoiceGenerationBinding`(provider: `'omnivoice'`, profileId);扩 `SpeakerVoiceEntry` 联合;在 `resolveVoiceBindingForProvider` / `hasAnyVoiceBinding` / `getSpeakerVoicePreviewUrl` / `parseSpeakerVoiceMap` 中加 `omnivoice` 分支 |
| [src/lib/voice/generate-voice-line.ts](src/lib/voice/generate-voice-line.ts) | 加 `else if (providerKey === 'omnivoice')` 分支 |
| [src/lib/api-config.ts](src/lib/api-config.ts) | `getProviderKey` 识别 `omnivoice`(免 apiKey 类型 — 仅 baseUrl) |
| [src/lib/workers/handlers/voice-design.ts](src/lib/workers/handlers/voice-design.ts) | 按 payload.provider 分发 bailian/omnivoice |
| [src/lib/generators/audio/index.ts](src/lib/generators/audio/index.ts) | re-export |
| `src/components/voice/VoiceDesignDialogBase.tsx` 等 | UI 兼容(见 §6) |
| **`prisma/schema.prisma`** | **不动** |

### 2.3 依赖

```json
{
  "@omnivoice/sdk": "file:../OmniVoice-Studio/sdk/omnivoice-ts"
}
```

通过 monorepo 文件路径引用本地 SDK(SDK 文件已在 `/Users/xiaomao/Documents/fuyang/OmniVoice-Studio/sdk/omnivoice-ts/`,需要先 `bun run build` 产物到 `dist/`)。如果未来 SDK 发布到 npm,改成版本号即可。

### 2.4 环境变量

```bash
# .env.example 新增
OMNIVOICE_BASE_URL=http://127.0.0.1:3900
OMNIVOICE_REQUEST_TIMEOUT_MS=300000
```

只在服务器端读取。客户端不暴露,不需要 `NEXT_PUBLIC_` 前缀。

---

## 3. Voice Profile 生命周期

### 3.1 GlobalVoice 字段映射

| GlobalVoice 列 | bailian 取值 | omnivoice 取值 |
|---|---|---|
| `voiceId` | qwen-voice-design 返回的 voice id | OmniVoice profile id |
| `voiceType` | `qwen-designed` / `custom` | `omnivoice-clone` / `omnivoice-design` |
| `customVoiceUrl` | 用户上传参考音频(custom) / qwen 预览音频(qwen-designed) | clone:用户上传参考音频;design:OmniVoice 后端身份采样 |
| `customVoiceMediaId` | MediaObject 引用 | 同 |
| `voicePrompt` | 设计提示词 | 设计提示词(同时作为 `instruct`) |
| `gender`, `language`, `name`, `description` | 不变 | 不变 |

**`voiceType` 前缀即 provider 标识**(已确认现有取值范围):
- `qwen-designed` → bailian(qwen-voice-design 设计的音色)
- `omnivoice-clone` / `omnivoice-design` → omnivoice
- `custom` 或缺省/其他 → fal(参考音频路径)

provider-voice-binding.ts 中 `resolveVoiceBindingForProvider` 按 providerKey 查 character/speakerVoice,不直接按 voiceType 前缀分发(provider 由 audio model selection 决定,voiceType 仅用于资源库展示徽章 + cleanup 时识别归属)。

### 3.2 创建路径(Clone)

1. 用户在「资源库 → 声音 → 上传音频」上传参考音频
2. vvicat 把 bytes 上 MinIO,创建 MediaObject
3. **同步**调用 `omnivoice.design.createProfile({ kind: 'clone', name, refAudio: bytes, refAudioFilename, language })`
4. 拿到 `{ id }`,写 GlobalVoice:
   - `voiceId = id`
   - `voiceType = 'omnivoice-clone'`
   - `customVoiceMediaId = mediaObject.id`
   - `customVoiceUrl` = MediaObject 的 signed URL(预览)

失败处理:profile 创建失败 → MediaObject 已上传则保留(用户可重试),不留半成品 GlobalVoice。

### 3.3 创建路径(Design)

复用现有 `POST /api/asset-hub/voice-design` 入口与 BullMQ 任务流程,在 `voice-design` worker handler 中按 audio provider 选择路径:

- `bailian` → 现有 `createVoiceDesign(input, apiKey)`
- `omnivoice` → 新 `createOmnivoiceVoiceDesign(input)`(读 env baseUrl,不需要 apiKey)

OmniVoice design 调用 `omnivoice.design.createProfile({ kind: 'design', name, vdStates: { Style: 'Auto' }, instruct: voicePrompt, language })`,后端返回 `{ id }` + 渲染好的身份采样可通过 `getProfile(id)` 拿 `ref_audio_path`,vvicat 拉取并上传 MinIO 作为 `customVoiceUrl`。

**`vdStates` 用最小默认 `{ Style: 'Auto' }`**——按之前的决策,不在 UI 暴露 vdStates 表单,完全靠 `instruct = voicePrompt` 驱动。

worker 返回结果与 bailian 路径形状一致:`{ success, voiceId, audioBase64, sampleRate, responseFormat, ... }`,任务消费方(资源库 UI)无需感知 provider 差异。

### 3.4 删除路径(Cleanup)

新建 `src/lib/providers/omnivoice/voice-cleanup.ts`,镜像 bailian 的引用计数 + 真删模式:

```ts
export function isOmnivoiceManagedVoiceBinding(binding): boolean
  // voiceType 前缀 'omnivoice-' 即托管
export function collectOmnivoiceManagedVoiceIds(bindings): string[]
export async function collectProjectOmnivoiceManagedVoiceIds(projectId): Promise<string[]>
export async function cleanupUnreferencedOmnivoiceVoices({ voiceIds, scope }): Promise<...>
```

`cleanupUnreferencedOmnivoiceVoices` 内部调用 `omnivoice.design.deleteProfile(id)`(SDK 已暴露 `DELETE /profiles/{id}`)。

调用点(已枚举):

- [src/app/api/projects/[projectId]/route.ts:214](src/app/api/projects/[projectId]/route.ts#L214) — 删项目
- [src/app/api/asset-hub/characters/[characterId]/route.ts:113](src/app/api/asset-hub/characters/[characterId]/route.ts#L113) — 删全局角色
- [src/app/api/novel-promotion/[projectId]/character/route.ts:100](src/app/api/novel-promotion/[projectId]/character/route.ts#L100) — 删/改 NovelPromotion 角色

每个调用点紧接着 bailian cleanup 后追加 omnivoice 对称调用,引用扫描范围相同。

### 3.5 多租户隔离

OmniVoice 后端不支持原生 namespace。隔离策略:

- vvicat 内任何「读 OmniVoice profile」的入口都**只通过 GlobalVoice / Character.voiceId 路径**——绝不直接 `listProfiles()` 暴露给前端
- profile name 写入时打 userId 前缀 `vv_<userIdShort>_<originalName>`(8 位即可,仅作为后端调试可读性辅助,不依赖它做隔离)
- 真正的隔离边界是 vvicat 数据库:用户只能看到自己的 GlobalVoice,自然只能看到自己 voiceId 引用的 profile

---

## 4. TTS 生成路径

### 4.1 generate-voice-line.ts 修改

在现有 `if (providerKey === 'fal') ... else if (providerKey === 'bailian') ...` 后追加:

```ts
} else if (providerKey === 'omnivoice') {
  if (!voiceBinding || voiceBinding.provider !== 'omnivoice') {
    throw new Error('请先为该发言人绑定 OmniVoice 音色')
  }
  const result = await synthesizeWithOmnivoiceTTS({
    text,
    profileId: voiceBinding.profileId,
    language: 'Auto',  // 钉死
  })
  if (!result.audioData) {
    throw new Error(result.error || 'OMNIVOICE_TTS_FAILED')
  }
  generated = {
    audioData: result.audioData,
    audioDuration: result.audioDuration ?? getWavDurationFromBuffer(result.audioData),
  }
}
```

### 4.2 synthesizeWithOmnivoiceTTS 实现

`src/lib/providers/omnivoice/tts.ts`:

```ts
export async function synthesizeWithOmnivoiceTTS(params: {
  text: string
  profileId: string
  language?: string
}): Promise<{
  success: boolean
  audioData?: Buffer
  audioDuration?: number
  requestId?: string
  error?: string
}> {
  const ov = getOmnivoiceClient()
  try {
    const r = await ov.design.generateSpeech({
      text: params.text,
      profileId: params.profileId,
      language: params.language ?? 'Auto',
      numStep: 16,
      // 其他参数全用后端默认
    })
    return {
      success: true,
      audioData: Buffer.from(r.audio),
      audioDuration: Math.round(r.audioDurationSec * 1000),
      requestId: r.audioId,
    }
  } catch (err) {
    return mapOmnivoiceError(err)
  }
}
```

`mapOmnivoiceError` 把 `OmniVoiceError`(SDK 已导出)的 `status` + `body.detail` 映射成 vvicat 业务错误码;非 OmniVoiceError 直接抛。

### 4.3 voice-binding 扩展

`src/lib/voice/provider-voice-binding.ts`:

```ts
export type OmnivoiceSpeakerVoiceEntry = {
  provider: 'omnivoice'
  voiceType: string          // 'omnivoice-clone' | 'omnivoice-design'
  profileId: string
  previewAudioUrl?: string
}
export type SpeakerVoiceEntry =
  | FalSpeakerVoiceEntry
  | BailianSpeakerVoiceEntry
  | OmnivoiceSpeakerVoiceEntry

export type OmnivoiceVoiceGenerationBinding = {
  provider: 'omnivoice'
  source: VoiceSource
  profileId: string
}

// resolveVoiceBindingForProvider 中:
if (providerKey === 'omnivoice') {
  // character.voiceType startsWith 'omnivoice-' → character.voiceId 即 profileId
  // 否则看 speakerVoice.provider === 'omnivoice' → speakerVoice.profileId
}
```

`SupportedAudioProviderKey` 增加 `'omnivoice'`。

### 4.4 audio.ts(generators 接口)

`src/lib/providers/omnivoice/audio.ts` 套现有 `OfficialModelModality = 'audio'` 注册体系:

```ts
export async function generateOmnivoiceAudio(params): Promise<GenerateResult> {
  assertRegistered(params.options.modelId)
  const profileId = readTrimmedString(params.voice)
  if (!profileId) throw new Error('OMNIVOICE_PROFILE_ID_REQUIRED')

  const result = await synthesizeWithOmnivoiceTTS({ text, profileId })
  if (!result.success || !result.audioData) {
    throw new Error(result.error || 'OMNIVOICE_AUDIO_SYNTHESIZE_FAILED')
  }
  const dataUrl = `data:audio/wav;base64,${result.audioData.toString('base64')}`
  return { success: true, audioUrl: dataUrl, requestId: result.requestId }
}
```

`catalog.ts` 注册:

```ts
const OMNIVOICE_CATALOG = {
  llm: [],
  image: [],
  video: [],
  audio: ['omnivoice-tts-v1'],
}
```

`omnivoice-tts-v1` 是 vvicat 侧的逻辑 model id,SDK 调用时不需要传(后端用 active engine)。

---

## 5. API Config 与 model registry

### 5.1 OfficialProviderKey 扩展

```ts
export type OfficialProviderKey = 'bailian' | 'siliconflow' | 'starrouter' | 'omnivoice'
```

### 5.2 ProviderConfig 形态(关键决策)

现有 `getProviderConfig(userId, providerId)` 在 [src/lib/api-config.ts:422](src/lib/api-config.ts#L422) 强制要求用户配置 apiKey,空值即抛 `PROVIDER_API_KEY_MISSING`。OmniVoice 是平台托管服务,**不能复用此路径**。

**采取的方案**:OmniVoice 不进入用户 `providers` 配置表,所有 omnivoice 调用通过 `getOmnivoiceClient()` 单例直接读 env。`getProviderConfig` 不动。具体:

- omnivoice 包内自管 baseUrl(env)+ SDK 单例
- 与现有 fal 路径在 [src/lib/voice/generate-voice-line.ts:228](src/lib/voice/generate-voice-line.ts#L228) 调 `getAudioApiKey` 不同——omnivoice 分支不调任何 apiKey 获取函数
- `OfficialProviderKey` 加 `'omnivoice'` 仅用于 `model-registry` 注册维度,不代表 provider 配置可写

### 5.3 用户 UI 暴露

- 角色绑定 / 资源库声音创建,provider 选项里出现「OmniVoice」
- API Config 页面:OmniVoice 列出但仅显示状态(可达 / 不可达,通过 `/health` 探测),**不需要用户填任何凭据**
- 默认音频模型选择:增加 `omnivoice/omnivoice-tts-v1` 选项

### 5.4 计费

- 在 `src/lib/billing/` 的成本表中新增 omnivoice audio 单价(由运营决定,先填占位 — plan 阶段确认是否复用 bailian audio 单价)
- 走现有 `BalanceFreeze → BalanceTransaction` 流程,任务 type 不变,只是 cost 路径分发

---

## 6. UI 触点

### 6.1 VoiceDesignDialogBase

- 增加「provider」下拉(bailian / omnivoice),默认 bailian 保持不变
- voicePrompt / previewText / preferredName 输入框对两个 provider **完全一致**
- 点击「开始设计」时,前端把 provider 写进 task payload,worker 按 payload.provider 分发
- 进度展示沿用现有 `displayMode: 'detail'`

### 6.2 资源库声音上传(Clone)

- 上传音频后弹「克隆为 OmniVoice 音色」按钮(若选了 omnivoice provider)/ 「上传为本地参考音频」(fal)
- omnivoice clone:同步等 profile 创建完成,完成后 GlobalVoice 出现在列表
- 失败提示给到上传按钮的红条

### 6.3 角色音色绑定

- 现有 VoicePickerDialog 列出 GlobalVoice,新增 `omnivoice-clone` / `omnivoice-design` 类型显示徽章
- 选中后写 `character.voiceId = globalVoice.voiceId, character.voiceType = globalVoice.voiceType`
- generate-voice-line 时 voice-binding 自动解析

### 6.4 Episode speakerVoices JSON

`speakerVoices` JSON 增加形状:

```json
{
  "旁白": {
    "provider": "omnivoice",
    "voiceType": "omnivoice-design",
    "profileId": "abc12345",
    "previewAudioUrl": "..."
  }
}
```

`parseSpeakerVoiceMap` 已在 §4.3 扩展。**老数据零迁移**——既有 `provider: 'fal' | 'bailian'` 解析路径不变。

---

## 7. 错误场景与降级

### 7.1 OmniVoice 后端不可达

- vvicat 启动时**不**要求 OmniVoice 在线
- voice line / voice design / clone 任意调用失败 → 抛业务错误 `OMNIVOICE_BACKEND_UNREACHABLE`,UI 提示「OmniVoice 服务暂不可用,请稍后重试或选用其他 provider」
- API Config 页面的健康指示通过 `/health` 探测,失败显示离线但不阻塞其他 provider

### 7.2 OmniVoiceError 映射

| HTTP status | vvicat 错误 | UI 文案 |
|---|---|---|
| 400 | `OMNIVOICE_INVALID_PARAMS` | 「OmniVoice 参数错误: <body.detail>」 |
| 404 (profile 不存在) | `OMNIVOICE_PROFILE_NOT_FOUND` | 「音色不存在,可能已被删除,请重新创建」 |
| 422 | `OMNIVOICE_VALIDATION_FAILED` | 同 400 |
| 500/503 | `OMNIVOICE_BACKEND_ERROR` | 「OmniVoice 后端异常,请稍后重试」 |
| 网络层 | `OMNIVOICE_BACKEND_UNREACHABLE` | 「OmniVoice 服务暂不可用」 |

### 7.3 Profile 漂移

OmniVoice 后端的 SQLite profile 库可能因运维操作丢失/重置,导致 vvicat 这边 voiceId 仍存在但后端 404:

- voice line TTS 时遇 404 → 标 `voiceId is dangling`,vvicat 任务失败,提示用户重建音色
- **不**做自动重建(自动重建需要重新拿到原始参考音频或 vdStates,语义复杂)
- 资源库可加「检测 OmniVoice 音色健康度」的 admin 工具,本期不做(YAGNI)

### 7.4 Profile 删除 vs 引用

`cleanupUnreferencedOmnivoiceVoices` 的引用扫描覆盖:`NovelPromotionCharacter.voiceId`、`GlobalCharacter.voiceId`、`GlobalVoice.voiceId`、`NovelPromotionEpisode.speakerVoices` JSON 内 — 与 bailian 现有 cleanup 完全对齐。

---

## 8. 测试策略

### 8.1 单元测试(`tests/unit/providers/omnivoice/`)

- `voice-binding.test.ts`:`resolveVoiceBindingForProvider({ providerKey: 'omnivoice', ... })` 正确解析 character / speakerVoice 两条路径
- `voice-cleanup.test.ts`:引用计数正确(被引用的 profile 不删,孤儿删)
- `tts.test.ts`:mock `@omnivoice/sdk`,验证参数透传 + 错误映射(覆盖 §7.2 表格的每个 status)

### 8.2 集成测试(`tests/integration/provider/`)

- `omnivoice-clone-flow.test.ts`:mock SDK,跑「上传音频 → createProfile → 写 GlobalVoice → generate-voice-line」全链路
- `omnivoice-design-flow.test.ts`:mock SDK,跑「voice-design worker → createProfile design 模式 → 拉身份采样上传 MinIO → 写 GlobalVoice」

### 8.3 契约测试(`tests/contracts/`)

- 加 `voiceType` 枚举值断言(`qwen-designed`, `custom`, `omnivoice-clone`, `omnivoice-design`)
- 加 `OfficialProviderKey` 枚举值断言

### 8.4 回归测试

- 新增 `tests/regression/omnivoice-binding-mismatch.test.ts`:provider=omnivoice 但 character.voiceType=qwen-designed 时正确报错(避免跨 provider 误调)

### 8.5 不在测试范围

- OmniVoice 后端本身(由 OmniVoice-Studio 项目负责)
- 真实 SDK 网络调用(通过 mock 隔离)

---

## 9. 风险与未来扩展

### 9.1 风险

- **SDK 还未发布到 npm**:本期通过 `file:` 路径引用,要求开发机有 OmniVoice-Studio 同级仓库。CI / Docker 构建需要把 SDK 的 `dist/` 一起 vendor 进 vvicat 仓库或先发布到内网 registry。**plan 阶段需明确这个决定**。
- **后端版本漂移**:OmniVoice v0.3.7 OpenAPI 与 SDK types.ts 锁定,后端升级若改了 schema,SDK 升级前 vvicat 端可能挂掉。缓解:把 SDK 版本钉死,升级 OmniVoice 后端时同步 SDK + vvicat。
- **profile 数据本地化**:OmniVoice profile 存在后端 SQLite,服务器若不做持久化挂载,容器重启会丢数据。**部署文档必须明确挂载 `omnivoice_data/`**。

### 9.2 未来扩展(本期不做)

- OmniVoice dub 视频配音管线 → 单独的 design + plan
- vdStates 结构化表单(Gender/Age/Pitch/Accent)→ 当用户反馈 voicePrompt 不够精细时再加
- 多 OmniVoice 后端 routing(用户自带 baseUrl)→ 等用户实际诉求出现
- 健康巡检 / 漂移检测 admin 工具

---

## 10. 实施顺序建议

1. SDK build & 引入(file: 路径,先打通 import)
2. `src/lib/providers/omnivoice/` 包(client.ts → tts.ts → voice-design.ts → voice-clone.ts → voice-manage.ts → voice-cleanup.ts → audio.ts → catalog.ts → index.ts)
3. provider-voice-binding.ts 扩展 + 单测
4. generate-voice-line.ts 加 omnivoice 分支 + 单测
5. voice-design worker handler 分发 + 集成测试
6. API Config / OfficialProviderKey / model registry 注册
7. UI 触点(VoiceDesignDialogBase 增加 provider 下拉 → 资源库 clone 按钮 → 角色绑定 voiceType 显示)
8. 计费占位 + 部署文档(env + 后端持久化)
9. 契约 / 回归测试
10. `npm run verify:push` 全套通过

---

## 11. 验收标准

- [ ] 用户可在资源库通过 OmniVoice provider 上传音频克隆出音色,GlobalVoice 写入正确,voiceId 是 OmniVoice profile id
- [ ] 用户可通过 voicePrompt 用 OmniVoice 设计音色,完成后能在资源库看到带身份采样预览的条目
- [ ] 角色 / speaker 绑定 OmniVoice 音色后,voice line 生成产出 WAV 写 MinIO,duration 正确
- [ ] 删除被引用的 OmniVoice 音色被拒绝;删除孤儿音色同步删后端 profile
- [ ] OmniVoice 后端离线时,其他 provider(fal/bailian)的 voice line 完全不受影响
- [ ] `npm run verify:push` 通过,新增测试均通过
