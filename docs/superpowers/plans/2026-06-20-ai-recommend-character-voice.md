# AI 推荐人物语音 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 novel-promotion 角色加「AI 推荐语音」功能 —— LLM 读角色 profileData,输出 OmniVoice 受控词表标签,自动填入声音设计描述框供用户生成多方案试听。

**Architecture:** LLM 推荐与音频生成解耦。LLM 出标签是一个独立的 text-worker task(`CHARACTER_VOICE_RECOMMEND`),返回合法 instruct 字符串(三层兜底:prompt 给词表 → validateOmnivoiceInstruct 过滤 → profileData 兜底);前端拿到标签后填入现有 voice-design 流程,预览生成/试听/绑定全部复用现有代码。遵守 `no-api-direct-llm-call` guard(LLM 只在 worker 里调)。

**Tech Stack:** Next.js 15 + TypeScript / BullMQ text worker / executeAiTextStep + prompt-i18n / Prisma(零 schema 改动)/ Vitest

## Global Constraints

- **零 schema 改动**:`prisma/schema.prisma` 不变;读现有 `NovelPromotionCharacter.profileData`。
- **仅 novel-promotion 角色**:不接 asset-hub 全局角色。
- **LLM 只出标签,不产音频**:LLM task 返回 instruct 字符串,音频生成复用现有 voice-design 前端循环。
- **LLM 必须走 worker**:`no-api-direct-llm-call` guard 禁止 API 路由直接调 LLM。
- **复用项目分析 LLM**:`resolveAnalysisModel`,不新增模型配置项。
- **三层兜底永远产出合法 instruct**:prompt 词表约束 → `validateOmnivoiceInstruct` 过滤 → profileData(gender/age)兜底。
- **复用现有 voice-design UI**:多方案生成/试听/绑定不改;AI 推荐只负责 `setVoicePrompt(instruct)`。
- **OmniVoice 词表**:复用 `src/lib/providers/omnivoice/instruct-vocabulary.ts`(`OMNIVOICE_ZH_VOCABULARY` / `validateOmnivoiceInstruct`)。
- **路径用 `@/` 别名**(测试),源文件相对 import 与现有 omnivoice 包一致。
- **TDD,频繁提交**。typecheck 基线 26 错误(全在 `tests/unit/components/art-style-library/ArtStyleEditor.test.tsx`),改动后须保持 26。

---

## File Structure

新建:

| 路径 | 责任 |
|---|---|
| `src/lib/providers/omnivoice/instruct-recommend.ts` | 纯逻辑:LLM 输出解析 + profileData 兜底映射 → 合法 instruct |
| `src/lib/workers/handlers/character-voice-recommend.ts` | BullMQ handler:读 character → 调 LLM → 解析兜底 → 返回 instruct |
| `src/app/api/novel-promotion/[projectId]/character/[characterId]/recommend-voice-instruct/route.ts` | 提交 CHARACTER_VOICE_RECOMMEND task |
| `lib/prompts/novel-promotion/character_voice_recommend.zh.txt` | 中文 prompt 模板 |
| `lib/prompts/novel-promotion/character_voice_recommend.en.txt` | 英文 prompt 模板 |
| `tests/unit/providers/omnivoice/instruct-recommend.test.ts` | 解析+兜底单测 |
| `tests/integration/api/specific/character-voice-recommend-route.test.ts` | route 提交 task 测试 |

修改:

| 路径 | 改动 |
|---|---|
| `src/lib/task/types.ts` | 加 `CHARACTER_VOICE_RECOMMEND: 'character_voice_recommend'` |
| `src/lib/prompt-i18n/prompt-ids.ts` | 加 `NP_CHARACTER_VOICE_RECOMMEND: 'np_character_voice_recommend'` |
| `src/lib/prompt-i18n/catalog.ts` | 加 catalog 条目(pathStem + variableKeys) |
| `src/lib/workers/text.worker.ts` | 注册新 task type → handler |
| `src/lib/billing/task-policy.ts` | CHARACTER_VOICE_RECOMMEND 进 BILLABLE + 文本分析 case 组 |
| `src/lib/providers/omnivoice/index.ts` | re-export recommend 函数 |
| `src/lib/query/mutations/useVoiceMutations.ts` | 加 `useRecommendVoiceInstruct(projectId, characterId)` |
| `src/components/voice/VoiceDesignDialogBase.tsx` | 加可选 `onRecommendInstruct` prop + 「AI 推荐语音」按钮 |
| `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/voice/VoiceDesignDialog.tsx` | 透传 characterId + 构造 onRecommendInstruct |
| 调用 VoiceDesignDialog 的角色卡片组件 | 传 characterId |
| `messages/zh/voice.json` + `messages/en/voice.json` | AI 推荐按钮 + 状态文案 |

不动:`prisma/schema.prisma`、`instruct-vocabulary.ts`、现有 voice-design 多方案 UI/循环。

---

## Task 1: instruct-recommend 纯逻辑(解析 + profileData 兜底)

**Files:**
- Create: `src/lib/providers/omnivoice/instruct-recommend.ts`
- Test: `tests/unit/providers/omnivoice/instruct-recommend.test.ts`

**Interfaces:**
- Consumes: `validateOmnivoiceInstruct` from `./instruct-vocabulary` (existing), `CharacterProfileData` from `@/types/character-profile` (existing)
- Produces:
  - `interface RecommendInstructResult { instruct: string; source: 'llm' | 'fallback' }`
  - `parseAndValidateRecommendation(llmOutput: string, profileData: CharacterProfileData | null): RecommendInstructResult`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/providers/omnivoice/instruct-recommend.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseAndValidateRecommendation } from '@/lib/providers/omnivoice/instruct-recommend'
import type { CharacterProfileData } from '@/types/character-profile'

function profile(overrides: Partial<CharacterProfileData> = {}): CharacterProfileData {
  return {
    role_level: 'A',
    archetype: '霸道总裁',
    personality_tags: ['沉稳', '强势'],
    era_period: '现代',
    social_class: '上流',
    costume_tier: 3,
    suggested_colors: [],
    visual_keywords: [],
    gender: '男',
    age_range: '中年',
    ...overrides,
  }
}

describe('parseAndValidateRecommendation', () => {
  it('returns llm source when LLM output is fully valid', () => {
    const r = parseAndValidateRecommendation('男、中年、低音调', profile())
    expect(r).toEqual({ instruct: '男、中年、低音调', source: 'llm' })
  })

  it('keeps valid tokens, drops invalid ones (still llm source)', () => {
    // 「磁性」越表,validateOmnivoiceInstruct 会判 UNKNOWN_TOKEN → 整体不合法 → 走兜底
    // 因此该用例验证:有越表词时整体走 fallback(validateOmnivoiceInstruct 是全有或全无)
    const r = parseAndValidateRecommendation('男、磁性', profile())
    expect(r.source).toBe('fallback')
    expect(r.instruct).toBe('男、中年')
  })

  it('falls back to profileData gender+age when LLM output all invalid', () => {
    const r = parseAndValidateRecommendation('磁性、浑厚', profile({ gender: '男', age_range: '中年' }))
    expect(r).toEqual({ instruct: '男、中年', source: 'fallback' })
  })

  it('falls back when LLM output is empty', () => {
    const r = parseAndValidateRecommendation('', profile({ gender: '女', age_range: '青年' }))
    expect(r).toEqual({ instruct: '女、青年', source: 'fallback' })
  })

  it('falls back when LLM mixes languages', () => {
    const r = parseAndValidateRecommendation('男, male', profile({ gender: '男', age_range: '老年' }))
    expect(r).toEqual({ instruct: '男、老年', source: 'fallback' })
  })

  it('falls back to 男、青年 when profileData is null', () => {
    const r = parseAndValidateRecommendation('磁性', null)
    expect(r).toEqual({ instruct: '男、青年', source: 'fallback' })
  })

  it('maps English-ish gender/age in profileData', () => {
    const r = parseAndValidateRecommendation('xxx', profile({ gender: 'female', age_range: 'young adult' }))
    expect(r).toEqual({ instruct: '女、青年', source: 'fallback' })
  })

  it('maps child / teenager / elderly age ranges', () => {
    expect(parseAndValidateRecommendation('xx', profile({ gender: '男', age_range: '儿童' })).instruct).toBe('男、儿童')
    expect(parseAndValidateRecommendation('xx', profile({ gender: '男', age_range: '少年' })).instruct).toBe('男、少年')
    expect(parseAndValidateRecommendation('xx', profile({ gender: '男', age_range: '老年人' })).instruct).toBe('男、老年')
  })

  it('defaults gender to 男 and age to 青年 when profileData fields are unrecognized', () => {
    const r = parseAndValidateRecommendation('xx', profile({ gender: '不明', age_range: '不明' }))
    expect(r).toEqual({ instruct: '男、青年', source: 'fallback' })
  })
})
```

- [ ] **Step 2: 验证失败**

```bash
npx vitest run --root . --exclude '**/.claude/**' tests/unit/providers/omnivoice/instruct-recommend.test.ts
```
Expected: FAIL — 模块未找到。

- [ ] **Step 3: 实现 instruct-recommend.ts**

创建 `src/lib/providers/omnivoice/instruct-recommend.ts`:

```ts
import { validateOmnivoiceInstruct } from './instruct-vocabulary'
import type { CharacterProfileData } from '@/types/character-profile'

export interface RecommendInstructResult {
  /** 规范化后的合法 OmniVoice instruct,如 "男、中年、低音调"。 */
  instruct: string
  /** llm = LLM 输出合法直接用;fallback = LLM 不可用,由 profileData 兜底。 */
  source: 'llm' | 'fallback'
}

function mapGender(gender: string | undefined): '男' | '女' {
  const g = (gender ?? '').toLowerCase()
  if (g.includes('女') || g.includes('female') || g.includes('woman')) return '女'
  return '男'
}

function mapAge(ageRange: string | undefined): '儿童' | '少年' | '青年' | '中年' | '老年' {
  const a = (ageRange ?? '').toLowerCase()
  if (a.includes('儿童') || a.includes('child') || a.includes('kid')) return '儿童'
  if (a.includes('少年') || a.includes('teen')) return '少年'
  if (a.includes('青年') || a.includes('young')) return '青年'
  if (a.includes('中年') || a.includes('middle')) return '中年'
  if (a.includes('老') || a.includes('elder') || a.includes('senior')) return '老年'
  return '青年'
}

function fallbackInstruct(profileData: CharacterProfileData | null): string {
  if (!profileData) return '男、青年'
  return `${mapGender(profileData.gender)}、${mapAge(profileData.age_range)}`
}

/**
 * 把 LLM 的声音特征输出解析成合法的 OmniVoice instruct。
 *
 * - LLM 输出经 validateOmnivoiceInstruct 校验:合法 → 直接用(source=llm)。
 * - 不合法(越表/空/中英混用)→ 用 profileData 的 gender+age 兜底(source=fallback)。
 * - 兜底永远产出合法 instruct,保证下游 OmniVoice 调用不会因 instruct 非法失败。
 */
export function parseAndValidateRecommendation(
  llmOutput: string,
  profileData: CharacterProfileData | null,
): RecommendInstructResult {
  const validation = validateOmnivoiceInstruct(llmOutput)
  if (validation.ok) {
    return { instruct: validation.normalized, source: 'llm' }
  }
  return { instruct: fallbackInstruct(profileData), source: 'fallback' }
}
```

- [ ] **Step 4: 验证通过**

```bash
npx vitest run --root . --exclude '**/.claude/**' tests/unit/providers/omnivoice/instruct-recommend.test.ts
```
Expected: 9 passed。

- [ ] **Step 5: typecheck 基线**

```bash
npm run typecheck 2>&1 | grep -cE "^[a-z].*error TS"
```
Expected: 26。

- [ ] **Step 6: Commit**

```bash
git add src/lib/providers/omnivoice/instruct-recommend.ts tests/unit/providers/omnivoice/instruct-recommend.test.ts
git commit -m "feat(omnivoice): instruct-recommend 解析 + profileData 兜底纯逻辑"
```

---

## Task 2: PROMPT_ID + catalog + prompt 模板

**Files:**
- Modify: `src/lib/prompt-i18n/prompt-ids.ts`
- Modify: `src/lib/prompt-i18n/catalog.ts`
- Create: `lib/prompts/novel-promotion/character_voice_recommend.zh.txt`
- Create: `lib/prompts/novel-promotion/character_voice_recommend.en.txt`

**Interfaces:**
- Produces: `PROMPT_IDS.NP_CHARACTER_VOICE_RECOMMEND` (= `'np_character_voice_recommend'`), catalog 条目 pathStem `novel-promotion/character_voice_recommend`,variableKeys `['name','gender','age_range','archetype','personality_tags','occupation','social_class','era_period','vocabulary']`

- [ ] **Step 1: 加 PROMPT_ID**

修改 `src/lib/prompt-i18n/prompt-ids.ts`,在 `NP_VOICE_ANALYSIS` 行后加:

```ts
  NP_CHARACTER_VOICE_RECOMMEND: 'np_character_voice_recommend',
```

- [ ] **Step 2: 加 catalog 条目**

修改 `src/lib/prompt-i18n/catalog.ts`,在 `[PROMPT_IDS.NP_VOICE_ANALYSIS]` 条目后加:

```ts
  [PROMPT_IDS.NP_CHARACTER_VOICE_RECOMMEND]: {
    pathStem: 'novel-promotion/character_voice_recommend',
    variableKeys: [
      'name',
      'gender',
      'age_range',
      'archetype',
      'personality_tags',
      'occupation',
      'social_class',
      'era_period',
      'vocabulary',
    ],
  },
```

- [ ] **Step 3: 写中文 prompt 模板**

创建 `lib/prompts/novel-promotion/character_voice_recommend.zh.txt`:

```
你是资深配音导演。根据角色档案,从 OmniVoice 受控词表中挑选最贴合该角色的声音特征标签。

【可选词表(只能从这里面选,不得自创)】
{vocabulary}

【硬性规则】
1. 性别:必选 1 个(男 或 女)。
2. 年龄:必选 1 个(儿童/少年/青年/中年/老年)。
3. 音调:建议选 1 个(极低音调/低音调/中音调/高音调/极高音调/耳语),贴合角色气质。
4. 口音/方言:默认不选;仅当角色档案明确暗示某地域方言时才选。
5. 只能输出词表里的词,用「、」分隔。
6. 只输出标签字符串,不要任何解释、不要 markdown、不要换行。

【角色档案】
角色名:{name}
性别:{gender}
年龄段:{age_range}
原型:{archetype}
性格:{personality_tags}
职业:{occupation}
社会阶层:{social_class}
时代背景:{era_period}

【输出示例】
男、中年、低音调

现在输出该角色的声音特征标签:
```

- [ ] **Step 4: 写英文 prompt 模板**

创建 `lib/prompts/novel-promotion/character_voice_recommend.en.txt`:

```
You are a senior voice-casting director. Based on the character profile, pick the voice-feature tags that best fit this character from the OmniVoice controlled vocabulary.

[Allowed vocabulary (choose ONLY from these, do not invent)]
{vocabulary}

[Hard rules]
1. Gender: pick exactly 1.
2. Age: pick exactly 1.
3. Pitch: suggest picking 1, matching the character's temperament.
4. Accent/dialect: skip by default; pick only if the profile clearly implies a regional dialect.
5. Output only words from the vocabulary, separated by the "、" character.
6. Output ONLY the tag string — no explanation, no markdown, no line breaks.

[Character profile]
Name: {name}
Gender: {gender}
Age range: {age_range}
Archetype: {archetype}
Personality: {personality_tags}
Occupation: {occupation}
Social class: {social_class}
Era: {era_period}

[Output example]
male, middle-aged, low pitch

Now output the voice-feature tags for this character:
```

- [ ] **Step 5: 验证 prompt-i18n guard + typecheck**

```bash
npm run check:prompt-i18n 2>&1 | tail -5
npm run typecheck 2>&1 | grep -cE "^[a-z].*error TS"
```
Expected: prompt-i18n guard 通过(新 PROMPT_ID 有中英模板);typecheck 26。

- [ ] **Step 6: Commit**

```bash
git add src/lib/prompt-i18n/prompt-ids.ts src/lib/prompt-i18n/catalog.ts lib/prompts/novel-promotion/character_voice_recommend.zh.txt lib/prompts/novel-promotion/character_voice_recommend.en.txt
git commit -m "feat(prompt): NP_CHARACTER_VOICE_RECOMMEND prompt 模板(中英)"
```

---

## Task 3: task type + 计费

**Files:**
- Modify: `src/lib/task/types.ts`
- Modify: `src/lib/billing/task-policy.ts`

**Interfaces:**
- Produces: `TASK_TYPE.CHARACTER_VOICE_RECOMMEND` (= `'character_voice_recommend'`); 该 task type 走文本分析计费(`buildTextTaskInfo`)

- [ ] **Step 1: 加 TASK_TYPE**

修改 `src/lib/task/types.ts`,在 `CHARACTER_PROFILE_CONFIRM` 行附近加:

```ts
  CHARACTER_VOICE_RECOMMEND: 'character_voice_recommend',
```

- [ ] **Step 2: 加计费(BILLABLE + 文本分析 case)**

修改 `src/lib/billing/task-policy.ts`:

(a) 在 `BILLABLE_TASK_TYPES` 集合里(开头 ~32-40 行那组 `TASK_TYPE.VOICE_ANALYZE` 等)加:

```ts
  TASK_TYPE.CHARACTER_VOICE_RECOMMEND,
```

(b) 在 `buildDefaultTaskBillingInfo` 的文本分析 case 组里(`case TASK_TYPE.VOICE_ANALYZE:` 那一组,~288 行)加:

```ts
    case TASK_TYPE.CHARACTER_VOICE_RECOMMEND:
```

(放在 `case TASK_TYPE.VOICE_ANALYZE:` 同组,让它落到 `buildTextTaskInfo(taskType, payload)` 返回。)

- [ ] **Step 3: 写计费断言测试**

创建 `tests/unit/billing/character-voice-recommend-billing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildDefaultTaskBillingInfo, isBillableTaskType } from '@/lib/billing/task-policy'
import { TASK_TYPE } from '@/lib/task/types'

describe('CHARACTER_VOICE_RECOMMEND billing', () => {
  it('is a billable task type', () => {
    expect(isBillableTaskType(TASK_TYPE.CHARACTER_VOICE_RECOMMEND)).toBe(true)
  })

  it('produces a billable text-task billing info', () => {
    const info = buildDefaultTaskBillingInfo(TASK_TYPE.CHARACTER_VOICE_RECOMMEND, {})
    expect(info).not.toBeNull()
    expect(info?.billable).toBe(true)
    expect(info?.apiType).toBe('text')
  })
})
```

- [ ] **Step 4: 验证**

```bash
npx vitest run --root . --exclude '**/.claude/**' tests/unit/billing/character-voice-recommend-billing.test.ts
npm run typecheck 2>&1 | grep -cE "^[a-z].*error TS"
```
Expected: 2 passed;typecheck 26。

注:若 `buildTextTaskInfo` 的 `apiType` 不是 `'text'`(读 `task-policy.ts` 确认实际值),把断言改成实际值。

- [ ] **Step 5: Commit**

```bash
git add src/lib/task/types.ts src/lib/billing/task-policy.ts tests/unit/billing/character-voice-recommend-billing.test.ts
git commit -m "feat(task): CHARACTER_VOICE_RECOMMEND task type + 文本分析计费"
```

---

## Task 4: worker handler

**Files:**
- Create: `src/lib/workers/handlers/character-voice-recommend.ts`
- Modify: `src/lib/workers/text.worker.ts`
- Modify: `src/lib/providers/omnivoice/index.ts`

**Interfaces:**
- Consumes: `parseAndValidateRecommendation` (Task 1), `OMNIVOICE_ZH_VOCABULARY` (existing), `PROMPT_IDS.NP_CHARACTER_VOICE_RECOMMEND` (Task 2), `TASK_TYPE.CHARACTER_VOICE_RECOMMEND` (Task 3)
- Produces:
  - `handleCharacterVoiceRecommendTask(job: Job<TaskJobData>): Promise<{ success: true; instruct: string; source: 'llm' | 'fallback' }>`

- [ ] **Step 1: re-export recommend 函数**

修改 `src/lib/providers/omnivoice/index.ts`,在 instruct-vocabulary 导出附近加:

```ts
export { parseAndValidateRecommendation } from './instruct-recommend'
export type { RecommendInstructResult } from './instruct-recommend'
```

- [ ] **Step 2: 写 handler**

创建 `src/lib/workers/handlers/character-voice-recommend.ts`:

```ts
import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { buildPromptAsync, PROMPT_IDS } from '@/lib/prompt-i18n'
import { parseProfileData } from '@/types/character-profile'
import { parseAndValidateRecommendation } from '@/lib/providers/omnivoice'
import { OMNIVOICE_ZH_CHIP_GROUPS } from '@/lib/providers/omnivoice/instruct-vocabulary'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import { resolveAnalysisModel } from './resolve-analysis-model'
import type { TaskJobData } from '@/lib/task/types'

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 把分组词表渲染成 prompt 注入用的可读文本。 */
function renderVocabulary(): string {
  const labelByKey: Record<string, string> = {
    gender: '性别',
    age: '年龄',
    pitch: '音调',
    accent: '口音/方言',
  }
  return OMNIVOICE_ZH_CHIP_GROUPS.map(
    (group) => `${labelByKey[group.key] ?? group.key}: ${group.tokens.join('、')}`,
  ).join('\n')
}

export async function handleCharacterVoiceRecommendTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const characterId = readString(payload.characterId)
  if (!characterId) {
    throw new Error('characterId is required')
  }

  const projectId = job.data.projectId
  const novelPromotionData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true, analysisModel: true },
  })
  if (!novelPromotionData) {
    throw new Error('Novel promotion data not found')
  }

  const character = await prisma.novelPromotionCharacter.findFirst({
    where: { id: characterId, novelPromotionProjectId: novelPromotionData.id },
    select: { id: true, name: true, profileData: true },
  })
  if (!character) {
    throw new Error('CHARACTER_NOT_FOUND')
  }

  await reportTaskProgress(job, 20, {
    stage: 'voice_recommend_prepare',
    stageLabel: '准备角色档案',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'voice_recommend_prepare')

  const profile = parseProfileData(character.profileData)

  const promptTemplate = await buildPromptAsync({
    promptId: PROMPT_IDS.NP_CHARACTER_VOICE_RECOMMEND,
    locale: job.data.locale,
    projectId,
    variables: {
      name: character.name,
      gender: profile?.gender ?? '',
      age_range: profile?.age_range ?? '',
      archetype: profile?.archetype ?? '',
      personality_tags: (profile?.personality_tags ?? []).join('、'),
      occupation: profile?.occupation ?? '',
      social_class: profile?.social_class ?? '',
      era_period: profile?.era_period ?? '',
      vocabulary: renderVocabulary(),
    },
  })

  const analysisModel = await resolveAnalysisModel({
    userId: job.data.userId,
    projectAnalysisModel: novelPromotionData.analysisModel,
  })

  await reportTaskProgress(job, 50, {
    stage: 'voice_recommend_llm',
    stageLabel: 'AI 推荐声音特征',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'voice_recommend_llm')

  const streamContext = createWorkerLLMStreamContext(job, 'character_voice_recommend')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)

  const completion = await withInternalLLMStreamCallbacks(
    streamCallbacks,
    async () =>
      await executeAiTextStep({
        userId: job.data.userId,
        model: analysisModel,
        messages: [{ role: 'user', content: promptTemplate }],
        projectId,
        action: 'character_voice_recommend',
        meta: {
          stepId: 'character_voice_recommend',
          stepAttempt: 1,
          stepTitle: 'AI 推荐声音',
          stepIndex: 1,
          stepTotal: 1,
        },
      }),
  )

  const recommendation = parseAndValidateRecommendation(completion.text ?? '', profile)

  await reportTaskProgress(job, 96, {
    stage: 'voice_recommend_done',
    stageLabel: '推荐完成',
    displayMode: 'detail',
  })

  return {
    success: true,
    instruct: recommendation.instruct,
    source: recommendation.source,
  }
}
```

注:`createWorkerLLMStreamContext` / `createWorkerLLMStreamCallbacks` / `resolveAnalysisModel` / `executeAiTextStep` 的用法对齐 `src/lib/workers/handlers/voice-analyze.ts`。若 `executeAiTextStep` 的 `meta` 字段名不同,读 voice-analyze.ts 对齐(本 plan 已按其签名写)。

- [ ] **Step 3: 注册到 text.worker**

修改 `src/lib/workers/text.worker.ts`:

(a) import:

```ts
import { handleCharacterVoiceRecommendTask } from './handlers/character-voice-recommend'
```

(b) 在 switch(`case TASK_TYPE.VOICE_ANALYZE:` 附近)加:

```ts
    case TASK_TYPE.CHARACTER_VOICE_RECOMMEND:
      return await handleCharacterVoiceRecommendTask(job)
```

(对齐该文件现有 case 的返回风格;若其它 case 用 `result = await ...; break` 模式,跟随之。)

- [ ] **Step 4: typecheck**

```bash
npm run typecheck 2>&1 | grep -cE "^[a-z].*error TS"
npm run typecheck 2>&1 | grep -E "^[a-z].*error TS" | awk -F'(' '{print $1}' | sort -u
```
Expected: 26,且唯一文件是 ArtStyleEditor.test.tsx(无新增)。

- [ ] **Step 5: Commit**

```bash
git add src/lib/workers/handlers/character-voice-recommend.ts src/lib/workers/text.worker.ts src/lib/providers/omnivoice/index.ts
git commit -m "feat(omnivoice): character-voice-recommend worker handler"
```

---

## Task 5: API route + mutation hook

**Files:**
- Create: `src/app/api/novel-promotion/[projectId]/character/[characterId]/recommend-voice-instruct/route.ts`
- Modify: `src/lib/query/mutations/useVoiceMutations.ts`
- Test: `tests/integration/api/specific/character-voice-recommend-route.test.ts`

**Interfaces:**
- Consumes: `TASK_TYPE.CHARACTER_VOICE_RECOMMEND` (Task 3), `submitTask`, `requireProjectAuthLight`
- Produces:
  - Endpoint `POST /api/novel-promotion/[projectId]/character/[characterId]/recommend-voice-instruct` → task response
  - `useRecommendVoiceInstruct(projectId: string, characterId: string)` → mutation returning `{ instruct: string; source: string }`

- [ ] **Step 1: 写集成测试**

创建 `tests/integration/api/specific/character-voice-recommend-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api-auth', () => ({
  requireProjectAuthLight: vi.fn(async () => ({ session: { user: { id: 'u1' } } })),
  isErrorResponse: vi.fn(() => false),
}))
vi.mock('@/lib/task/submitter', () => ({
  submitTask: vi.fn(async () => ({ taskId: 't1', status: 'queued' })),
}))
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))

import { POST } from '@/app/api/novel-promotion/[projectId]/character/[characterId]/recommend-voice-instruct/route'
import { submitTask } from '@/lib/task/submitter'

function buildRequest(body: unknown): Request {
  return new Request('http://x/api/np/p1/character/c1/recommend-voice-instruct', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

function ctx(projectId: string, characterId: string) {
  return { params: Promise.resolve({ projectId, characterId }) }
}

describe('POST recommend-voice-instruct', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('submits CHARACTER_VOICE_RECOMMEND task with characterId in payload', async () => {
    const res = await POST(buildRequest({}) as never, ctx('p1', 'c1') as never)
    expect(res.status).toBe(200)
    expect(submitTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1',
      type: 'character_voice_recommend',
      payload: expect.objectContaining({ characterId: 'c1' }),
    }))
  })

  it('rejects when characterId is missing in route params', async () => {
    const res = await POST(buildRequest({}) as never, ctx('p1', '') as never)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(submitTask).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 验证失败**

```bash
npx vitest run --root . --exclude '**/.claude/**' tests/integration/api/specific/character-voice-recommend-route.test.ts
```
Expected: FAIL — route 模块不存在。

- [ ] **Step 3: 实现 route**

创建 `src/app/api/novel-promotion/[projectId]/character/[characterId]/recommend-voice-instruct/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'

/**
 * AI 推荐角色语音特征(OmniVoice instruct 词表标签)
 * POST /api/novel-promotion/[projectId]/character/[characterId]/recommend-voice-instruct
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; characterId: string }> },
) => {
  const { projectId, characterId } = await context.params
  if (!characterId || !characterId.trim()) {
    throw new ApiError('INVALID_PARAMS')
  }

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const locale = resolveRequiredTaskLocale(request, body)

  const payload = { characterId, displayMode: 'detail' as const }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.CHARACTER_VOICE_RECOMMEND,
    targetType: 'NovelPromotionCharacter',
    targetId: characterId,
    payload,
    dedupeKey: `${TASK_TYPE.CHARACTER_VOICE_RECOMMEND}:${characterId}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.CHARACTER_VOICE_RECOMMEND, payload),
  })

  return NextResponse.json(result)
})
```

- [ ] **Step 4: 验证集成测试通过**

```bash
npx vitest run --root . --exclude '**/.claude/**' tests/integration/api/specific/character-voice-recommend-route.test.ts
```
Expected: 2 passed。

- [ ] **Step 5: 加 mutation hook**

修改 `src/lib/query/mutations/useVoiceMutations.ts`,加:

```ts
export function useRecommendVoiceInstruct(projectId: string, characterId: string) {
  return useMutation({
    mutationFn: async (): Promise<{ instruct: string; source: string }> => {
      const response = await requestTaskResponseWithError(
        `/api/novel-promotion/${projectId}/character/${characterId}/recommend-voice-instruct`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
        'Failed to recommend voice',
      )
      return await resolveTaskResponse<{ instruct: string; source: string }>(response)
    },
  })
}
```

注:`requestTaskResponseWithError` / `resolveTaskResponse` 的 import 路径对齐该文件现有其它 mutation(读文件顶部 import 确认;若名称不同跟随之)。

- [ ] **Step 6: typecheck + lint**

```bash
npm run typecheck 2>&1 | grep -cE "^[a-z].*error TS"
npm run lint -- 'src/app/api/novel-promotion/[projectId]/character/[characterId]/recommend-voice-instruct/route.ts' src/lib/query/mutations/useVoiceMutations.ts 2>&1 | tail -5
```
Expected: typecheck 26;lint 0 errors。

- [ ] **Step 7: Commit**

```bash
git add 'src/app/api/novel-promotion/[projectId]/character/[characterId]/recommend-voice-instruct/route.ts' src/lib/query/mutations/useVoiceMutations.ts tests/integration/api/specific/character-voice-recommend-route.test.ts
git commit -m "feat(api): recommend-voice-instruct route + useRecommendVoiceInstruct hook"
```

---

## Task 6: UI — VoiceDesignDialogBase「AI 推荐语音」按钮 + novel-promotion 透传

**Files:**
- Modify: `src/components/voice/VoiceDesignDialogBase.tsx`
- Modify: `src/components/voice/VoiceDesignGeneratorSection.tsx`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/voice/VoiceDesignDialog.tsx`
- Modify: 调用 `VoiceDesignDialog` 的角色卡片组件(透传 characterId)
- Modify: `messages/zh/voice.json` + `messages/en/voice.json`

**Interfaces:**
- Consumes: `useRecommendVoiceInstruct` (Task 5)
- Produces: `VoiceDesignDialogBase` 新增可选 props `onRecommendInstruct?: () => Promise<{ instruct: string }>`;`VoiceDesignGeneratorSection` 新增可选 props `onRecommendInstruct` + `isRecommending` + 渲染「AI 推荐语音」按钮(仅 omnivoice provider)

- [ ] **Step 1: 读现有组件确认 prop 链**

```bash
grep -n "onRecommend\|provider\|onVoicePromptChange\|VoiceDesignGeneratorSection" src/components/voice/VoiceDesignDialogBase.tsx
```
理解 voicePrompt 状态、provider 状态、传给 GeneratorSection 的 props。

- [ ] **Step 2: VoiceDesignGeneratorSection 加按钮**

修改 `src/components/voice/VoiceDesignGeneratorSection.tsx`:

(a) props 接口加:

```ts
  onRecommendInstruct?: () => void
  isRecommending?: boolean
```

(b) 解构参数加 `onRecommendInstruct`、`isRecommending`。

(c) 在 isOmnivoice 的 chip 面板**之前**(`{isOmnivoice && (` 那块的最前面),加 AI 推荐按钮(仅当 `onRecommendInstruct` 存在):

```tsx
{isOmnivoice && onRecommendInstruct && (
  <button
    type="button"
    onClick={onRecommendInstruct}
    disabled={isRecommending}
    className={`glass-btn-base glass-btn-tone-info w-full py-2 rounded-lg text-sm font-medium transition-opacity ${
      isRecommending ? 'opacity-60 cursor-wait' : 'cursor-pointer'
    }`}
  >
    {isRecommending ? tv('aiRecommendLoading') : `✨ ${tv('aiRecommend')}`}
  </button>
)}
```

放在 `{isOmnivoice && (` chip 面板块上方(即作为一个独立的 `{isOmnivoice && onRecommendInstruct && (...)}` 块,在 chip 面板 JSX 之前)。

- [ ] **Step 3: VoiceDesignDialogBase 透传 + 状态**

修改 `src/components/voice/VoiceDesignDialogBase.tsx`:

(a) props 接口加:

```ts
  onRecommendInstruct?: () => Promise<{ instruct: string }>
```

(b) 解构参数加 `onRecommendInstruct`。

(c) 加状态:

```ts
const [isRecommending, setIsRecommending] = useState(false)
```

(d) 加 handler:

```ts
const handleRecommend = onRecommendInstruct
  ? async () => {
      setIsRecommending(true)
      setError(null)
      try {
        const { instruct } = await onRecommendInstruct()
        if (instruct) setVoicePrompt(instruct)
      } catch (err) {
        const message = err instanceof Error ? err.message : tv('generationError')
        setError(message)
      } finally {
        setIsRecommending(false)
      }
    }
  : undefined
```

(e) 传给 `VoiceDesignGeneratorSection`:

```tsx
onRecommendInstruct={handleRecommend}
isRecommending={isRecommending}
```

(注:`setVoicePrompt`、`setError`、`tv` 已存在于该组件;确认 `error` 状态名一致。)

- [ ] **Step 4: novel-promotion VoiceDesignDialog 构造 onRecommendInstruct**

修改 `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/voice/VoiceDesignDialog.tsx`:

(a) props 加 `characterId?: string`。

(b) import 并用 hook:

```ts
import { useRecommendVoiceInstruct } from '@/lib/query/mutations/useVoiceMutations'
```

(c) 在组件内:

```ts
const recommendMutation = useRecommendVoiceInstruct(projectId, characterId ?? '')

const handleRecommendInstruct = characterId
  ? async () => {
      const result = await recommendMutation.mutateAsync()
      return { instruct: result.instruct }
    }
  : undefined
```

(d) 传给 `VoiceDesignDialogBase`:

```tsx
onRecommendInstruct={handleRecommendInstruct}
```

- [ ] **Step 5: 角色卡片透传 characterId**

```bash
grep -rn "VoiceDesignDialog\b" src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/ | grep -v "VoiceDesignDialogBase"
```
找到渲染 `<VoiceDesignDialog .../>` 的地方,补一个 `characterId={character.id}`(角色对象在该作用域内的实际字段名按现场代码,通常是 `character.id` 或 `char.id`)。

- [ ] **Step 6: i18n**

`messages/zh/voice.json` 的 `voiceDesign` 块加:

```json
        "aiRecommend": "AI 推荐语音",
        "aiRecommendLoading": "AI 分析角色中...",
```

`messages/en/voice.json` 的 `voiceDesign` 块加:

```json
        "aiRecommend": "AI Recommend Voice",
        "aiRecommendLoading": "Analyzing character...",
```

- [ ] **Step 7: typecheck + lint + i18n 一致性**

```bash
npm run typecheck 2>&1 | grep -cE "^[a-z].*error TS"
node -e "const z=require('./messages/zh/voice.json').voiceDesign,e=require('./messages/en/voice.json').voiceDesign;console.log('zh has:',!!z.aiRecommend,!!z.aiRecommendLoading,'en has:',!!e.aiRecommend,!!e.aiRecommendLoading)"
```
Expected: typecheck 26;i18n 两边都 true。

- [ ] **Step 8: Commit**

```bash
git add src/components/voice/VoiceDesignDialogBase.tsx src/components/voice/VoiceDesignGeneratorSection.tsx 'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/voice/VoiceDesignDialog.tsx' messages/zh/voice.json messages/en/voice.json src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/
git commit -m "feat(omnivoice): VoiceDesignDialog 加 AI 推荐语音按钮 + novel-promotion 透传 characterId"
```

---

## Task 7: 端到端验证

**Files:** 无(纯验证)

- [ ] **Step 1: 全套 OmniVoice + 新增测试**

```bash
npx vitest run --root . --exclude '**/.claude/**' \
  tests/unit/providers/omnivoice/ \
  tests/unit/billing/character-voice-recommend-billing.test.ts \
  tests/integration/api/specific/character-voice-recommend-route.test.ts
```
Expected: 全绿(含 instruct-recommend 9 + billing 2 + route 2 + 原有 omnivoice 测试)。

- [ ] **Step 2: typecheck 基线**

```bash
npm run typecheck 2>&1 | grep -cE "^[a-z].*error TS"
npm run typecheck 2>&1 | grep -E "^[a-z].*error TS" | awk -F'(' '{print $1}' | sort -u
```
Expected: 26,唯一文件 ArtStyleEditor.test.tsx。

- [ ] **Step 3: prompt guard + lint**

```bash
npm run check:prompt-i18n 2>&1 | tail -3
npm run lint:all 2>&1 | grep "✖"
```
Expected: prompt guard 通过;lint 0 errors(warnings 是预存基线)。

- [ ] **Step 4: 手动走一遍**

```bash
npm run dev
```
1. 进入 novel-promotion 项目,某角色配音音色区,选 OmniVoice provider。
2. 确认出现「✨ AI 推荐语音」按钮。
3. 点击 → loading → 描述框被填入合法标签(如「男、中年、低音调」),chip 面板对应高亮。
4. 点「生成 N 个方案」→ 试听 → 选一个确认绑定。
5. (可选)把 OmniVoice 后端停掉,确认 AI 推荐仍能出标签(只有生成预览会失败)。

- [ ] **Step 5: 检查验收清单**(spec §9)

- [ ] novel-promotion 角色选 OmniVoice 后出现「AI 推荐语音」按钮
- [ ] 点击后 LLM 读档案自动填合法标签,chip 高亮
- [ ] LLM 越表/为空时 profileData 兜底,不报错(单测覆盖)
- [ ] 推荐后可直接生成多方案,或手动改 chip 再生成
- [ ] OmniVoice 离线时 AI 推荐仍出标签
- [ ] 新增测试通过,typecheck 无新增错误

---

## Self-Review

### Spec 覆盖

| Spec 章节 | Task |
|---|---|
| §2.1 数据流 | Task 4(worker)+ Task 5(route/hook)+ Task 6(UI) |
| §2.2 LLM/预览解耦 | Task 4(LLM task 只出标签)+ Task 6(复用前端循环) |
| §2.3 新建/修改文件 | Task 1-6 全覆盖 |
| §3.1 Prompt | Task 2 |
| §3.2 解析+兜底 | Task 1 |
| §3.3 worker handler | Task 4 |
| §4.1 API route | Task 5 |
| §4.2 mutation hook | Task 5 |
| §4.3 UI 接入 | Task 6 |
| §5 错误场景 | Task 1(兜底)+ Task 4(CHARACTER_NOT_FOUND)+ Task 6(UI error) |
| §6 测试 | Task 1/3/5 单测+集成;Task 7 端到端 |
| §7 计费 | Task 3 |
| §8 实施顺序 | Task 顺序 = spec §8 顺序 |
| §9 验收 | Task 7 Step 5 |

无遗漏。

### 占位符扫描

无 TBD/TODO;每个 code step 含完整代码或具体命令。Task 4/5 有两处「读现场文件对齐命名」的注记,均给了参照文件与默认实现(非占位,是防御性对齐指引)。

### 类型一致性

- `RecommendInstructResult { instruct, source }`(Task 1)↔ handler 返回 `{ success, instruct, source }`(Task 4)↔ hook 返回 `{ instruct, source }`(Task 5)↔ UI 取 `.instruct`(Task 6):一致。
- `parseAndValidateRecommendation(llmOutput, profileData)`(Task 1)↔ handler 调用签名(Task 4):一致。
- `TASK_TYPE.CHARACTER_VOICE_RECOMMEND = 'character_voice_recommend'`(Task 3)↔ route type(Task 5)↔ worker case(Task 4)↔ billing(Task 3):一致。
- `PROMPT_IDS.NP_CHARACTER_VOICE_RECOMMEND`(Task 2)↔ handler buildPromptAsync(Task 4):一致。
- prompt variableKeys(Task 2)↔ handler variables(Task 4):name/gender/age_range/archetype/personality_tags/occupation/social_class/era_period/vocabulary 全对齐。
- i18n keys `aiRecommend` / `aiRecommendLoading`(Task 6 Step 6)↔ GeneratorSection 用 `tv('aiRecommend')` / `tv('aiRecommendLoading')`(Task 6 Step 2):一致。

无漂移。
