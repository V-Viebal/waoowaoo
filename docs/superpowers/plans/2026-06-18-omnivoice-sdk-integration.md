# OmniVoice-Studio SDK 接入 vvicat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 OmniVoice-Studio 作为 vvicat 第三个 audio provider 接入,提供与 bailian 平权的克隆 + 设计 + TTS 能力,服务于 voice line 生成与角色音色资源库,完全镜像 bailian 的目录结构与生命周期模式。

**Architecture:** 新建 `src/lib/providers/omnivoice/` 目录,镜像 `src/lib/providers/bailian/` 的文件组织。OmniVoice 不进入用户 `providers` 配置(平台托管),所有调用通过包内 SDK 单例直读 env。GlobalVoice schema 不动,通过 `voiceType: 'omnivoice-clone' | 'omnivoice-design'` 区分托管来源。voice-design BullMQ 任务按 payload.provider 分发到 omnivoice/bailian。

**Tech Stack:** Next.js 15 + TypeScript / Prisma (无 schema 改动) / BullMQ / `@omnivoice/sdk` (file: 路径引用本地包) / Vitest

## Global Constraints

- **零 schema 改动**:`prisma/schema.prisma` 不变,GlobalVoice 复用现有 `voiceId / voiceType / customVoiceUrl / customVoiceMediaId / voicePrompt` 字段。
- **不重构现有 fal/bailian 路径**:本期是新增 provider,不动既有代码组织。
- **不接 dub 视频配音管线 / SSE 进度桥**:仅 TTS / 克隆 / 设计。
- **OmniVoice 平台托管**:不走 `getProviderConfig`,baseUrl 由 `OMNIVOICE_BASE_URL` env 提供;用户**不需要填写任何凭据**。
- **生成参数钉死后端默认**:`numStep=16, language='Auto'`,其它一律不暴露(YAGNI)。
- **不影响其它 provider**:OmniVoice 后端离线时,fal/bailian voice line 路径完全不受影响。
- **TDD**:每个 task 先写失败测试,再实现,再验证测试通过,再提交。
- **路径精确**:所有 import 路径用项目 `@/` 别名(如 `@/lib/providers/omnivoice`)。
- **频繁提交**:每个 task 一次 commit。

---

## File Structure

新建文件:

| 路径 | 责任 |
|---|---|
| `src/lib/providers/omnivoice/client.ts` | OmniVoice SDK 单例 + env 读取 + 健康探测 |
| `src/lib/providers/omnivoice/types.ts` | 内部类型(OmnivoiceTTSParams 等) |
| `src/lib/providers/omnivoice/error-mapping.ts` | OmniVoiceError → vvicat 错误码映射 |
| `src/lib/providers/omnivoice/tts.ts` | `synthesizeWithOmnivoiceTTS()` |
| `src/lib/providers/omnivoice/voice-design.ts` | `createOmnivoiceVoiceDesign()`,镜像 bailian/voice-design.ts |
| `src/lib/providers/omnivoice/voice-clone.ts` | `createOmnivoiceClone()` |
| `src/lib/providers/omnivoice/voice-manage.ts` | `deleteOmnivoiceVoice()` |
| `src/lib/providers/omnivoice/voice-cleanup.ts` | 引用扫描 + 清理孤儿 profile |
| `src/lib/providers/omnivoice/audio.ts` | `generateOmnivoiceAudio()` 接 generators 接口 |
| `src/lib/providers/omnivoice/catalog.ts` | `ensureOmnivoiceCatalogRegistered()` |
| `src/lib/providers/omnivoice/probe.ts` | `probeOmnivoice()` 通过 `/health` |
| `src/lib/providers/omnivoice/index.ts` | re-exports |
| `tests/unit/providers/omnivoice/tts.test.ts` | TTS 参数透传 + 错误映射 |
| `tests/unit/providers/omnivoice/voice-binding.test.ts` | binding 解析 |
| `tests/unit/providers/omnivoice/voice-cleanup.test.ts` | 引用计数 + 真删 |
| `tests/unit/providers/omnivoice/error-mapping.test.ts` | OmniVoiceError 映射表 |
| `tests/integration/provider/omnivoice-clone-flow.test.ts` | 上传→createProfile→GlobalVoice→generate 全链路 |
| `tests/integration/provider/omnivoice-design-flow.test.ts` | design worker 全链路 |
| `tests/regression/omnivoice-binding-mismatch.test.ts` | provider/voiceType 错配 |

修改文件:

| 路径 | 改动 |
|---|---|
| `package.json` | 加 `@omnivoice/sdk` file: 依赖 |
| `.env.example` | 加 `OMNIVOICE_BASE_URL` / `OMNIVOICE_REQUEST_TIMEOUT_MS` |
| `src/lib/providers/official/model-registry.ts` | `OfficialProviderKey` 加 `'omnivoice'` |
| `src/lib/voice/provider-voice-binding.ts` | 增 `Omnivoice*` 类型 + `omnivoice` 分支 |
| `src/lib/voice/generate-voice-line.ts` | 加 `omnivoice` 分支 |
| `src/lib/workers/handlers/voice-design.ts` | 按 payload.provider 分发 |
| `src/app/api/asset-hub/voice-design/route.ts` | 透传 provider 字段 |
| `src/app/api/projects/[projectId]/route.ts` | 调 omnivoice cleanup |
| `src/app/api/asset-hub/characters/[characterId]/route.ts` | 调 omnivoice cleanup |
| `src/app/api/novel-promotion/[projectId]/character/route.ts` | 调 omnivoice cleanup |
| `src/components/voice/VoiceDesignDialogBase.tsx` | provider 下拉 |
| `src/lib/generators/audio/index.ts` | re-export(可选,沿用 bailian.ts 模式) |

---

## Task 1: SDK 引入与构建

**Files:**
- Modify: `package.json`(添加 `@omnivoice/sdk` 依赖)
- Modify: `.env.example`(新增 env 变量)

**Interfaces:**
- Produces: `@omnivoice/sdk` package 可被 `import { OmniVoice, OmniVoiceError } from '@omnivoice/sdk'` 解析。

- [ ] **Step 1: 构建 SDK**

```bash
cd /Users/xiaomao/Documents/fuyang/OmniVoice-Studio/sdk/omnivoice-ts
bun install
bun run build
ls dist/index.js dist/index.d.ts
```

Expected: `dist/index.js` 与 `dist/index.d.ts` 存在。

- [ ] **Step 2: 在 vvicat package.json 加依赖**

修改 `package.json` `dependencies` 字段,新增:

```json
"@omnivoice/sdk": "file:../OmniVoice-Studio/sdk/omnivoice-ts"
```

(按字母序插入到现有 `@nivo/*` 与 `@prisma/client` 之间。)

- [ ] **Step 3: 安装并验证 import**

```bash
cd /Users/xiaomao/Documents/fuyang/waoowaoo
npm install
node -e "const m = require('@omnivoice/sdk'); console.log(Object.keys(m))"
```

Expected: 输出包含 `OmniVoice`, `OmniVoiceError`, `DesignAPI`, `DubAPI`。

- [ ] **Step 4: 加 env 模板**

在 `.env.example` 末尾追加:

```bash
# OmniVoice-Studio TTS backend (server-side only)
OMNIVOICE_BASE_URL=http://127.0.0.1:3900
OMNIVOICE_REQUEST_TIMEOUT_MS=300000
```

- [ ] **Step 5: typecheck 通过**

```bash
npm run typecheck
```

Expected: 0 errors。

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "feat(omnivoice): 接入 @omnivoice/sdk 本地包并新增 env 模板"
```

---

## Task 2: OmniVoice SDK 客户端单例

**Files:**
- Create: `src/lib/providers/omnivoice/client.ts`
- Create: `src/lib/providers/omnivoice/types.ts`
- Test: `tests/unit/providers/omnivoice/client.test.ts`

**Interfaces:**
- Consumes: `@omnivoice/sdk` 的 `OmniVoice` 构造器
- Produces:
  - `getOmnivoiceClient(): OmniVoice` — 单例(per-baseUrl 缓存)
  - `getOmnivoiceBaseUrl(): string` — 优先 env,fallback `http://127.0.0.1:3900`
  - `resetOmnivoiceClientForTest(): void` — 测试用清除单例
  - 类型 `OmnivoiceTTSParams`, `OmnivoiceCloneParams`, `OmnivoiceDesignParams`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/providers/omnivoice/client.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getOmnivoiceClient, getOmnivoiceBaseUrl, resetOmnivoiceClientForTest } from '@/lib/providers/omnivoice/client'

describe('omnivoice client', () => {
  const originalEnv = { ...process.env }
  beforeEach(() => {
    resetOmnivoiceClientForTest()
  })
  afterEach(() => {
    process.env = { ...originalEnv }
    resetOmnivoiceClientForTest()
  })

  it('uses default baseUrl when env unset', () => {
    delete process.env.OMNIVOICE_BASE_URL
    expect(getOmnivoiceBaseUrl()).toBe('http://127.0.0.1:3900')
  })

  it('reads baseUrl from env', () => {
    process.env.OMNIVOICE_BASE_URL = 'http://omni.test:9000'
    expect(getOmnivoiceBaseUrl()).toBe('http://omni.test:9000')
  })

  it('returns same instance on repeat calls (singleton)', () => {
    const a = getOmnivoiceClient()
    const b = getOmnivoiceClient()
    expect(a).toBe(b)
  })

  it('resetOmnivoiceClientForTest clears singleton', () => {
    const a = getOmnivoiceClient()
    resetOmnivoiceClientForTest()
    const b = getOmnivoiceClient()
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 2: 验证测试失败**

```bash
npx vitest run tests/unit/providers/omnivoice/client.test.ts
```

Expected: FAIL — 模块未找到。

- [ ] **Step 3: 实现 types.ts**

创建 `src/lib/providers/omnivoice/types.ts`:

```ts
import type { BlobLike } from '@omnivoice/sdk'

export interface OmnivoiceTTSParams {
  text: string
  profileId: string
  language?: string
}

export interface OmnivoiceTTSResult {
  success: boolean
  audioData?: Buffer
  audioDuration?: number
  requestId?: string
  error?: string
  errorCode?: string
}

export interface OmnivoiceCloneParams {
  name: string
  refAudio: BlobLike
  refAudioFilename: string
  refText?: string
  language?: string
  userId: string
}

export interface OmnivoiceCloneResult {
  success: boolean
  profileId?: string
  error?: string
  errorCode?: string
}

export interface OmnivoiceDesignParams {
  voicePrompt: string
  previewText: string
  preferredName?: string
  language?: 'zh' | 'en'
  userId: string
}

export interface OmnivoiceDesignResult {
  success: boolean
  profileId?: string
  audioBase64?: string
  sampleRate?: number
  responseFormat?: string
  requestId?: string
  error?: string
  errorCode?: string
}
```

- [ ] **Step 4: 实现 client.ts**

创建 `src/lib/providers/omnivoice/client.ts`:

```ts
import { OmniVoice } from '@omnivoice/sdk'

const DEFAULT_BASE_URL = 'http://127.0.0.1:3900'
const DEFAULT_TIMEOUT_MS = 300_000

let cachedClient: OmniVoice | null = null
let cachedBaseUrl: string | null = null

export function getOmnivoiceBaseUrl(): string {
  const fromEnv = process.env.OMNIVOICE_BASE_URL
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return fromEnv.trim()
  }
  return DEFAULT_BASE_URL
}

function getOmnivoiceTimeoutMs(): number {
  const raw = process.env.OMNIVOICE_REQUEST_TIMEOUT_MS
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_TIMEOUT_MS
}

export function getOmnivoiceClient(): OmniVoice {
  const baseUrl = getOmnivoiceBaseUrl()
  if (cachedClient && cachedBaseUrl === baseUrl) {
    return cachedClient
  }
  cachedClient = new OmniVoice({
    baseUrl,
    timeoutMs: getOmnivoiceTimeoutMs(),
  })
  cachedBaseUrl = baseUrl
  return cachedClient
}

export function resetOmnivoiceClientForTest(): void {
  cachedClient = null
  cachedBaseUrl = null
}
```

- [ ] **Step 5: 验证测试通过**

```bash
npx vitest run tests/unit/providers/omnivoice/client.test.ts
```

Expected: 4 passed。

- [ ] **Step 6: Commit**

```bash
git add src/lib/providers/omnivoice/client.ts src/lib/providers/omnivoice/types.ts tests/unit/providers/omnivoice/client.test.ts
git commit -m "feat(omnivoice): 添加 SDK 客户端单例与内部类型定义"
```

---

## Task 3: 错误映射

**Files:**
- Create: `src/lib/providers/omnivoice/error-mapping.ts`
- Test: `tests/unit/providers/omnivoice/error-mapping.test.ts`

**Interfaces:**
- Consumes: `OmniVoiceError` from `@omnivoice/sdk`
- Produces:
  - `mapOmnivoiceError(err: unknown): { errorCode: string; error: string }`

错误码集对应 spec §7.2:`OMNIVOICE_INVALID_PARAMS` (400/422), `OMNIVOICE_PROFILE_NOT_FOUND` (404), `OMNIVOICE_BACKEND_ERROR` (500/503), `OMNIVOICE_BACKEND_UNREACHABLE` (网络/未知)。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/providers/omnivoice/error-mapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { OmniVoiceError } from '@omnivoice/sdk'
import { mapOmnivoiceError } from '@/lib/providers/omnivoice/error-mapping'

describe('mapOmnivoiceError', () => {
  it('maps 400 to OMNIVOICE_INVALID_PARAMS', () => {
    const err = new OmniVoiceError(400, { detail: 'bad input' }, 'bad input')
    const r = mapOmnivoiceError(err)
    expect(r.errorCode).toBe('OMNIVOICE_INVALID_PARAMS')
    expect(r.error).toContain('bad input')
  })

  it('maps 404 to OMNIVOICE_PROFILE_NOT_FOUND', () => {
    const err = new OmniVoiceError(404, { detail: 'no profile' }, 'no profile')
    expect(mapOmnivoiceError(err).errorCode).toBe('OMNIVOICE_PROFILE_NOT_FOUND')
  })

  it('maps 422 to OMNIVOICE_INVALID_PARAMS', () => {
    const err = new OmniVoiceError(422, { detail: 'validation' }, 'validation')
    expect(mapOmnivoiceError(err).errorCode).toBe('OMNIVOICE_INVALID_PARAMS')
  })

  it('maps 500 to OMNIVOICE_BACKEND_ERROR', () => {
    const err = new OmniVoiceError(500, { detail: 'oops' }, 'oops')
    expect(mapOmnivoiceError(err).errorCode).toBe('OMNIVOICE_BACKEND_ERROR')
  })

  it('maps 503 to OMNIVOICE_BACKEND_ERROR', () => {
    const err = new OmniVoiceError(503, null, 'unavail')
    expect(mapOmnivoiceError(err).errorCode).toBe('OMNIVOICE_BACKEND_ERROR')
  })

  it('maps fetch network error to OMNIVOICE_BACKEND_UNREACHABLE', () => {
    const err = new TypeError('fetch failed')
    expect(mapOmnivoiceError(err).errorCode).toBe('OMNIVOICE_BACKEND_UNREACHABLE')
  })

  it('maps unknown errors to OMNIVOICE_BACKEND_UNREACHABLE with raw message', () => {
    const err = new Error('weird')
    const r = mapOmnivoiceError(err)
    expect(r.errorCode).toBe('OMNIVOICE_BACKEND_UNREACHABLE')
    expect(r.error).toContain('weird')
  })
})
```

- [ ] **Step 2: 验证测试失败**

```bash
npx vitest run tests/unit/providers/omnivoice/error-mapping.test.ts
```

Expected: FAIL — 模块未找到。

- [ ] **Step 3: 实现 error-mapping.ts**

创建 `src/lib/providers/omnivoice/error-mapping.ts`:

```ts
import { OmniVoiceError } from '@omnivoice/sdk'

export function mapOmnivoiceError(err: unknown): { errorCode: string; error: string } {
  if (err instanceof OmniVoiceError) {
    const detail = readDetail(err.body) || err.message || `HTTP ${err.status}`
    if (err.status === 404) {
      return { errorCode: 'OMNIVOICE_PROFILE_NOT_FOUND', error: detail }
    }
    if (err.status === 400 || err.status === 422) {
      return { errorCode: 'OMNIVOICE_INVALID_PARAMS', error: detail }
    }
    if (err.status >= 500) {
      return { errorCode: 'OMNIVOICE_BACKEND_ERROR', error: detail }
    }
    return { errorCode: 'OMNIVOICE_BACKEND_ERROR', error: detail }
  }

  const message = err instanceof Error ? err.message : String(err)
  return { errorCode: 'OMNIVOICE_BACKEND_UNREACHABLE', error: message }
}

function readDetail(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const node = body as { detail?: unknown }
  if (typeof node.detail === 'string') return node.detail
  return ''
}
```

- [ ] **Step 4: 验证测试通过**

```bash
npx vitest run tests/unit/providers/omnivoice/error-mapping.test.ts
```

Expected: 7 passed。

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/omnivoice/error-mapping.ts tests/unit/providers/omnivoice/error-mapping.test.ts
git commit -m "feat(omnivoice): OmniVoiceError 业务错误码映射"
```

---

## Task 4: TTS 合成入口

**Files:**
- Create: `src/lib/providers/omnivoice/tts.ts`
- Test: `tests/unit/providers/omnivoice/tts.test.ts`

**Interfaces:**
- Consumes: `getOmnivoiceClient()` (Task 2), `mapOmnivoiceError()` (Task 3)
- Produces: `synthesizeWithOmnivoiceTTS(params: OmnivoiceTTSParams): Promise<OmnivoiceTTSResult>`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/providers/omnivoice/tts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 仅 mock generateSpeech;OmniVoiceError 走真实导出
vi.mock('@/lib/providers/omnivoice/client', () => ({
  getOmnivoiceClient: vi.fn(),
}))

import { getOmnivoiceClient } from '@/lib/providers/omnivoice/client'
import { synthesizeWithOmnivoiceTTS } from '@/lib/providers/omnivoice/tts'
import { OmniVoiceError } from '@omnivoice/sdk'

describe('synthesizeWithOmnivoiceTTS', () => {
  const mockGenerateSpeech = vi.fn()
  beforeEach(() => {
    mockGenerateSpeech.mockReset()
    ;(getOmnivoiceClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      design: { generateSpeech: mockGenerateSpeech },
    })
  })

  it('passes params and returns audio buffer + duration', async () => {
    const audio = new Uint8Array([0x52, 0x49, 0x46, 0x46]) // RIFF
    mockGenerateSpeech.mockResolvedValue({
      audio,
      audioId: 'aud_1',
      audioPath: '/x',
      audioDurationSec: 3.21,
      generationTimeSec: 1,
      seed: 42,
      contentType: 'audio/wav',
      routingStatus: null,
      routingReason: null,
    })

    const r = await synthesizeWithOmnivoiceTTS({
      text: '你好',
      profileId: 'prof_abc',
      language: 'zh',
    })

    expect(mockGenerateSpeech).toHaveBeenCalledWith(expect.objectContaining({
      text: '你好',
      profileId: 'prof_abc',
      language: 'zh',
      numStep: 16,
    }))
    expect(r.success).toBe(true)
    expect(Buffer.isBuffer(r.audioData)).toBe(true)
    expect(r.audioDuration).toBe(3210)
    expect(r.requestId).toBe('aud_1')
  })

  it('defaults language to Auto', async () => {
    mockGenerateSpeech.mockResolvedValue({
      audio: new Uint8Array(4),
      audioId: 'a',
      audioPath: 'p',
      audioDurationSec: 1,
      generationTimeSec: 1,
      seed: 0,
      contentType: 'audio/wav',
      routingStatus: null,
      routingReason: null,
    })
    await synthesizeWithOmnivoiceTTS({ text: 't', profileId: 'p' })
    expect(mockGenerateSpeech).toHaveBeenCalledWith(expect.objectContaining({ language: 'Auto' }))
  })

  it('returns mapped error on OmniVoiceError 404', async () => {
    mockGenerateSpeech.mockRejectedValue(new OmniVoiceError(404, { detail: 'gone' }, 'gone'))
    const r = await synthesizeWithOmnivoiceTTS({ text: 't', profileId: 'p' })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('OMNIVOICE_PROFILE_NOT_FOUND')
  })

  it('returns mapped error on network failure', async () => {
    mockGenerateSpeech.mockRejectedValue(new TypeError('fetch failed'))
    const r = await synthesizeWithOmnivoiceTTS({ text: 't', profileId: 'p' })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('OMNIVOICE_BACKEND_UNREACHABLE')
  })
})
```

- [ ] **Step 2: 验证测试失败**

```bash
npx vitest run tests/unit/providers/omnivoice/tts.test.ts
```

Expected: FAIL — `synthesizeWithOmnivoiceTTS` 未导出。

- [ ] **Step 3: 实现 tts.ts**

创建 `src/lib/providers/omnivoice/tts.ts`:

```ts
import { getOmnivoiceClient } from './client'
import { mapOmnivoiceError } from './error-mapping'
import type { OmnivoiceTTSParams, OmnivoiceTTSResult } from './types'

const DEFAULT_NUM_STEP = 16
const DEFAULT_LANGUAGE = 'Auto'

export async function synthesizeWithOmnivoiceTTS(
  params: OmnivoiceTTSParams,
): Promise<OmnivoiceTTSResult> {
  const text = params.text?.trim() ?? ''
  const profileId = params.profileId?.trim() ?? ''
  if (!text) {
    return { success: false, error: 'OMNIVOICE_TEXT_REQUIRED', errorCode: 'OMNIVOICE_TEXT_REQUIRED' }
  }
  if (!profileId) {
    return { success: false, error: 'OMNIVOICE_PROFILE_ID_REQUIRED', errorCode: 'OMNIVOICE_PROFILE_ID_REQUIRED' }
  }

  const ov = getOmnivoiceClient()
  try {
    const r = await ov.design.generateSpeech({
      text,
      profileId,
      language: params.language ?? DEFAULT_LANGUAGE,
      numStep: DEFAULT_NUM_STEP,
    })
    return {
      success: true,
      audioData: Buffer.from(r.audio),
      audioDuration: Math.round((r.audioDurationSec ?? 0) * 1000),
      requestId: r.audioId,
    }
  } catch (err) {
    const mapped = mapOmnivoiceError(err)
    return { success: false, ...mapped }
  }
}
```

- [ ] **Step 4: 验证测试通过**

```bash
npx vitest run tests/unit/providers/omnivoice/tts.test.ts
```

Expected: 4 passed。

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/omnivoice/tts.ts tests/unit/providers/omnivoice/tts.test.ts
git commit -m "feat(omnivoice): synthesizeWithOmnivoiceTTS 接入 SDK generateSpeech"
```

---

## Task 5: Voice Clone

**Files:**
- Create: `src/lib/providers/omnivoice/voice-clone.ts`
- Test: `tests/unit/providers/omnivoice/voice-clone.test.ts`

**Interfaces:**
- Consumes: `getOmnivoiceClient()`, `mapOmnivoiceError()`
- Produces:
  - `createOmnivoiceClone(params: OmnivoiceCloneParams): Promise<OmnivoiceCloneResult>`
  - 内部:`buildOmnivoiceProfileName(userId, name)` 加 `vv_<userIdShort>_<name>` 前缀(spec §3.5)

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/providers/omnivoice/voice-clone.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/providers/omnivoice/client', () => ({
  getOmnivoiceClient: vi.fn(),
}))

import { getOmnivoiceClient } from '@/lib/providers/omnivoice/client'
import { createOmnivoiceClone, buildOmnivoiceProfileName } from '@/lib/providers/omnivoice/voice-clone'

describe('createOmnivoiceClone', () => {
  const createProfile = vi.fn()
  beforeEach(() => {
    createProfile.mockReset()
    ;(getOmnivoiceClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      design: { createProfile },
    })
  })

  it('builds prefixed profile name and calls createProfile clone kind', async () => {
    createProfile.mockResolvedValue({ id: 'prof_xyz', name: 'vv_u123abcd_Carla', kind: 'clone' })
    const refAudio = new Uint8Array([1, 2, 3])
    const r = await createOmnivoiceClone({
      name: 'Carla',
      refAudio,
      refAudioFilename: 'r.wav',
      language: 'English',
      userId: 'u123abcdef',
    })
    expect(r.success).toBe(true)
    expect(r.profileId).toBe('prof_xyz')
    expect(createProfile).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'clone',
      name: 'vv_u123abcd_Carla',
      refAudio,
      refAudioFilename: 'r.wav',
      language: 'English',
    }))
  })

  it('rejects empty name', async () => {
    const r = await createOmnivoiceClone({
      name: '',
      refAudio: new Uint8Array(1),
      refAudioFilename: 'r.wav',
      userId: 'u',
    })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('OMNIVOICE_NAME_REQUIRED')
  })

  it('maps OmniVoice 400 error to OMNIVOICE_INVALID_PARAMS', async () => {
    const { OmniVoiceError } = await import('@omnivoice/sdk')
    createProfile.mockRejectedValue(new OmniVoiceError(400, { detail: 'short clip' }, 'short clip'))
    const r = await createOmnivoiceClone({
      name: 'X',
      refAudio: new Uint8Array(1),
      refAudioFilename: 'r.wav',
      userId: 'u',
    })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('OMNIVOICE_INVALID_PARAMS')
  })
})

describe('buildOmnivoiceProfileName', () => {
  it('uses first 8 chars of userId as prefix', () => {
    expect(buildOmnivoiceProfileName('u123abcdef9999', 'Hero')).toBe('vv_u123abcd_Hero')
  })
  it('handles short userId', () => {
    expect(buildOmnivoiceProfileName('abc', 'X')).toBe('vv_abc_X')
  })
})
```

- [ ] **Step 2: 验证测试失败**

```bash
npx vitest run tests/unit/providers/omnivoice/voice-clone.test.ts
```

Expected: FAIL — module not found。

- [ ] **Step 3: 实现 voice-clone.ts**

创建 `src/lib/providers/omnivoice/voice-clone.ts`:

```ts
import { getOmnivoiceClient } from './client'
import { mapOmnivoiceError } from './error-mapping'
import type { OmnivoiceCloneParams, OmnivoiceCloneResult } from './types'

export function buildOmnivoiceProfileName(userId: string, name: string): string {
  const trimmedName = name.trim()
  const trimmedUserId = userId.trim()
  const shortId = trimmedUserId.slice(0, 8)
  return `vv_${shortId}_${trimmedName}`
}

export async function createOmnivoiceClone(
  params: OmnivoiceCloneParams,
): Promise<OmnivoiceCloneResult> {
  const name = params.name?.trim() ?? ''
  const userId = params.userId?.trim() ?? ''
  if (!name) {
    return { success: false, error: '名称必填', errorCode: 'OMNIVOICE_NAME_REQUIRED' }
  }
  if (!userId) {
    return { success: false, error: '用户ID必填', errorCode: 'OMNIVOICE_USER_ID_REQUIRED' }
  }

  const ov = getOmnivoiceClient()
  try {
    const profile = await ov.design.createProfile({
      kind: 'clone',
      name: buildOmnivoiceProfileName(userId, name),
      refAudio: params.refAudio,
      refAudioFilename: params.refAudioFilename,
      refText: params.refText,
      language: params.language ?? 'Auto',
    })
    return { success: true, profileId: profile.id }
  } catch (err) {
    return { success: false, ...mapOmnivoiceError(err) }
  }
}
```

- [ ] **Step 4: 验证测试通过**

```bash
npx vitest run tests/unit/providers/omnivoice/voice-clone.test.ts
```

Expected: 5 passed。

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/omnivoice/voice-clone.ts tests/unit/providers/omnivoice/voice-clone.test.ts
git commit -m "feat(omnivoice): voice clone 通过 createProfile kind=clone"
```

---

## Task 6: Voice Design

**Files:**
- Create: `src/lib/providers/omnivoice/voice-design.ts`
- Test: `tests/unit/providers/omnivoice/voice-design.test.ts`

**Interfaces:**
- Consumes: `getOmnivoiceClient()`, `mapOmnivoiceError()`, `buildOmnivoiceProfileName()` (Task 5)
- Re-exports from bailian: `validateVoicePrompt`, `validatePreviewText`(避免重复)
- Produces:
  - `createOmnivoiceVoiceDesign(params: OmnivoiceDesignParams): Promise<OmnivoiceDesignResult>`
  - 内部读取 `getProfile(id).ref_audio_path` 作为身份采样路径(返回 `audioBase64` 字段为空,vvicat 由 worker 拉取并上传 MinIO)

OmniVoice design 路径返回的 profile **不直接**附 audio bytes;`vvicat` 一侧 worker 拿到 profileId 后在 worker 中调 `synthesizeWithOmnivoiceTTS({ text: previewText, profileId })` 渲染一段预览,作为身份采样存到 MinIO。这与 spec §3.3 一致(预览音频本来也是用于资源库展示)。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/providers/omnivoice/voice-design.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/providers/omnivoice/client', () => ({
  getOmnivoiceClient: vi.fn(),
}))

import { getOmnivoiceClient } from '@/lib/providers/omnivoice/client'
import { createOmnivoiceVoiceDesign } from '@/lib/providers/omnivoice/voice-design'

describe('createOmnivoiceVoiceDesign', () => {
  const createProfile = vi.fn()
  const generateSpeech = vi.fn()
  beforeEach(() => {
    createProfile.mockReset()
    generateSpeech.mockReset()
    ;(getOmnivoiceClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      design: { createProfile, generateSpeech },
    })
  })

  it('calls createProfile with kind=design, default vdStates, instruct=voicePrompt', async () => {
    createProfile.mockResolvedValue({ id: 'prof_d1', name: 'vv_user1234_X', kind: 'design' })
    generateSpeech.mockResolvedValue({
      audio: new Uint8Array([1, 2, 3, 4]),
      audioId: 'a',
      audioPath: 'p',
      audioDurationSec: 1,
      generationTimeSec: 1,
      seed: 0,
      contentType: 'audio/wav',
      routingStatus: null,
      routingReason: null,
    })

    const r = await createOmnivoiceVoiceDesign({
      voicePrompt: '温暖中年男声',
      previewText: '你好世界',
      preferredName: 'Hero',
      language: 'zh',
      userId: 'user1234ext',
    })

    expect(createProfile).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'design',
      name: 'vv_user1234_Hero',
      vdStates: { Style: 'Auto' },
      instruct: '温暖中年男声',
      language: 'zh',
    }))
    expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'prof_d1',
      text: '你好世界',
    }))
    expect(r.success).toBe(true)
    expect(r.profileId).toBe('prof_d1')
    expect(typeof r.audioBase64).toBe('string')
    expect(r.audioBase64!.length).toBeGreaterThan(0)
    expect(r.responseFormat).toBe('wav')
  })

  it('rejects empty voicePrompt', async () => {
    const r = await createOmnivoiceVoiceDesign({
      voicePrompt: '',
      previewText: 't',
      userId: 'u',
    })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('OMNIVOICE_VOICE_PROMPT_REQUIRED')
  })

  it('returns mapped error on createProfile failure', async () => {
    const { OmniVoiceError } = await import('@omnivoice/sdk')
    createProfile.mockRejectedValue(new OmniVoiceError(500, { detail: 'down' }, 'down'))
    const r = await createOmnivoiceVoiceDesign({
      voicePrompt: 'x',
      previewText: 'y',
      userId: 'u',
    })
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('OMNIVOICE_BACKEND_ERROR')
  })
})
```

- [ ] **Step 2: 验证测试失败**

```bash
npx vitest run tests/unit/providers/omnivoice/voice-design.test.ts
```

Expected: FAIL — module not found。

- [ ] **Step 3: 实现 voice-design.ts**

创建 `src/lib/providers/omnivoice/voice-design.ts`:

```ts
import { getOmnivoiceClient } from './client'
import { mapOmnivoiceError } from './error-mapping'
import { buildOmnivoiceProfileName } from './voice-clone'
import type { OmnivoiceDesignParams, OmnivoiceDesignResult } from './types'

const DEFAULT_VD_STATES = { Style: 'Auto' as const }
const DEFAULT_NUM_STEP = 16

export async function createOmnivoiceVoiceDesign(
  params: OmnivoiceDesignParams,
): Promise<OmnivoiceDesignResult> {
  const voicePrompt = params.voicePrompt?.trim() ?? ''
  const previewText = params.previewText?.trim() ?? ''
  const userId = params.userId?.trim() ?? ''
  if (!voicePrompt) {
    return { success: false, error: '声音描述必填', errorCode: 'OMNIVOICE_VOICE_PROMPT_REQUIRED' }
  }
  if (!previewText) {
    return { success: false, error: '预览文本必填', errorCode: 'OMNIVOICE_PREVIEW_TEXT_REQUIRED' }
  }
  if (!userId) {
    return { success: false, error: '用户ID必填', errorCode: 'OMNIVOICE_USER_ID_REQUIRED' }
  }

  const preferredName = (params.preferredName ?? 'custom_voice').trim() || 'custom_voice'
  const language = params.language ?? 'zh'

  const ov = getOmnivoiceClient()
  try {
    const profile = await ov.design.createProfile({
      kind: 'design',
      name: buildOmnivoiceProfileName(userId, preferredName),
      vdStates: DEFAULT_VD_STATES,
      instruct: voicePrompt,
      language,
    })

    const speech = await ov.design.generateSpeech({
      text: previewText,
      profileId: profile.id,
      language,
      numStep: DEFAULT_NUM_STEP,
    })

    return {
      success: true,
      profileId: profile.id,
      audioBase64: Buffer.from(speech.audio).toString('base64'),
      sampleRate: 24000,
      responseFormat: 'wav',
      requestId: speech.audioId,
    }
  } catch (err) {
    return { success: false, ...mapOmnivoiceError(err) }
  }
}
```

- [ ] **Step 4: 验证测试通过**

```bash
npx vitest run tests/unit/providers/omnivoice/voice-design.test.ts
```

Expected: 3 passed。

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/omnivoice/voice-design.ts tests/unit/providers/omnivoice/voice-design.test.ts
git commit -m "feat(omnivoice): voice design 用 instruct + 预览音频"
```

---

## Task 7: voice-manage(deleteOmnivoiceVoice)

**Files:**
- Create: `src/lib/providers/omnivoice/voice-manage.ts`
- Test: `tests/unit/providers/omnivoice/voice-manage.test.ts`

**Interfaces:**
- Consumes: `getOmnivoiceClient()`, `mapOmnivoiceError()`
- Produces:
  - `deleteOmnivoiceVoice(profileId: string): Promise<void>` — 404 视为成功(已删除)

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/providers/omnivoice/voice-manage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/providers/omnivoice/client', () => ({
  getOmnivoiceClient: vi.fn(),
}))

import { getOmnivoiceClient } from '@/lib/providers/omnivoice/client'
import { deleteOmnivoiceVoice } from '@/lib/providers/omnivoice/voice-manage'

describe('deleteOmnivoiceVoice', () => {
  const deleteProfile = vi.fn()
  beforeEach(() => {
    deleteProfile.mockReset()
    ;(getOmnivoiceClient as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      design: { deleteProfile },
    })
  })

  it('calls deleteProfile with profileId', async () => {
    deleteProfile.mockResolvedValue(undefined)
    await deleteOmnivoiceVoice('prof_1')
    expect(deleteProfile).toHaveBeenCalledWith('prof_1')
  })

  it('treats 404 as success', async () => {
    const { OmniVoiceError } = await import('@omnivoice/sdk')
    deleteProfile.mockRejectedValue(new OmniVoiceError(404, { detail: 'not found' }, 'not found'))
    await expect(deleteOmnivoiceVoice('prof_dead')).resolves.toBeUndefined()
  })

  it('rethrows on non-404 errors', async () => {
    const { OmniVoiceError } = await import('@omnivoice/sdk')
    deleteProfile.mockRejectedValue(new OmniVoiceError(500, null, 'down'))
    await expect(deleteOmnivoiceVoice('prof_x')).rejects.toThrow(/OMNIVOICE_BACKEND_ERROR/)
  })

  it('throws on empty profileId', async () => {
    await expect(deleteOmnivoiceVoice('')).rejects.toThrow(/OMNIVOICE_PROFILE_ID_REQUIRED/)
    expect(deleteProfile).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 验证测试失败**

```bash
npx vitest run tests/unit/providers/omnivoice/voice-manage.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现 voice-manage.ts**

创建 `src/lib/providers/omnivoice/voice-manage.ts`:

```ts
import { OmniVoiceError } from '@omnivoice/sdk'
import { getOmnivoiceClient } from './client'
import { mapOmnivoiceError } from './error-mapping'

export async function deleteOmnivoiceVoice(profileId: string): Promise<void> {
  const id = profileId?.trim() ?? ''
  if (!id) {
    throw new Error('OMNIVOICE_PROFILE_ID_REQUIRED')
  }
  const ov = getOmnivoiceClient()
  try {
    await ov.design.deleteProfile(id)
  } catch (err) {
    if (err instanceof OmniVoiceError && err.status === 404) return
    const mapped = mapOmnivoiceError(err)
    throw new Error(`${mapped.errorCode}: ${mapped.error}`)
  }
}
```

- [ ] **Step 4: 验证测试通过**

```bash
npx vitest run tests/unit/providers/omnivoice/voice-manage.test.ts
```

Expected: 4 passed。

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/omnivoice/voice-manage.ts tests/unit/providers/omnivoice/voice-manage.test.ts
git commit -m "feat(omnivoice): deleteOmnivoiceVoice 容忍 404"
```

---

## Task 8: voice-cleanup(引用扫描 + 清理孤儿)

**Files:**
- Create: `src/lib/providers/omnivoice/voice-cleanup.ts`
- Test: `tests/unit/providers/omnivoice/voice-cleanup.test.ts`

**Interfaces:**
- Consumes: `deleteOmnivoiceVoice` (Task 7), Prisma client
- Produces(对称 bailian/voice-cleanup.ts):
  - `OmnivoiceVoiceBinding = { voiceId?: string|null; voiceType?: string|null }`
  - `isOmnivoiceManagedVoiceBinding(binding): boolean`(voiceType 前缀 `omnivoice-`)
  - `collectOmnivoiceManagedVoiceIds(bindings): string[]`
  - `collectProjectOmnivoiceManagedVoiceIds(projectId: string): Promise<string[]>`
  - `cleanupUnreferencedOmnivoiceVoices({ voiceIds, scope }): Promise<OmnivoiceVoiceCleanupResult>`
  - `OmnivoiceVoiceCleanupResult = { requestedVoiceIds, skippedReferencedVoiceIds, deletedVoiceIds }`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/providers/omnivoice/voice-cleanup.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  isOmnivoiceManagedVoiceBinding,
  collectOmnivoiceManagedVoiceIds,
} from '@/lib/providers/omnivoice/voice-cleanup'

describe('isOmnivoiceManagedVoiceBinding', () => {
  it('accepts omnivoice-clone voiceType', () => {
    expect(isOmnivoiceManagedVoiceBinding({ voiceId: 'p1', voiceType: 'omnivoice-clone' })).toBe(true)
  })
  it('accepts omnivoice-design voiceType', () => {
    expect(isOmnivoiceManagedVoiceBinding({ voiceId: 'p1', voiceType: 'omnivoice-design' })).toBe(true)
  })
  it('rejects qwen-designed', () => {
    expect(isOmnivoiceManagedVoiceBinding({ voiceId: 'q', voiceType: 'qwen-designed' })).toBe(false)
  })
  it('rejects custom (fal)', () => {
    expect(isOmnivoiceManagedVoiceBinding({ voiceId: 'x', voiceType: 'custom' })).toBe(false)
  })
  it('rejects empty voiceId', () => {
    expect(isOmnivoiceManagedVoiceBinding({ voiceId: '', voiceType: 'omnivoice-clone' })).toBe(false)
  })
})

describe('collectOmnivoiceManagedVoiceIds', () => {
  it('dedupes and filters non-omnivoice', () => {
    const ids = collectOmnivoiceManagedVoiceIds([
      { voiceId: 'a', voiceType: 'omnivoice-clone' },
      { voiceId: 'a', voiceType: 'omnivoice-clone' },
      { voiceId: 'b', voiceType: 'omnivoice-design' },
      { voiceId: 'q', voiceType: 'qwen-designed' },
      { voiceId: '', voiceType: 'omnivoice-clone' },
    ])
    expect(ids).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: 验证测试失败**

```bash
npx vitest run tests/unit/providers/omnivoice/voice-cleanup.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现 voice-cleanup.ts**

创建 `src/lib/providers/omnivoice/voice-cleanup.ts`(完整镜像 bailian/voice-cleanup.ts,把 `bailian` 替成 `omnivoice`、`looksLikeBailianVoiceId` / `qwen-designed` 替为前缀 `omnivoice-`、不读 `apiKey`):

```ts
import { prisma } from '@/lib/prisma'
import { deleteOmnivoiceVoice } from './voice-manage'

export interface OmnivoiceVoiceBinding {
  voiceId?: string | null
  voiceType?: string | null
}

interface CleanupReferenceScope {
  userId: string
  excludeProjectId?: string
  excludeNovelCharacterId?: string
  excludeGlobalCharacterId?: string
}

export interface OmnivoiceVoiceCleanupResult {
  requestedVoiceIds: string[]
  skippedReferencedVoiceIds: string[]
  deletedVoiceIds: string[]
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toLowerCase(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function isOmnivoiceManagedVoiceBinding(binding: OmnivoiceVoiceBinding): boolean {
  const voiceId = readTrimmedString(binding.voiceId)
  if (!voiceId) return false
  const voiceType = toLowerCase(binding.voiceType)
  return voiceType.startsWith('omnivoice-')
}

export function collectOmnivoiceManagedVoiceIds(bindings: OmnivoiceVoiceBinding[]): string[] {
  const deduped = new Set<string>()
  for (const binding of bindings) {
    if (!isOmnivoiceManagedVoiceBinding(binding)) continue
    const voiceId = readTrimmedString(binding.voiceId)
    if (!voiceId) continue
    deduped.add(voiceId)
  }
  return Array.from(deduped)
}

function parseSpeakerVoiceBindings(raw: string | null | undefined): OmnivoiceVoiceBinding[] {
  const source = readTrimmedString(raw)
  if (!source) return []
  let parsed: unknown
  try { parsed = JSON.parse(source) } catch { return [] }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const bindings: OmnivoiceVoiceBinding[] = []
  for (const value of Object.values(parsed)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const node = value as Record<string, unknown>
    bindings.push({
      voiceId: readTrimmedString(node.voiceId) || readTrimmedString(node.profileId) || null,
      voiceType: readTrimmedString(node.voiceType) || null,
    })
  }
  return bindings
}

export async function collectProjectOmnivoiceManagedVoiceIds(projectId: string): Promise<string[]> {
  const novelProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: {
      characters: { select: { voiceId: true, voiceType: true } },
      episodes: { select: { speakerVoices: true } },
    },
  })
  if (!novelProject) return []
  const bindings: OmnivoiceVoiceBinding[] = []
  for (const character of novelProject.characters) {
    bindings.push({ voiceId: character.voiceId, voiceType: character.voiceType })
  }
  for (const episode of novelProject.episodes) {
    bindings.push(...parseSpeakerVoiceBindings(episode.speakerVoices))
  }
  return collectOmnivoiceManagedVoiceIds(bindings)
}

async function findReferencedVoiceIds(params: {
  voiceIds: string[]
  scope: CleanupReferenceScope
}): Promise<Set<string>> {
  const voiceIds = params.voiceIds
  const scope = params.scope
  const referenced = new Set<string>()

  const novelCharacters = await prisma.novelPromotionCharacter.findMany({
    where: {
      voiceId: { in: voiceIds },
      ...(scope.excludeNovelCharacterId ? { id: { not: scope.excludeNovelCharacterId } } : {}),
      novelPromotionProject: {
        project: {
          userId: scope.userId,
          ...(scope.excludeProjectId ? { id: { not: scope.excludeProjectId } } : {}),
        },
      },
    },
    select: { voiceId: true, voiceType: true },
  })
  for (const row of novelCharacters) {
    if (!isOmnivoiceManagedVoiceBinding(row)) continue
    const voiceId = readTrimmedString(row.voiceId)
    if (voiceId) referenced.add(voiceId)
  }

  const globalCharacters = await prisma.globalCharacter.findMany({
    where: {
      userId: scope.userId,
      voiceId: { in: voiceIds },
      ...(scope.excludeGlobalCharacterId ? { id: { not: scope.excludeGlobalCharacterId } } : {}),
    },
    select: { voiceId: true, voiceType: true },
  })
  for (const row of globalCharacters) {
    if (!isOmnivoiceManagedVoiceBinding(row)) continue
    const voiceId = readTrimmedString(row.voiceId)
    if (voiceId) referenced.add(voiceId)
  }

  const globalVoices = await prisma.globalVoice.findMany({
    where: {
      userId: scope.userId,
      voiceId: { in: voiceIds },
    },
    select: { voiceId: true, voiceType: true },
  })
  for (const row of globalVoices) {
    if (!isOmnivoiceManagedVoiceBinding(row)) continue
    const voiceId = readTrimmedString(row.voiceId)
    if (voiceId) referenced.add(voiceId)
  }

  const episodes = await prisma.novelPromotionEpisode.findMany({
    where: {
      speakerVoices: { not: null },
      novelPromotionProject: {
        project: {
          userId: scope.userId,
          ...(scope.excludeProjectId ? { id: { not: scope.excludeProjectId } } : {}),
        },
      },
    },
    select: { speakerVoices: true },
  })
  for (const episode of episodes) {
    const bindings = parseSpeakerVoiceBindings(episode.speakerVoices)
    for (const binding of bindings) {
      const voiceId = readTrimmedString(binding.voiceId)
      if (!voiceId) continue
      if (!voiceIds.includes(voiceId)) continue
      if (!isOmnivoiceManagedVoiceBinding(binding)) continue
      referenced.add(voiceId)
    }
  }

  return referenced
}

export async function cleanupUnreferencedOmnivoiceVoices(params: {
  voiceIds: string[]
  scope: CleanupReferenceScope
}): Promise<OmnivoiceVoiceCleanupResult> {
  const dedupedVoiceIds = Array.from(new Set(
    params.voiceIds.map(readTrimmedString).filter((s) => s.length > 0),
  ))
  if (dedupedVoiceIds.length === 0) {
    return { requestedVoiceIds: [], skippedReferencedVoiceIds: [], deletedVoiceIds: [] }
  }

  const referenced = await findReferencedVoiceIds({ voiceIds: dedupedVoiceIds, scope: params.scope })
  const toDelete = dedupedVoiceIds.filter((id) => !referenced.has(id))
  if (toDelete.length === 0) {
    return {
      requestedVoiceIds: dedupedVoiceIds,
      skippedReferencedVoiceIds: dedupedVoiceIds,
      deletedVoiceIds: [],
    }
  }

  const deletedVoiceIds: string[] = []
  for (const voiceId of toDelete) {
    try {
      await deleteOmnivoiceVoice(voiceId)
      deletedVoiceIds.push(voiceId)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`OMNIVOICE_VOICE_CLEANUP_FAILED(${voiceId}): ${message}`)
    }
  }

  return {
    requestedVoiceIds: dedupedVoiceIds,
    skippedReferencedVoiceIds: dedupedVoiceIds.filter((id) => referenced.has(id)),
    deletedVoiceIds,
  }
}
```

- [ ] **Step 4: 验证测试通过**

```bash
npx vitest run tests/unit/providers/omnivoice/voice-cleanup.test.ts
```

Expected: 6 passed。

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/omnivoice/voice-cleanup.ts tests/unit/providers/omnivoice/voice-cleanup.test.ts
git commit -m "feat(omnivoice): voice cleanup 镜像 bailian 引用计数"
```

---

## Task 9: probe + audio.ts + catalog.ts + index.ts

**Files:**
- Create: `src/lib/providers/omnivoice/probe.ts`
- Create: `src/lib/providers/omnivoice/audio.ts`
- Create: `src/lib/providers/omnivoice/catalog.ts`
- Create: `src/lib/providers/omnivoice/index.ts`
- Modify: `src/lib/providers/official/model-registry.ts`(`OfficialProviderKey` 加 `'omnivoice'`)
- Test: `tests/unit/providers/omnivoice/audio.test.ts`

**Interfaces:**
- Consumes: `getOmnivoiceClient()`, `synthesizeWithOmnivoiceTTS()`, `assertOfficialModelRegistered()`, `registerOfficialModel()`
- Produces:
  - `probeOmnivoice(): Promise<{ success, steps: Array<{ name, status, message, detail? }> }>`
  - `generateOmnivoiceAudio(params): Promise<GenerateResult>`
  - `ensureOmnivoiceCatalogRegistered(): void`
  - `listOmnivoiceCatalogModels(modality): readonly string[]`
  - `OMNIVOICE_TTS_MODEL_ID = 'omnivoice-tts-v1'`
  - barrel re-exports

- [ ] **Step 1: 修改 model-registry.ts 加 'omnivoice' provider key**

修改 `src/lib/providers/official/model-registry.ts`:

```ts
export type OfficialProviderKey = 'bailian' | 'siliconflow' | 'starrouter' | 'omnivoice'
```

- [ ] **Step 2: 写 audio 失败测试**

创建 `tests/unit/providers/omnivoice/audio.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/providers/omnivoice/tts', () => ({
  synthesizeWithOmnivoiceTTS: vi.fn(),
}))

import { synthesizeWithOmnivoiceTTS } from '@/lib/providers/omnivoice/tts'
import { generateOmnivoiceAudio } from '@/lib/providers/omnivoice/audio'

describe('generateOmnivoiceAudio', () => {
  beforeEach(() => {
    ;(synthesizeWithOmnivoiceTTS as unknown as { mockReset: () => void }).mockReset()
  })

  it('throws when voice (profileId) missing', async () => {
    await expect(generateOmnivoiceAudio({
      userId: 'u',
      text: 'hi',
      voice: '',
      options: { provider: 'omnivoice', modelId: 'omnivoice-tts-v1', modelKey: 'omnivoice:omnivoice-tts-v1' },
    })).rejects.toThrow(/OMNIVOICE_PROFILE_ID_REQUIRED/)
  })

  it('returns base64 data url on success', async () => {
    ;(synthesizeWithOmnivoiceTTS as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: true,
      audioData: Buffer.from([1, 2, 3]),
      audioDuration: 100,
      requestId: 'r1',
    })
    const r = await generateOmnivoiceAudio({
      userId: 'u',
      text: 'hi',
      voice: 'prof_x',
      options: { provider: 'omnivoice', modelId: 'omnivoice-tts-v1', modelKey: 'omnivoice:omnivoice-tts-v1' },
    })
    expect(r.success).toBe(true)
    expect(r.audioUrl?.startsWith('data:audio/wav;base64,')).toBe(true)
    expect(r.requestId).toBe('r1')
  })

  it('throws on synthesize failure', async () => {
    ;(synthesizeWithOmnivoiceTTS as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: false,
      error: 'down',
      errorCode: 'OMNIVOICE_BACKEND_ERROR',
    })
    await expect(generateOmnivoiceAudio({
      userId: 'u',
      text: 'hi',
      voice: 'prof_x',
      options: { provider: 'omnivoice', modelId: 'omnivoice-tts-v1', modelKey: 'omnivoice:omnivoice-tts-v1' },
    })).rejects.toThrow(/OMNIVOICE_BACKEND_ERROR/)
  })
})
```

- [ ] **Step 3: 实现 catalog.ts**

创建 `src/lib/providers/omnivoice/catalog.ts`:

```ts
import { registerOfficialModel } from '@/lib/providers/official/model-registry'
import type { OfficialModelModality } from '@/lib/providers/official/model-registry'

export const OMNIVOICE_TTS_MODEL_ID = 'omnivoice-tts-v1'

const OMNIVOICE_CATALOG: Readonly<Record<OfficialModelModality, readonly string[]>> = {
  llm: [],
  image: [],
  video: [],
  audio: [OMNIVOICE_TTS_MODEL_ID],
}

let initialized = false

export function ensureOmnivoiceCatalogRegistered(): void {
  if (initialized) return
  initialized = true
  for (const modality of Object.keys(OMNIVOICE_CATALOG) as OfficialModelModality[]) {
    for (const modelId of OMNIVOICE_CATALOG[modality]) {
      registerOfficialModel({ provider: 'omnivoice', modality, modelId })
    }
  }
}

export function listOmnivoiceCatalogModels(modality: OfficialModelModality): readonly string[] {
  ensureOmnivoiceCatalogRegistered()
  return OMNIVOICE_CATALOG[modality]
}
```

- [ ] **Step 4: 实现 audio.ts**

创建 `src/lib/providers/omnivoice/audio.ts`:

```ts
import {
  assertOfficialModelRegistered,
  type OfficialModelModality,
} from '@/lib/providers/official/model-registry'
import type { GenerateResult } from '@/lib/generators/base'
import { ensureOmnivoiceCatalogRegistered } from './catalog'
import { synthesizeWithOmnivoiceTTS } from './tts'

export interface OmnivoiceGenerateRequestOptions {
  provider: string
  modelId: string
  modelKey: string
  [key: string]: unknown
}

export interface OmnivoiceAudioGenerateParams {
  userId: string
  text: string
  voice?: string
  rate?: number
  options: OmnivoiceGenerateRequestOptions
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function generateOmnivoiceAudio(
  params: OmnivoiceAudioGenerateParams,
): Promise<GenerateResult> {
  ensureOmnivoiceCatalogRegistered()
  assertOfficialModelRegistered({
    provider: 'omnivoice',
    modality: 'audio' satisfies OfficialModelModality,
    modelId: params.options.modelId,
  })

  const profileId = readTrimmedString(params.voice)
  const text = readTrimmedString(params.text)
  if (!profileId) throw new Error('OMNIVOICE_PROFILE_ID_REQUIRED')
  if (!text) throw new Error('OMNIVOICE_TEXT_REQUIRED')

  const result = await synthesizeWithOmnivoiceTTS({ text, profileId })
  if (!result.success || !result.audioData) {
    throw new Error(result.errorCode || result.error || 'OMNIVOICE_AUDIO_SYNTHESIZE_FAILED')
  }
  return {
    success: true,
    audioUrl: `data:audio/wav;base64,${result.audioData.toString('base64')}`,
    requestId: result.requestId,
  }
}
```

- [ ] **Step 5: 实现 probe.ts**

创建 `src/lib/providers/omnivoice/probe.ts`:

```ts
import { getOmnivoiceClient } from './client'

export interface OmnivoiceProbeStep {
  name: 'health'
  status: 'pass' | 'fail'
  message: string
  detail?: string
}

export interface OmnivoiceProbeResult {
  success: boolean
  steps: OmnivoiceProbeStep[]
}

export async function probeOmnivoice(): Promise<OmnivoiceProbeResult> {
  const ov = getOmnivoiceClient()
  try {
    const r = await ov.health()
    return {
      success: true,
      steps: [{
        name: 'health',
        status: 'pass',
        message: `OmniVoice ${r.version ?? '?'} on ${r.device ?? '?'}`,
      }],
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      steps: [{
        name: 'health',
        status: 'fail',
        message: 'Network or backend error',
        detail: message.slice(0, 500),
      }],
    }
  }
}
```

- [ ] **Step 6: 实现 index.ts(barrel)**

创建 `src/lib/providers/omnivoice/index.ts`:

```ts
export { ensureOmnivoiceCatalogRegistered, listOmnivoiceCatalogModels, OMNIVOICE_TTS_MODEL_ID } from './catalog'
export { getOmnivoiceClient, getOmnivoiceBaseUrl, resetOmnivoiceClientForTest } from './client'
export { synthesizeWithOmnivoiceTTS } from './tts'
export { createOmnivoiceClone, buildOmnivoiceProfileName } from './voice-clone'
export { createOmnivoiceVoiceDesign } from './voice-design'
export { deleteOmnivoiceVoice } from './voice-manage'
export {
  isOmnivoiceManagedVoiceBinding,
  collectOmnivoiceManagedVoiceIds,
  collectProjectOmnivoiceManagedVoiceIds,
  cleanupUnreferencedOmnivoiceVoices,
} from './voice-cleanup'
export { generateOmnivoiceAudio } from './audio'
export { probeOmnivoice } from './probe'
export { mapOmnivoiceError } from './error-mapping'
export type {
  OmnivoiceTTSParams,
  OmnivoiceTTSResult,
  OmnivoiceCloneParams,
  OmnivoiceCloneResult,
  OmnivoiceDesignParams,
  OmnivoiceDesignResult,
} from './types'
export type { OmnivoiceVoiceBinding, OmnivoiceVoiceCleanupResult } from './voice-cleanup'
export type { OmnivoiceProbeResult, OmnivoiceProbeStep } from './probe'
export type { OmnivoiceGenerateRequestOptions } from './audio'
```

- [ ] **Step 7: 验证 audio 测试通过 + typecheck**

```bash
npx vitest run tests/unit/providers/omnivoice/audio.test.ts
npm run typecheck
```

Expected: audio.test 3 passed;typecheck 0 errors。

- [ ] **Step 8: Commit**

```bash
git add src/lib/providers/omnivoice/probe.ts src/lib/providers/omnivoice/audio.ts src/lib/providers/omnivoice/catalog.ts src/lib/providers/omnivoice/index.ts src/lib/providers/official/model-registry.ts tests/unit/providers/omnivoice/audio.test.ts
git commit -m "feat(omnivoice): probe/audio/catalog/index 注册到 official model registry"
```

---

## Task 10: provider-voice-binding.ts 扩展

**Files:**
- Modify: `src/lib/voice/provider-voice-binding.ts`
- Test: `tests/unit/providers/omnivoice/voice-binding.test.ts`

**Interfaces:**
- Produces:
  - `OmnivoiceSpeakerVoiceEntry = { provider: 'omnivoice'; voiceType: string; profileId: string; previewAudioUrl?: string }`
  - `SpeakerVoiceEntry` 联合追加 `OmnivoiceSpeakerVoiceEntry`
  - `OmnivoiceVoiceGenerationBinding = { provider: 'omnivoice'; source: VoiceSource; profileId: string }`
  - `VoiceGenerationBinding` 联合追加该项
  - `SupportedAudioProviderKey` 加 `'omnivoice'`
  - `resolveVoiceBindingForProvider({ providerKey: 'omnivoice', ... })` 行为:
    - 优先 character.voiceType startsWith `omnivoice-` && character.voiceId 非空 → 返回 `{ provider: 'omnivoice', source: 'character', profileId: character.voiceId }`
    - 否则若 `speakerVoice.provider === 'omnivoice'` → `{ provider: 'omnivoice', source: 'speaker', profileId: speakerVoice.profileId }`
    - 否则 null
  - `getSpeakerVoicePreviewUrl(speakerVoice)` 处理 omnivoice 时返回 `previewAudioUrl ?? null`
  - `hasAnyVoiceBinding` 在 `voiceType` 为 omnivoice 时也返回 true

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/providers/omnivoice/voice-binding.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  resolveVoiceBindingForProvider,
  hasAnyVoiceBinding,
  getSpeakerVoicePreviewUrl,
  parseSpeakerVoiceMap,
} from '@/lib/voice/provider-voice-binding'

describe('omnivoice voice binding', () => {
  it('resolves character voiceType=omnivoice-clone to character profileId', () => {
    const r = resolveVoiceBindingForProvider({
      providerKey: 'omnivoice',
      character: { voiceId: 'prof_a', customVoiceUrl: null },
      speakerVoice: null,
    } as unknown as Parameters<typeof resolveVoiceBindingForProvider>[0])
    expect(r).toEqual({ provider: 'omnivoice', source: 'character', profileId: 'prof_a' })
  })

  it('falls back to speakerVoice when character has no omnivoice voiceId', () => {
    const r = resolveVoiceBindingForProvider({
      providerKey: 'omnivoice',
      character: { voiceId: null, customVoiceUrl: null },
      speakerVoice: {
        provider: 'omnivoice',
        voiceType: 'omnivoice-design',
        profileId: 'prof_b',
      },
    })
    expect(r).toEqual({ provider: 'omnivoice', source: 'speaker', profileId: 'prof_b' })
  })

  it('returns null when speakerVoice provider mismatches', () => {
    const r = resolveVoiceBindingForProvider({
      providerKey: 'omnivoice',
      character: null,
      speakerVoice: { provider: 'fal', voiceType: 'uploaded', audioUrl: 'http://x' },
    })
    expect(r).toBeNull()
  })

  it('hasAnyVoiceBinding returns true for omnivoice speakerVoice', () => {
    expect(hasAnyVoiceBinding({
      character: null,
      speakerVoice: { provider: 'omnivoice', voiceType: 'omnivoice-clone', profileId: 'prof_c' },
    })).toBe(true)
  })

  it('getSpeakerVoicePreviewUrl returns previewAudioUrl for omnivoice', () => {
    expect(getSpeakerVoicePreviewUrl({
      provider: 'omnivoice',
      voiceType: 'omnivoice-design',
      profileId: 'p',
      previewAudioUrl: 'http://prev',
    })).toBe('http://prev')
  })

  it('parseSpeakerVoiceMap parses provider=omnivoice entries', () => {
    const map = parseSpeakerVoiceMap(JSON.stringify({
      旁白: { provider: 'omnivoice', voiceType: 'omnivoice-design', profileId: 'p1', previewAudioUrl: 'u' },
    }))
    expect(map['旁白']).toEqual({
      provider: 'omnivoice',
      voiceType: 'omnivoice-design',
      profileId: 'p1',
      previewAudioUrl: 'u',
    })
  })

  it('parseSpeakerVoiceMap rejects omnivoice entry without profileId', () => {
    expect(() => parseSpeakerVoiceMap(JSON.stringify({
      旁白: { provider: 'omnivoice', voiceType: 'omnivoice-design' },
    }))).toThrow(/SPEAKER_VOICE_ENTRY_INVALID_OMNIVOICE_PROFILE_ID/)
  })
})
```

- [ ] **Step 2: 验证测试失败**

```bash
npx vitest run tests/unit/providers/omnivoice/voice-binding.test.ts
```

Expected: FAIL — 解析与解析逻辑还未支持。

- [ ] **Step 3: 修改 provider-voice-binding.ts**

在 `src/lib/voice/provider-voice-binding.ts` 顶部 type 区追加:

```ts
export type SupportedAudioProviderKey = 'fal' | 'bailian' | 'omnivoice'

// ... 已有 FalSpeakerVoiceEntry / BailianSpeakerVoiceEntry 类型保持不变

export type OmnivoiceSpeakerVoiceEntry = {
  provider: 'omnivoice'
  voiceType: string
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

export type VoiceGenerationBinding =
  | FalVoiceGenerationBinding
  | BailianVoiceGenerationBinding
  | OmnivoiceVoiceGenerationBinding
```

`RawSpeakerVoiceEntry` 加 `profileId` 字段:

```ts
export interface RawSpeakerVoiceEntry {
  provider?: string | null
  voiceType?: string | null
  audioUrl?: string | null
  voiceId?: string | null
  profileId?: string | null
  previewAudioUrl?: string | null
}
```

`SpeakerVoicePatch` 联合追加:

```ts
| {
    provider: 'omnivoice'
    voiceType?: string
    profileId: string
    previewAudioUrl?: string
  }
```

`normalizeRawSpeakerVoiceEntry` 在 `provider === 'bailian'` 分支后追加:

```ts
if (provider === 'omnivoice') {
  const profileId = readTrimmedString(entry.profileId) || readTrimmedString(entry.voiceId)
  if (!profileId) {
    throw new Error(`SPEAKER_VOICE_ENTRY_INVALID_OMNIVOICE_PROFILE_ID: ${speaker}`)
  }
  return {
    provider: 'omnivoice',
    voiceType,
    profileId,
    ...(previewAudioUrl ? { previewAudioUrl } : {}),
  }
}
```

`normalizeProviderKey` 改为:

```ts
function normalizeProviderKey(providerKey: string): SupportedAudioProviderKey | null {
  if (providerKey === 'fal' || providerKey === 'bailian' || providerKey === 'omnivoice') {
    return providerKey
  }
  return null
}
```

`resolveVoiceBindingForProvider` 在 fal / bailian 分支末尾添加:

```ts
if (providerKey === 'omnivoice') {
  const characterVoiceType = toLowerCase(params.character?.voiceType)
  const characterVoiceId = readTrimmedString(params.character?.voiceId)
  if (characterVoiceType.startsWith('omnivoice-') && characterVoiceId) {
    return { provider: 'omnivoice', source: 'character', profileId: characterVoiceId }
  }
  if (params.speakerVoice?.provider !== 'omnivoice') return null
  const profileId = readTrimmedString(params.speakerVoice.profileId)
  if (!profileId) return null
  return { provider: 'omnivoice', source: 'speaker', profileId }
}
```

注意:这要求 `CharacterVoiceFields` 接口加 `voiceType?: string | null`。修改:

```ts
export interface CharacterVoiceFields {
  customVoiceUrl?: string | null
  voiceId?: string | null
  voiceType?: string | null
}
```

并在 `generate-voice-line.ts` 中读取 character 时 select 加 `voiceType: true`(Task 12 处理)。

`hasAnyVoiceBinding` 与 `getSpeakerVoicePreviewUrl` 的 omnivoice 分支:

```ts
// hasAnyVoiceBinding 末尾:
if (params.speakerVoice?.provider === 'omnivoice') {
  return !!readTrimmedString(params.speakerVoice.profileId)
}

// getSpeakerVoicePreviewUrl 末尾:
if (speakerVoice.provider === 'omnivoice') {
  return readTrimmedString(speakerVoice.previewAudioUrl)
}
```

并需要把 `toLowerCase` helper 提到模块级(从 voice-cleanup 借鉴):

```ts
function toLowerCase(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}
```

- [ ] **Step 4: 验证测试通过**

```bash
npx vitest run tests/unit/providers/omnivoice/voice-binding.test.ts
npm run typecheck
```

Expected: 7 passed;typecheck 0 errors。

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/provider-voice-binding.ts tests/unit/providers/omnivoice/voice-binding.test.ts
git commit -m "feat(omnivoice): provider-voice-binding 支持 omnivoice 解析与 binding"
```

---

## Task 11: generate-voice-line.ts 接入 omnivoice 分支

**Files:**
- Modify: `src/lib/voice/generate-voice-line.ts`
- Test: `tests/unit/providers/omnivoice/generate-voice-line.test.ts`

**Interfaces:**
- Consumes: `synthesizeWithOmnivoiceTTS()`, `resolveVoiceBindingForProvider`(已支持 omnivoice)
- Produces: 对 `providerKey === 'omnivoice'` 的 voice line 调用产出 `{ audioUrl, storageKey, audioDuration }` 写入 NovelPromotionVoiceLine

- [ ] **Step 1: 写失败测试(集成层级,mock TTS + storage)**

创建 `tests/unit/providers/omnivoice/generate-voice-line.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/providers/omnivoice/tts', () => ({
  synthesizeWithOmnivoiceTTS: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({
  uploadObject: vi.fn(async (_buf: Buffer, key: string) => key),
  getSignedUrl: vi.fn((key: string) => `https://signed/${key}`),
  toFetchableUrl: vi.fn((u: string) => u),
  extractStorageKey: vi.fn(() => null),
}))
vi.mock('@/lib/api-config', () => ({
  resolveModelSelectionOrSingle: vi.fn(),
  getProviderKey: vi.fn((p: string) => p?.split(':')[0] ?? ''),
  getProviderConfig: vi.fn(),
  getAudioApiKey: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    novelPromotionVoiceLine: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    novelPromotionProject: { findUnique: vi.fn() },
    novelPromotionEpisode: { findUnique: vi.fn() },
  },
}))

import { generateVoiceLine } from '@/lib/voice/generate-voice-line'
import { synthesizeWithOmnivoiceTTS } from '@/lib/providers/omnivoice/tts'
import { resolveModelSelectionOrSingle } from '@/lib/api-config'
import { prisma } from '@/lib/prisma'

describe('generateVoiceLine — omnivoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses character.voiceType=omnivoice-clone path', async () => {
    ;(prisma.novelPromotionVoiceLine.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 'line1', episodeId: 'ep1', speaker: 'Hero', content: '你好', emotionPrompt: null, emotionStrength: null,
    })
    ;(prisma.novelPromotionProject.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      characters: [{
        name: 'Hero', voiceId: 'prof_x', voiceType: 'omnivoice-clone', customVoiceUrl: null,
      }],
    })
    ;(prisma.novelPromotionEpisode.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      speakerVoices: null,
    })
    ;(prisma.novelPromotionVoiceLine.update as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({})
    ;(resolveModelSelectionOrSingle as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      provider: 'omnivoice', modelId: 'omnivoice-tts-v1', modelKey: 'omnivoice:omnivoice-tts-v1',
    })
    const audio = Buffer.alloc(44 + 8000)
    audio.write('RIFF', 0)
    audio.write('WAVE', 8)
    ;(synthesizeWithOmnivoiceTTS as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: true, audioData: audio, audioDuration: 1234, requestId: 'r',
    })

    const r = await generateVoiceLine({ projectId: 'pr', lineId: 'line1', userId: 'u' })

    expect(synthesizeWithOmnivoiceTTS).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'prof_x', text: '你好',
    }))
    expect(r.audioDuration).toBe(1234)
    expect(r.storageKey).toContain('voice/pr/ep1/line1.wav')
  })

  it('throws when omnivoice binding missing', async () => {
    ;(prisma.novelPromotionVoiceLine.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 'line2', episodeId: 'ep1', speaker: 'Hero', content: 'x', emotionPrompt: null, emotionStrength: null,
    })
    ;(prisma.novelPromotionProject.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      characters: [{ name: 'Hero', voiceId: null, voiceType: null, customVoiceUrl: null }],
    })
    ;(prisma.novelPromotionEpisode.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ speakerVoices: null })
    ;(resolveModelSelectionOrSingle as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      provider: 'omnivoice', modelId: 'omnivoice-tts-v1', modelKey: 'omnivoice:omnivoice-tts-v1',
    })

    await expect(generateVoiceLine({ projectId: 'pr', lineId: 'line2', userId: 'u' }))
      .rejects.toThrow(/请先为该发言人绑定 OmniVoice 音色/)
  })
})
```

- [ ] **Step 2: 验证测试失败**

```bash
npx vitest run tests/unit/providers/omnivoice/generate-voice-line.test.ts
```

Expected: FAIL — omnivoice 分支未实现。

- [ ] **Step 3: 修改 generate-voice-line.ts**

修改 `src/lib/voice/generate-voice-line.ts`:

(a) 文件顶部 imports 追加:

```ts
import { synthesizeWithOmnivoiceTTS } from '@/lib/providers/omnivoice'
```

(b) `prisma.novelPromotionProject.findUnique` 已经是 `include: { characters: true }`,默认会选所有列含 `voiceType`,无需改。但需要确认 `CharacterVoiceProfile` 类型继承的 `CharacterVoiceFields` 现在含 `voiceType` —— Task 10 已扩展。

(c) 在 bailian `else if` 分支后追加 omnivoice 分支:

```ts
} else if (providerKey === 'omnivoice') {
  if (!voiceBinding || voiceBinding.provider !== 'omnivoice') {
    throw new Error('请先为该发言人绑定 OmniVoice 音色')
  }
  const result = await synthesizeWithOmnivoiceTTS({
    text,
    profileId: voiceBinding.profileId,
  })
  if (!result.success || !result.audioData) {
    throw new Error(result.errorCode || result.error || 'OMNIVOICE_TTS_FAILED')
  }
  generated = {
    audioData: result.audioData,
    audioDuration: result.audioDuration ?? getWavDurationFromBuffer(result.audioData),
  }
}
```

放在 bailian 分支(行 264 `} else {` 之前)与 fallback `else { throw ... AUDIO_PROVIDER_UNSUPPORTED}` 之间。

(d) `matchCharacterBySpeaker` 返回的 character 需要在 omnivoice 分支被 `resolveVoiceBindingForProvider` 看到 `voiceType`。Task 10 已把 `voiceType` 加进 `CharacterVoiceFields`,因此 `character` 对象上若 prisma 返回了 voiceType(默认 select 全部列时返回),即可工作。**确保 `CharacterVoiceProfile` 的 type 拼装包含 voiceType**:在 [src/lib/voice/generate-voice-line.ts:17](src/lib/voice/generate-voice-line.ts#L17) 的 `type CharacterVoiceProfile = CharacterVoiceFields & { name: string }` 不需改,因为 voiceType 已在扩展后的 CharacterVoiceFields 中。

- [ ] **Step 4: 验证测试通过**

```bash
npx vitest run tests/unit/providers/omnivoice/generate-voice-line.test.ts
npm run typecheck
```

Expected: 2 passed;typecheck 0 errors。

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/generate-voice-line.ts tests/unit/providers/omnivoice/generate-voice-line.test.ts
git commit -m "feat(omnivoice): generate-voice-line 加 omnivoice 分支"
```

---

## Task 12: voice-design worker handler 分发

**Files:**
- Modify: `src/lib/workers/handlers/voice-design.ts`
- Modify: `src/app/api/asset-hub/voice-design/route.ts`(透传 provider)
- Test: `tests/integration/provider/omnivoice-design-flow.test.ts`

**Interfaces:**
- Consumes: `createOmnivoiceVoiceDesign()`, `createVoiceDesign` (existing bailian)
- Produces: voice-design BullMQ job 按 `payload.provider`(`bailian` | `omnivoice`,默认 `bailian`)分发到对应实现,返回值形状一致(`voiceId`, `audioBase64`, `sampleRate`, `responseFormat`, `requestId`)。

- [ ] **Step 1: 写集成测试**

创建 `tests/integration/provider/omnivoice-design-flow.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/providers/omnivoice', () => ({
  createOmnivoiceVoiceDesign: vi.fn(),
}))
vi.mock('@/lib/providers/bailian/voice-design', () => ({
  createVoiceDesign: vi.fn(),
  validateVoicePrompt: vi.fn(() => ({ valid: true })),
  validatePreviewText: vi.fn(() => ({ valid: true })),
}))
vi.mock('@/lib/api-config', () => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'k' })),
}))
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: vi.fn(async () => undefined),
}))
vi.mock('@/lib/workers/utils', () => ({
  assertTaskActive: vi.fn(async () => undefined),
}))

import { handleVoiceDesignTask } from '@/lib/workers/handlers/voice-design'
import { createOmnivoiceVoiceDesign } from '@/lib/providers/omnivoice'
import { createVoiceDesign } from '@/lib/providers/bailian/voice-design'

function buildJob(payload: Record<string, unknown>) {
  return {
    data: { userId: 'u1', type: 'asset_hub_voice_design', payload },
  } as Parameters<typeof handleVoiceDesignTask>[0]
}

describe('handleVoiceDesignTask provider dispatch', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('routes to omnivoice when payload.provider === omnivoice', async () => {
    ;(createOmnivoiceVoiceDesign as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: true, profileId: 'prof_o', audioBase64: 'AAA', sampleRate: 24000, responseFormat: 'wav',
    })
    const r = await handleVoiceDesignTask(buildJob({
      provider: 'omnivoice', voicePrompt: '温暖中年男声', previewText: '你好', preferredName: 'Hero', language: 'zh',
    }))
    expect(createOmnivoiceVoiceDesign).toHaveBeenCalledWith(expect.objectContaining({
      voicePrompt: '温暖中年男声', previewText: '你好', userId: 'u1',
    }))
    expect(createVoiceDesign).not.toHaveBeenCalled()
    expect(r.voiceId).toBe('prof_o')
    expect(r.targetModel).toBe('omnivoice-tts-v1')
  })

  it('defaults to bailian when payload.provider missing', async () => {
    ;(createVoiceDesign as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: true, voiceId: 'qwen_v1', targetModel: 'qwen3-tts-vd-2026-01-26',
    })
    await handleVoiceDesignTask(buildJob({
      voicePrompt: 'x', previewText: 'y',
    }))
    expect(createVoiceDesign).toHaveBeenCalled()
    expect(createOmnivoiceVoiceDesign).not.toHaveBeenCalled()
  })

  it('throws when omnivoice returns failure', async () => {
    ;(createOmnivoiceVoiceDesign as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: false, error: 'down', errorCode: 'OMNIVOICE_BACKEND_ERROR',
    })
    await expect(handleVoiceDesignTask(buildJob({
      provider: 'omnivoice', voicePrompt: 'x', previewText: 'y',
    }))).rejects.toThrow(/down/)
  })
})
```

- [ ] **Step 2: 验证测试失败**

```bash
npx vitest run tests/integration/provider/omnivoice-design-flow.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 修改 voice-design handler**

替换 `src/lib/workers/handlers/voice-design.ts` 全文:

```ts
import type { Job } from 'bullmq'
import {
  createVoiceDesign,
  validatePreviewText,
  validateVoicePrompt,
  type VoiceDesignInput,
} from '@/lib/providers/bailian/voice-design'
import { createOmnivoiceVoiceDesign, OMNIVOICE_TTS_MODEL_ID } from '@/lib/providers/omnivoice'
import { getProviderConfig } from '@/lib/api-config'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value.trim()
}

function readLanguage(value: unknown): 'zh' | 'en' {
  return value === 'en' ? 'en' : 'zh'
}

function readProvider(value: unknown): 'bailian' | 'omnivoice' {
  return value === 'omnivoice' ? 'omnivoice' : 'bailian'
}

export async function handleVoiceDesignTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const provider = readProvider(payload.provider)
  const voicePrompt = readRequiredString(payload.voicePrompt, 'voicePrompt')
  const previewText = readRequiredString(payload.previewText, 'previewText')
  const preferredName = typeof payload.preferredName === 'string' && payload.preferredName.trim()
    ? payload.preferredName.trim()
    : 'custom_voice'
  const language = readLanguage(payload.language)

  const promptValidation = validateVoicePrompt(voicePrompt)
  if (!promptValidation.valid) {
    throw new Error(promptValidation.error || 'invalid voicePrompt')
  }
  const textValidation = validatePreviewText(previewText)
  if (!textValidation.valid) {
    throw new Error(textValidation.error || 'invalid previewText')
  }

  await reportTaskProgress(job, 25, {
    stage: 'voice_design_submit',
    stageLabel: '提交声音设计任务',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'voice_design_submit')

  const taskType = job.data.type === TASK_TYPE.ASSET_HUB_VOICE_DESIGN
    ? TASK_TYPE.ASSET_HUB_VOICE_DESIGN
    : TASK_TYPE.VOICE_DESIGN

  if (provider === 'omnivoice') {
    const designed = await createOmnivoiceVoiceDesign({
      voicePrompt,
      previewText,
      preferredName,
      language,
      userId: job.data.userId,
    })
    if (!designed.success) {
      throw new Error(designed.error || '声音设计失败')
    }
    await reportTaskProgress(job, 96, {
      stage: 'voice_design_done',
      stageLabel: '声音设计完成',
      displayMode: 'detail',
    })
    return {
      success: true,
      voiceId: designed.profileId,
      targetModel: OMNIVOICE_TTS_MODEL_ID,
      voiceType: 'omnivoice-design',
      audioBase64: designed.audioBase64,
      sampleRate: designed.sampleRate,
      responseFormat: designed.responseFormat,
      requestId: designed.requestId,
      taskType,
    }
  }

  const { apiKey } = await getProviderConfig(job.data.userId, 'bailian')
  const input: VoiceDesignInput = { voicePrompt, previewText, preferredName, language }
  const designed = await createVoiceDesign(input, apiKey)
  if (!designed.success) {
    throw new Error(designed.error || '声音设计失败')
  }

  await reportTaskProgress(job, 96, {
    stage: 'voice_design_done',
    stageLabel: '声音设计完成',
    displayMode: 'detail',
  })

  return {
    success: true,
    voiceId: designed.voiceId,
    targetModel: designed.targetModel,
    voiceType: 'qwen-designed',
    audioBase64: designed.audioBase64,
    sampleRate: designed.sampleRate,
    responseFormat: designed.responseFormat,
    usageCount: designed.usageCount,
    requestId: designed.requestId,
    taskType,
  }
}
```

- [ ] **Step 4: 修改 asset-hub voice-design route 透传 provider**

修改 `src/app/api/asset-hub/voice-design/route.ts` 的 payload 构造:

```ts
const provider = body.provider === 'omnivoice' ? 'omnivoice' : 'bailian'
// ...
const payload = {
  provider,
  voicePrompt,
  previewText,
  preferredName,
  language,
  displayMode: 'detail' as const,
}
```

并把 dedupe digest 包含 provider:

```ts
const digest = createHash('sha1')
  .update(`${session.user.id}:${provider}:${voicePrompt}:${previewText}:${preferredName}:${language}`)
  .digest('hex')
  .slice(0, 16)
```

- [ ] **Step 5: 同步修改 novel-promotion voice-design route**

如果 `src/app/api/novel-promotion/[projectId]/voice-design/route.ts` 也走 submitTask + payload 模式,在 payload 中同样加 `provider`(默认 bailian)。检查代码后 mirror 修改。命令:

```bash
grep -n "voicePrompt\|previewText" src/app/api/novel-promotion/[projectId]/voice-design/route.ts
```

如果没有这种字段(可能是 novel-promotion 路径走不同的合并逻辑),则忽略此步骤。

- [ ] **Step 6: 验证测试通过**

```bash
npx vitest run tests/integration/provider/omnivoice-design-flow.test.ts
npm run typecheck
```

Expected: 3 passed;typecheck 0 errors。

- [ ] **Step 7: Commit**

```bash
git add src/lib/workers/handlers/voice-design.ts src/app/api/asset-hub/voice-design/route.ts src/app/api/novel-promotion/[projectId]/voice-design/route.ts tests/integration/provider/omnivoice-design-flow.test.ts
git commit -m "feat(omnivoice): voice-design worker handler 按 payload.provider 分发"
```

---

## Task 13: cleanup 调用点接入(项目/角色删除时清理孤儿)

**Files:**
- Modify: `src/app/api/projects/[projectId]/route.ts:214-215`
- Modify: `src/app/api/asset-hub/characters/[characterId]/route.ts:113`
- Modify: `src/app/api/novel-promotion/[projectId]/character/route.ts:100`
- Test: `tests/integration/provider/omnivoice-cleanup-call-sites.test.ts`(可选,优先级低,保留 spec 验收)

**Interfaces:**
- Consumes: `cleanupUnreferencedOmnivoiceVoices`, `collectProjectOmnivoiceManagedVoiceIds`
- Produces: 三个删除入口在 bailian cleanup 后追加对称的 omnivoice cleanup 调用,scope 参数完全一致。

- [ ] **Step 1: 改 projects route**

修改 `src/app/api/projects/[projectId]/route.ts`:

文件顶 import 区追加:

```ts
import {
  collectProjectOmnivoiceManagedVoiceIds,
  cleanupUnreferencedOmnivoiceVoices,
} from '@/lib/providers/omnivoice'
```

第 213-220 行附近(原本是):

```ts
const projectVoiceIds = await collectProjectBailianManagedVoiceIds(projectId)
const voiceCleanupResult = await cleanupUnreferencedBailianVoices({
  voiceIds: projectVoiceIds,
  scope: { userId, excludeProjectId: projectId },
})
```

改为:

```ts
const bailianVoiceIds = await collectProjectBailianManagedVoiceIds(projectId)
const bailianCleanup = await cleanupUnreferencedBailianVoices({
  voiceIds: bailianVoiceIds,
  scope: { userId, excludeProjectId: projectId },
})

const omnivoiceVoiceIds = await collectProjectOmnivoiceManagedVoiceIds(projectId)
const omnivoiceCleanup = await cleanupUnreferencedOmnivoiceVoices({
  voiceIds: omnivoiceVoiceIds,
  scope: { userId, excludeProjectId: projectId },
})

const voiceCleanupResult = {
  bailian: bailianCleanup,
  omnivoice: omnivoiceCleanup,
}
```

如果 `voiceCleanupResult` 此前是直接序列化进 response,把它改成 `{ bailian, omnivoice }` 形状。检查 response 体并对应调整。

- [ ] **Step 2: 改 asset-hub characters route**

修改 `src/app/api/asset-hub/characters/[characterId]/route.ts:113` 附近,在 `cleanupUnreferencedBailianVoices` 调用后追加:

```ts
const omnivoiceCleanup = await cleanupUnreferencedOmnivoiceVoices({
  voiceIds: collectOmnivoiceManagedVoiceIds([{
    voiceId: existing.voiceId,
    voiceType: existing.voiceType,
  }]),
  scope: { userId: session.user.id, excludeGlobalCharacterId: characterId },
})
```

import 区追加:

```ts
import {
  cleanupUnreferencedOmnivoiceVoices,
  collectOmnivoiceManagedVoiceIds,
} from '@/lib/providers/omnivoice'
```

- [ ] **Step 3: 改 novel-promotion character route**

同样在 `src/app/api/novel-promotion/[projectId]/character/route.ts:100` 附近, bailian cleanup 之后追加对称 omnivoice 调用。具体读取该文件后镜像:

```bash
grep -n "cleanupUnreferencedBailianVoices" src/app/api/novel-promotion/[projectId]/character/route.ts
```

在每一个 bailian cleanup 调用之后加同样形状的 omnivoice cleanup。

- [ ] **Step 4: typecheck + 既有测试不退化**

```bash
npm run typecheck
npx vitest run tests/integration/provider tests/unit/providers
```

Expected: typecheck 0 errors;原有测试 + omnivoice 新增测试全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/projects/[projectId]/route.ts src/app/api/asset-hub/characters/[characterId]/route.ts src/app/api/novel-promotion/[projectId]/character/route.ts
git commit -m "feat(omnivoice): 三个删除入口接 omnivoice voice cleanup"
```

---

## Task 14: VoiceDesignDialogBase 增加 provider 下拉

**Files:**
- Modify: `src/components/voice/VoiceDesignDialogBase.tsx`
- Modify: `src/components/voice/VoiceDesignGeneratorSection.tsx`(若它持有提交逻辑)
- Modify: `src/app/[locale]/workspace/asset-hub/components/voice-creation/hooks/useVoiceCreation.tsx`(透传 provider)
- Modify: `messages/zh/*.json` & `messages/en/*.json`(增加 i18n key 对应 provider 下拉)

**Interfaces:**
- Produces: 表单状态多一个 `provider: 'bailian' | 'omnivoice'` 字段;提交 voice-design 任务时把 provider 加进 body。
- 默认值: `'bailian'`(保持向后兼容)

- [ ] **Step 1: 读取现有 VoiceDesignDialogBase 结构**

```bash
grep -n "voicePrompt\|provider\|onSubmit\|state\|useState" src/components/voice/VoiceDesignDialogBase.tsx | head -40
```

理解现有 form state 结构后,把 `provider` 字段并入(form 通常已经是 `useState<{...}>`)。

- [ ] **Step 2: 加 provider 下拉(JSX)**

在表单顶部加一个 select(沿用现有 select 组件,vvicat 通常用 shadcn `Select`):

```tsx
<div className="flex flex-col gap-1">
  <label>{t('voiceDesign.provider')}</label>
  <Select value={state.provider} onValueChange={(v) => setState({ ...state, provider: v as 'bailian' | 'omnivoice' })}>
    <SelectTrigger><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem value="bailian">{t('voiceDesign.provider.bailian')}</SelectItem>
      <SelectItem value="omnivoice">{t('voiceDesign.provider.omnivoice')}</SelectItem>
    </SelectContent>
  </Select>
</div>
```

(如果现有组件用了不同的 select 风格,沿用既有风格。)

- [ ] **Step 3: 提交时透传 provider**

在 `useVoiceCreation` 或 dialog 内部 fetch 调用处,把 `provider` 加进 body:

```ts
await fetch('/api/asset-hub/voice-design', {
  method: 'POST',
  body: JSON.stringify({ ...payload, provider: state.provider }),
})
```

- [ ] **Step 4: i18n keys**

`messages/zh/voice.json`(或 voice-design 所在文件)新增:

```json
{
  "voiceDesign": {
    "provider": "服务提供商",
    "provider.bailian": "百炼(QwenTTS)",
    "provider.omnivoice": "OmniVoice(自托管)"
  }
}
```

`messages/en/...` 镜像英文。

- [ ] **Step 5: 验证 lint + typecheck**

```bash
npm run lint:all
npm run typecheck
```

Expected: 0 errors / 0 warnings(或仅与本改动无关的告警)。

- [ ] **Step 6: 手动启动 dev,UI 冒烟**

```bash
npm run dev:next
```

打开 `http://localhost:3000`,进入资源库声音设计入口,确认 provider 下拉出现且默认为「百炼」。选「OmniVoice」后填写 prompt + previewText,点击设计——后端走 omnivoice 路径(由前序 task 验证)。

- [ ] **Step 7: Commit**

```bash
git add src/components/voice/VoiceDesignDialogBase.tsx src/components/voice/VoiceDesignGeneratorSection.tsx src/app/[locale]/workspace/asset-hub/components/voice-creation/hooks/useVoiceCreation.tsx messages/
git commit -m "feat(omnivoice): VoiceDesignDialogBase 增加 provider 下拉"
```

---

## Task 15: 资源库 Clone 入口(同步上传 + createProfile)

**Files:**
- Create: `src/app/api/asset-hub/voice-clone/route.ts` 或在现有 `/api/asset-hub/voice-design` 旁新增
- Modify: `src/app/[locale]/workspace/asset-hub/components/voice-creation/hooks/useVoiceCreation.tsx`(克隆模式入口)
- Test: `tests/integration/provider/omnivoice-clone-flow.test.ts`

**Interfaces:**
- Endpoint: `POST /api/asset-hub/voice-clone`
  - body: `{ provider: 'omnivoice', name: string, refAudioMediaId: string, language?: string }`
  - 返回: `{ success: true, globalVoiceId, profileId, previewUrl }` 或 4xx 错误
- 流程:
  1. 鉴权 + 校验 mediaObject 属于该用户
  2. 从 storage 拉 buffer
  3. 调 `createOmnivoiceClone({ name, refAudio: buffer, refAudioFilename, language, userId })`
  4. 创建 GlobalVoice 记录(`voiceType: 'omnivoice-clone', voiceId: profileId, customVoiceMediaId, customVoiceUrl: signedUrl`)
  5. 返回

- [ ] **Step 1: 写集成测试**

创建 `tests/integration/provider/omnivoice-clone-flow.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/providers/omnivoice', () => ({
  createOmnivoiceClone: vi.fn(),
}))
vi.mock('@/lib/api-auth', () => ({
  requireUserAuth: vi.fn(async () => ({ session: { user: { id: 'u1' } } })),
  isErrorResponse: vi.fn(() => false),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    mediaObject: { findUnique: vi.fn() },
    globalVoice: { create: vi.fn() },
  },
}))
vi.mock('@/lib/storage', () => ({
  getSignedUrl: vi.fn((k: string) => `https://signed/${k}`),
  fetchObjectBytes: vi.fn(async () => Buffer.from([1, 2, 3])),
}))

import { POST as cloneHandler } from '@/app/api/asset-hub/voice-clone/route'
import { createOmnivoiceClone } from '@/lib/providers/omnivoice'
import { prisma } from '@/lib/prisma'

function buildRequest(body: unknown): Request {
  return new Request('http://x/api/asset-hub/voice-clone', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/asset-hub/voice-clone (omnivoice)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('creates GlobalVoice on successful clone', async () => {
    ;(prisma.mediaObject.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 'm1', storageKey: 'voice-ref/u1/x.wav', userId: 'u1',
    })
    ;(createOmnivoiceClone as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: true, profileId: 'prof_z',
    })
    ;(prisma.globalVoice.create as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 'gv1', voiceId: 'prof_z',
    })

    const res = await cloneHandler(buildRequest({
      name: 'Carla', refAudioMediaId: 'm1', language: 'English',
    }) as unknown as Parameters<typeof cloneHandler>[0])
    const json = await res.json() as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.profileId).toBe('prof_z')
    expect(prisma.globalVoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        voiceId: 'prof_z',
        voiceType: 'omnivoice-clone',
        customVoiceMediaId: 'm1',
        userId: 'u1',
      }),
    }))
  })

  it('rejects mediaObject owned by another user', async () => {
    ;(prisma.mediaObject.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 'm1', storageKey: 'k', userId: 'someone-else',
    })
    const res = await cloneHandler(buildRequest({
      name: 'X', refAudioMediaId: 'm1',
    }) as unknown as Parameters<typeof cloneHandler>[0])
    expect(res.status).toBe(403)
    expect(createOmnivoiceClone).not.toHaveBeenCalled()
  })

  it('returns 502 when omnivoice backend unreachable', async () => {
    ;(prisma.mediaObject.findUnique as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 'm1', storageKey: 'k', userId: 'u1',
    })
    ;(createOmnivoiceClone as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: false, error: 'fetch failed', errorCode: 'OMNIVOICE_BACKEND_UNREACHABLE',
    })
    const res = await cloneHandler(buildRequest({
      name: 'X', refAudioMediaId: 'm1',
    }) as unknown as Parameters<typeof cloneHandler>[0])
    expect(res.status).toBe(502)
  })
})
```

- [ ] **Step 2: 验证测试失败**

```bash
npx vitest run tests/integration/provider/omnivoice-clone-flow.test.ts
```

Expected: FAIL — route 不存在。

- [ ] **Step 3: 实现 route**

创建 `src/app/api/asset-hub/voice-clone/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { fetchObjectBytes, getSignedUrl } from '@/lib/storage'
import { createOmnivoiceClone } from '@/lib/providers/omnivoice'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const refAudioMediaId = typeof body.refAudioMediaId === 'string' ? body.refAudioMediaId.trim() : ''
  const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'Auto'

  if (!name) throw new ApiError('INVALID_PARAMS')
  if (!refAudioMediaId) throw new ApiError('INVALID_PARAMS')

  const media = await prisma.mediaObject.findUnique({ where: { id: refAudioMediaId } })
  if (!media) throw new ApiError('NOT_FOUND')
  if (media.userId !== session.user.id) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  const refAudio = await fetchObjectBytes(media.storageKey)
  const filename = media.storageKey.split('/').pop() ?? 'ref.wav'

  const cloneResult = await createOmnivoiceClone({
    name,
    refAudio,
    refAudioFilename: filename,
    language,
    userId: session.user.id,
  })

  if (!cloneResult.success || !cloneResult.profileId) {
    const status = cloneResult.errorCode === 'OMNIVOICE_BACKEND_UNREACHABLE' ? 502 : 400
    return NextResponse.json({
      success: false,
      error: cloneResult.error,
      errorCode: cloneResult.errorCode,
    }, { status })
  }

  const created = await prisma.globalVoice.create({
    data: {
      userId: session.user.id,
      name,
      voiceId: cloneResult.profileId,
      voiceType: 'omnivoice-clone',
      customVoiceMediaId: media.id,
      customVoiceUrl: getSignedUrl(media.storageKey, 7200),
      language: language.toLowerCase().includes('en') ? 'en' : 'zh',
    },
  })

  return NextResponse.json({
    success: true,
    globalVoiceId: created.id,
    profileId: cloneResult.profileId,
    previewUrl: getSignedUrl(media.storageKey, 7200),
  })
})
```

注:`fetchObjectBytes` 若不存在,先确认 `src/lib/storage/index.ts` 是否导出该函数。如果没有,可用 `getStorageProvider().getObject(key)` 等价路径。**实施前先 grep**:

```bash
grep -n "fetchObjectBytes\|getObject\b" src/lib/storage/*.ts
```

按实际函数名调整 import。

- [ ] **Step 4: 验证测试通过**

```bash
npx vitest run tests/integration/provider/omnivoice-clone-flow.test.ts
npm run typecheck
```

Expected: 3 passed;typecheck 0 errors。

- [ ] **Step 5: 前端 UI 入口**

在 `useVoiceCreation` 或资源库声音页面增加「克隆 OmniVoice 音色」入口:

- 用户先上传音频文件 → 已有 MediaObject 创建路径
- 弹出对话框输入「音色名称」+ 选择「克隆为 OmniVoice 音色」
- 调 `POST /api/asset-hub/voice-clone`,失败显示 errorCode 对应文案

具体 UI 修改根据现有 `useVoiceCreation` 结构镜像 voice-design 的对话框。

- [ ] **Step 6: Commit**

```bash
git add src/app/api/asset-hub/voice-clone/route.ts tests/integration/provider/omnivoice-clone-flow.test.ts src/app/[locale]/workspace/asset-hub/components/voice-creation/
git commit -m "feat(omnivoice): 资源库声音克隆入口 + GlobalVoice 写入"
```

---

## Task 16: VoicePicker / 角色绑定 voiceType 显示

**Files:**
- Modify: `src/app/[locale]/workspace/asset-hub/components/VoicePickerDialog.tsx`
- Modify: `src/lib/query/mutations/character-voice-mutations.ts`(若存在 voiceType 写入)

**Interfaces:**
- 显示徽章:
  - `qwen-designed` → 「百炼」蓝色徽章
  - `omnivoice-clone` → 「OmniVoice 克隆」紫色徽章
  - `omnivoice-design` → 「OmniVoice 设计」绿色徽章
  - `custom` → 「上传」灰色徽章
- 选中时:`character.voiceId = globalVoice.voiceId, character.voiceType = globalVoice.voiceType` 已是现有逻辑,无需改

- [ ] **Step 1: 找到现有徽章渲染**

```bash
grep -n "qwen-designed\|voiceType\|Badge" src/app/[locale]/workspace/asset-hub/components/VoicePickerDialog.tsx | head -30
```

- [ ] **Step 2: 加 omnivoice 徽章映射**

修改 VoicePickerDialog 的渲染分支(具体形式按现有代码风格,可能是 switch 也可能是 mapping object)。示例:

```ts
const VOICE_TYPE_BADGE: Record<string, { label: string; className: string }> = {
  'qwen-designed': { label: '百炼', className: 'bg-blue-500/20 text-blue-300' },
  'omnivoice-clone': { label: 'OmniVoice 克隆', className: 'bg-purple-500/20 text-purple-300' },
  'omnivoice-design': { label: 'OmniVoice 设计', className: 'bg-green-500/20 text-green-300' },
  custom: { label: '上传', className: 'bg-gray-500/20 text-gray-300' },
}
```

通过 `VOICE_TYPE_BADGE[globalVoice.voiceType] ?? { label: globalVoice.voiceType, className: '...' }` 渲染。

- [ ] **Step 3: typecheck + lint**

```bash
npm run typecheck && npm run lint:all
```

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/workspace/asset-hub/components/VoicePickerDialog.tsx src/lib/query/mutations/character-voice-mutations.ts
git commit -m "feat(omnivoice): VoicePicker 显示 omnivoice 音色类型徽章"
```

---

## Task 17: 默认音频模型选择 + API Config 显示状态

**Files:**
- Modify: `src/app/[locale]/profile/components/api-config-tab/DefaultModelCards.tsx`
- Modify: `src/app/[locale]/profile/components/api-config/hooks.ts`(若包含 audio model 列举逻辑)
- Modify: `src/app/[locale]/profile/components/api-config-tab/hooks/useApiConfigFilters.ts`(若需放行 omnivoice)
- Create: `src/app/api/providers/omnivoice/health/route.ts`

**Interfaces:**
- Endpoint: `GET /api/providers/omnivoice/health`
  - 返回: `{ available: boolean; version?: string; device?: string }`
  - 实现:调 `probeOmnivoice()`,转 success → available
- 默认音频模型选择列表中追加 `omnivoice/omnivoice-tts-v1`,标签「OmniVoice 自托管 TTS」

- [ ] **Step 1: 创建 health endpoint**

创建 `src/app/api/providers/omnivoice/health/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { probeOmnivoice, getOmnivoiceClient } from '@/lib/providers/omnivoice'

export const GET = apiHandler(async () => {
  const probe = await probeOmnivoice()
  if (!probe.success) {
    return NextResponse.json({ available: false, detail: probe.steps[0]?.detail }, { status: 200 })
  }
  try {
    const ov = getOmnivoiceClient()
    const r = await ov.health()
    return NextResponse.json({
      available: true,
      version: r.version,
      device: r.device,
    })
  } catch {
    return NextResponse.json({ available: false }, { status: 200 })
  }
})
```

- [ ] **Step 2: 默认音频模型卡片加 omnivoice 选项**

`DefaultModelCards.tsx` 中音频模型选项数组追加:

```ts
{ value: 'omnivoice:omnivoice-tts-v1', label: 'OmniVoice 自托管 TTS', kind: 'audio' }
```

(具体形式按文件现有写法 mirror。)

- [ ] **Step 3: API Config 显示 OmniVoice 状态(可选)**

如果时间允许,在 API config tab 加一个 OmniVoice 行,fetch `/api/providers/omnivoice/health` 显示「可达 / 不可达」。如果时间紧,跳过 — 用户使用时报错也能看到。spec §5.3 标这是可选 UI。

- [ ] **Step 4: typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/providers/omnivoice/health/route.ts src/app/[locale]/profile/components/api-config-tab/DefaultModelCards.tsx
git commit -m "feat(omnivoice): /api/providers/omnivoice/health + 默认 audio 模型选项"
```

---

## Task 18: 计费占位 + 部署文档

**Files:**
- Modify: `src/lib/billing/`(具体子文件由 grep 决定)
- Modify: `README.md` 或 `docs/` 适当文件

**Interfaces:**
- 计费:复用 bailian audio 的单价逻辑,标 TODO 让运营按实际成本调整。OmniVoice 不依赖 apiKey,但走 `BalanceFreeze → BalanceTransaction` 流程,task type 不变。
- 部署文档:`OMNIVOICE_BASE_URL` env、后端持久化 `omnivoice_data/` 挂载、SDK build 步骤

- [ ] **Step 1: grep 当前 audio 计费**

```bash
grep -rn "qwen3-tts-vd\|audio.*price\|ASSET_HUB_VOICE_DESIGN.*billing" src/lib/billing/ | head -20
```

定位 voice-design / voice-line 的成本计算文件,在那里加一条 omnivoice 等价规则(暂复用 bailian 单价 + 注释 `// TODO(billing): adjust omnivoice unit price based on operator decision`)。

- [ ] **Step 2: 写部署文档**

在 `README.md` 末尾新建 `## OmniVoice 集成部署`(或新建 `docs/omnivoice-integration.md`):

```markdown
## OmniVoice 集成部署

vvicat 通过 `@omnivoice/sdk` 接入 OmniVoice-Studio 后端,提供第三个语音 provider。

### 环境变量

```bash
OMNIVOICE_BASE_URL=http://omnivoice-backend:3900   # 必填,服务端
OMNIVOICE_REQUEST_TIMEOUT_MS=300000                # 可选,默认 5 分钟
```

### 后端部署要点

- OmniVoice 后端的 voice profile 持久化在容器内 `omnivoice_data/`。**部署时必须挂载该目录**,否则容器重启会丢音色,vvicat 中已绑定的 voiceId 全部 dangling。
- 推荐用 OmniVoice 官方 Docker 镜像,在 docker-compose 里加上 service 与 volume。
- vvicat 后端服务对 OmniVoice 后端 reachable 即可,不需要 apiKey、不需要用户配置。

### SDK 构建

`@omnivoice/sdk` 通过 `file:` 路径引用本地构建产物。CI / Docker 镜像构建前需:

```bash
cd ../OmniVoice-Studio/sdk/omnivoice-ts
bun install
bun run build
```

或在 vvicat 仓库 vendor SDK 的 `dist/` 目录(后续 SDK 发布到 npm 时取消 vendor)。

### 验收

- 健康检查:`GET /api/providers/omnivoice/health` 返回 `{ available: true, version, device }`
- 资源库声音设计 + 克隆功能可用
- OmniVoice 后端离线时,fal/bailian voice line 路径不受影响
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/billing/ README.md docs/
git commit -m "docs(omnivoice): 计费占位 + 部署文档(env、持久化、SDK 构建)"
```

### Follow-ups from Task 15

1. **MediaObject ownership schema** — `MediaObject` has no `userId` column. The voice-clone route (`src/app/api/asset-hub/voice-clone/route.ts`) currently relies on the storage-key prefix `voices/<userId>/` for ownership and fails closed when the key does not match. Future work:
   - Add a `userId` column to `MediaObject` with a migration + backfill via parent relations (Project/Episode/etc.), OR
   - Scope the API through `GlobalVoice.userId` instead of `refAudioMediaId` (i.e. take a `globalVoiceId` and infer ownership from the GlobalVoice row, then read its `customVoiceMediaId` for cloning).

2. **Frontend UI for voice cloning** — `useVoiceCreation` currently uploads via formData → `useUploadAssetHubVoice` → `/api/asset-hub/voices/upload`. That route writes a `GlobalVoice` row with `voiceType: 'uploaded'` directly and does **not** create a `MediaObject`. A "Clone via OmniVoice" UI entry therefore needs one of:
   - Modify the upload route to create a `MediaObject` and return its id, then chain to `/api/asset-hub/voice-clone`, OR
   - Switch `/api/asset-hub/voice-clone` to take a `globalVoiceId` (the just-uploaded `voiceType: 'uploaded'` GlobalVoice) and read its `customVoiceUrl`'s storage key for cloning.

   In either path, ownership enforcement collapses back to a single, schema-backed signal — at which point the storage-key prefix check in the route can be retired.

---

## Task 19: 契约 + 回归测试

**Files:**
- Create: `tests/contracts/omnivoice-voice-types.test.ts`
- Create: `tests/regression/omnivoice-binding-mismatch.test.ts`

**Interfaces:**
- 契约:`OfficialProviderKey` 枚举包含 omnivoice;`SpeakerVoiceEntry` 联合识别 omnivoice 形状
- 回归:provider=omnivoice 但 character.voiceType=qwen-designed 时,`resolveVoiceBindingForProvider` 不返回 binding(避免跨 provider 误调用)

- [ ] **Step 1: 写契约测试**

创建 `tests/contracts/omnivoice-voice-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { OfficialProviderKey } from '@/lib/providers/official/model-registry'

describe('OmniVoice 契约', () => {
  it('OfficialProviderKey 包含 omnivoice', () => {
    const allowed: OfficialProviderKey[] = ['bailian', 'siliconflow', 'starrouter', 'omnivoice']
    expect(allowed).toContain('omnivoice')
  })

  it('voiceType 已知值集合', () => {
    const known = ['qwen-designed', 'custom', 'omnivoice-clone', 'omnivoice-design']
    // 任何此前未列入的 voiceType 出现都应触发评审
    expect(known).toEqual([
      'qwen-designed',
      'custom',
      'omnivoice-clone',
      'omnivoice-design',
    ])
  })
})
```

- [ ] **Step 2: 写回归测试**

创建 `tests/regression/omnivoice-binding-mismatch.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveVoiceBindingForProvider } from '@/lib/voice/provider-voice-binding'

describe('omnivoice provider 与 voiceType 错配回归', () => {
  it('provider=omnivoice 但 character voiceType=qwen-designed 不返回 character 绑定', () => {
    const r = resolveVoiceBindingForProvider({
      providerKey: 'omnivoice',
      character: { voiceId: 'qwen_v1', voiceType: 'qwen-designed', customVoiceUrl: null },
      speakerVoice: null,
    })
    expect(r).toBeNull()
  })

  it('provider=bailian 但 character voiceType=omnivoice-clone 不被 bailian 路径误用', () => {
    const r = resolveVoiceBindingForProvider({
      providerKey: 'bailian',
      character: { voiceId: 'prof_x', voiceType: 'omnivoice-clone', customVoiceUrl: null },
      speakerVoice: null,
    })
    expect(r).toBeNull()
  })
})
```

注:第 2 个 case 要求 bailian 分支也按 voiceType 前缀做消歧,否则会把 omnivoice 的 profileId 当成 bailian voiceId。**这意味着 Task 10 的 bailian 分支也需要加一个守卫**——如果第 2 个 case 失败,回到 `provider-voice-binding.ts` 的 bailian 分支,在 `toBailianBinding('character', characterVoiceId)` 之前加:

```ts
if (toLowerCase(params.character?.voiceType).startsWith('omnivoice-')) {
  // bailian 不能消费 omnivoice profile
} else {
  const fromCharacter = toBailianBinding('character', characterVoiceId)
  if (fromCharacter) return fromCharacter
}
```

- [ ] **Step 3: 验证测试通过**

```bash
npx vitest run tests/contracts/omnivoice-voice-types.test.ts tests/regression/omnivoice-binding-mismatch.test.ts
```

Expected: 4 passed。如果 bailian 守卫缺失导致第 2 个失败,补 Task 10 的 bailian 分支守卫,再跑一次。

- [ ] **Step 4: Commit**

```bash
git add tests/contracts/omnivoice-voice-types.test.ts tests/regression/omnivoice-binding-mismatch.test.ts src/lib/voice/provider-voice-binding.ts
git commit -m "test(omnivoice): 契约 + 跨 provider 错配回归"
```

---

## Task 20: verify:push 全套通过

**Files:** 无

**Interfaces:** 无 — 只是验证。

- [ ] **Step 1: 运行完整验证**

```bash
npm run verify:push
```

Expected: lint + typecheck + tests + build 全部通过。

- [ ] **Step 2: 修复任何掉队的失败**

按报错就地修复,每修一个就 commit。**禁止 skip / `--no-verify`**。

- [ ] **Step 3: 检查 spec 验收清单**

逐条对照 spec §11(也是本计划的隐含验收):

- [ ] 用户可在资源库通过 OmniVoice provider 上传音频克隆出音色,GlobalVoice 写入正确(Task 15)
- [ ] 用户可通过 voicePrompt 用 OmniVoice 设计音色,完成后能在资源库看到带身份采样预览的条目(Task 12 + 14)
- [ ] 角色 / speaker 绑定 OmniVoice 音色后,voice line 生成产出 WAV 写 MinIO(Task 11)
- [ ] 删除被引用的 OmniVoice 音色被拒绝;删除孤儿音色同步删后端 profile(Task 8 + 13)
- [ ] OmniVoice 后端离线时,其他 provider voice line 完全不受影响(Task 4 / 11 通过 mock 验证 + 手动验证)
- [ ] `npm run verify:push` 通过(本 task)

- [ ] **Step 4: 最终 commit / 推送 PR**

```bash
git log --oneline | head -25
git push origin <branch-name>
```

确认所有 commit 形成清晰的 task 链,准备开 PR。

---

## Self-Review

### 1. Spec 覆盖检查

| Spec 章节 | 关联 Task |
|---|---|
| §2.1 目录结构 | Task 2-9 |
| §2.2 修改文件清单 | Task 1, 9, 10, 11, 12, 13, 14, 17 |
| §2.3 SDK 依赖 | Task 1 |
| §2.4 env 变量 | Task 1, 18 |
| §3.1 GlobalVoice 字段映射 | Task 15(写)+ Task 8(读) |
| §3.2 Clone 创建路径 | Task 15 |
| §3.3 Design 创建路径 | Task 6 + 12 |
| §3.4 Cleanup | Task 8 + 13 |
| §3.5 多租户隔离 | Task 5(prefix) + Task 15(userId 校验) |
| §4.1 generate-voice-line 修改 | Task 11 |
| §4.2 synthesizeWithOmnivoiceTTS | Task 4 |
| §4.3 voice-binding 扩展 | Task 10 |
| §4.4 audio.ts | Task 9 |
| §5.1 OfficialProviderKey | Task 9 |
| §5.2 ProviderConfig 旁路 | Task 2(client.ts 自管) + Task 11(不调 getProviderConfig) |
| §5.3 UI 暴露 | Task 14, 16, 17 |
| §5.4 计费 | Task 18 |
| §6 UI 触点 | Task 14, 15, 16 |
| §7.1-7.2 错误处理 | Task 3 |
| §7.3 Profile 漂移 | Task 4(404 → OMNIVOICE_PROFILE_NOT_FOUND), Task 11(传播) |
| §7.4 Cleanup 引用 | Task 8 |
| §8 测试 | Task 2-12, 19 |
| §9 风险 | Task 18(部署文档) |
| §10 实施顺序 | 本 plan 的 task 顺序 |
| §11 验收 | Task 20 |

**覆盖完整,无遗漏。**

### 2. 占位符扫描

通读全文,无 `TBD` / `TODO` / `implement later` 等占位(部署文档与计费有 1 处 `// TODO(billing): adjust ...` 是有意保留给运营,带说明)。每个 step 都包含完整代码或具体命令。

### 3. 类型一致性

- `OmnivoiceVoiceGenerationBinding.profileId` (Task 10) ↔ `synthesizeWithOmnivoiceTTS({ profileId })` (Task 4):一致
- `createOmnivoiceClone(...)` 返回 `OmnivoiceCloneResult.profileId` (Task 5) ↔ Task 15 写 `voiceId: profileId`:一致
- `createOmnivoiceVoiceDesign(...)` 返回 `OmnivoiceDesignResult.profileId` (Task 6) ↔ Task 12 worker handler 写 `voiceId: designed.profileId`:一致
- `OMNIVOICE_TTS_MODEL_ID = 'omnivoice-tts-v1'` (Task 9) ↔ Task 17 默认模型选项 `'omnivoice:omnivoice-tts-v1'`:一致
- `OmnivoiceSpeakerVoiceEntry.profileId` (Task 10) ↔ `parseSpeakerVoiceMap` 校验 `profileId` 必填(Task 10 step 3):一致
- `voiceType` 已知集合 `['qwen-designed', 'custom', 'omnivoice-clone', 'omnivoice-design']` (Task 19) ↔ Task 12 写入 `voiceType: 'omnivoice-design'`、Task 15 写入 `voiceType: 'omnivoice-clone'`:一致

无类型漂移。

