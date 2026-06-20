# AI 根据人物信息推荐 OmniVoice 语音 — 设计文档

- **日期**: 2026-06-20
- **范围**: 仅 novel-promotion 项目内角色
- **LLM 职责**: 读 profileData → 输出 OmniVoice 受控词表标签(不碰音频)
- **LLM 模型**: 复用项目分析 LLM
- **触发**: 单角色「AI 推荐语音」按钮 + 多方案试听(复用现有 voice-design UI)
- **兜底**: prompt 给词表 + 输出过滤 + profileData(gender/age)兜底

---

## 1. 背景与目标

vvicat 的角色「配音音色」区现有三个入口:AI 设计(自然语言 prompt)、上传音频、资产库导入。OmniVoice 接入后,声音设计走受控词表(性别/年龄/音调/口音)而非自由文本(见 [2026-06-18-omnivoice-sdk-integration-design.md](2026-06-18-omnivoice-sdk-integration-design.md))。

**问题**:用户要自己想「这个角色该用什么声音特征」并手动选词表标签。但角色的 `profileData` 已经包含 `gender / age_range / archetype / personality_tags / occupation / social_class / era_period` —— 足够让 LLM 自动推断合适的声音特征。

**目标**:加一个「AI 推荐语音」按钮,点击后 LLM 读角色档案 → 输出 OmniVoice 词表标签 → 自动生成多个语音预览方案供用户试听选择。把「想声音特征 + 选词表」这一步交给 AI。

**非目标**:
- 不接 asset-hub 全局角色(本期仅 novel-promotion)
- 不做批量推荐(单角色手动触发)
- 不改 OmniVoice 词表本身(复用 instruct-vocabulary.ts)
- 不让 LLM 直接产音频(LLM 只出标签)

---

## 2. 架构

### 2.1 数据流

```
用户在角色配音音色区点「AI 推荐语音」
  │
  ├─[1] 前端 POST /api/novel-promotion/[projectId]/character/[characterId]/recommend-voice-instruct
  │     提交 BullMQ text-worker task: CHARACTER_VOICE_RECOMMEND
  │
  ├─[2] text worker:
  │       a. 读 character.profileData(gender/age_range/archetype/personality_tags/...)
  │       b. LLM(项目分析模型)+ 新 prompt 模板 NP_CHARACTER_VOICE_RECOMMEND
  │          → 输出 OmniVoice 中文词表标签字符串
  │       c. validateOmnivoiceInstruct 过滤非法 token
  │       d. 过滤后为空 → 用 profileData 的 gender+age_range 映射兜底一个最小合法组合
  │       e. 返回 { instruct: "男、中年、低音调", source: "llm" | "fallback" }
  │
  ├─[3] 前端拿到 instruct,把它作为 voicePrompt 填入现有 voice-design 流程
  │     调 generateVoiceDesignOptions({ provider: 'omnivoice', voicePrompt: instruct, count: N })
  │     → 前端循环 N 次走现有 useDesignProjectVoice → OmniVoice 生成 N 个预览
  │
  └─[4] 复用现有多方案试听 UI → 用户选一个 → 现有确认绑定流程写 character.voiceId/voiceType
```

### 2.2 为什么 LLM 推荐与预览生成分两步

vvicat 有 `no-api-direct-llm-call` guard:API 路由禁止直接调 LLM,必须走 worker。同时多方案预览生成在现有代码里是**前端循环**调 voice-design mutation(见 `generateVoiceDesignOptions`)。

所以:
- **LLM 出标签** = 一个独立的轻量 text-worker task(返回字符串,不产音频)
- **预览生成** = 复用现有前端多方案循环(零改动)

这样职责单一、复用最大化:LLM task 只做「档案 → 标签」一件事,预览/试听/绑定全是现成的。

### 2.3 新建 / 修改文件

**新建:**

| 路径 | 责任 |
|---|---|
| `src/lib/providers/omnivoice/instruct-recommend.ts` | `recommendInstructFromProfile(profileData)` 的纯逻辑:LLM 输出解析 + 过滤 + profileData 兜底映射 |
| `src/lib/workers/handlers/character-voice-recommend.ts` | BullMQ handler:读 character → 调 LLM → 解析兜底 → 返回 instruct |
| `src/app/api/novel-promotion/[projectId]/character/[characterId]/recommend-voice-instruct/route.ts` | 提交 CHARACTER_VOICE_RECOMMEND task |
| `tests/unit/providers/omnivoice/instruct-recommend.test.ts` | 解析 + 兜底单测 |
| `tests/integration/api/specific/character-voice-recommend-route.test.ts` | route 提交 task 测试 |

**修改:**

| 路径 | 改动 |
|---|---|
| `src/lib/task/types.ts` | 加 `CHARACTER_VOICE_RECOMMEND: 'character_voice_recommend'` |
| `src/lib/workers/text.worker.ts` | 注册新 task type → handler |
| `src/lib/prompt-i18n/prompt-ids.ts` | 加 `NP_CHARACTER_VOICE_RECOMMEND: 'np_character_voice_recommend'` |
| `src/lib/prompt-i18n/catalog.ts` | 加 `[PROMPT_IDS.NP_CHARACTER_VOICE_RECOMMEND]` 模板定义(中英文,结构对齐现有 `NP_VOICE_ANALYSIS` 条目 @ catalog.ts:172) |
| `src/lib/providers/omnivoice/index.ts` | re-export recommend 函数 |
| `src/components/voice/VoiceDesignDialogBase.tsx` | 增加可选 `characterId` + 「AI 推荐语音」按钮(仅 omnivoice provider 时显示) |
| `src/app/[locale]/.../voice/VoiceDesignDialog.tsx` | 透传 characterId + projectId |
| 调用 VoiceDesignDialog 的角色卡片组件 | 传 characterId |
| `src/lib/query/mutations/useVoiceMutations.ts` 或新 hook | `useRecommendVoiceInstruct(projectId, characterId)` |
| `src/lib/billing/task-policy.ts` | CHARACTER_VOICE_RECOMMEND 计费(复用文本分析单价) |
| `messages/zh/voice.json` + `messages/en/voice.json` | 「AI 推荐语音」按钮 + 状态文案 |

**不动:** `prisma/schema.prisma`、OmniVoice 词表、现有 voice-design 多方案 UI/循环。

---

## 3. LLM 推荐逻辑

### 3.1 Prompt(NP_CHARACTER_VOICE_RECOMMEND)

System prompt 要点:
- 角色:你是配音导演,根据角色档案推荐最贴合的声音特征
- **给出完整 OmniVoice 中文词表**(从 `OMNIVOICE_ZH_VOCABULARY` 注入):性别、年龄、音调、口音四类
- 硬约束:
  - 只能从词表里选词
  - 性别必选 1 个,年龄必选 1 个,音调建议选 1 个,口音可选(默认不选,除非档案明确暗示方言)
  - 输出格式:用「、」分隔的中文词,如 `男、中年、低音调`
  - 不要输出任何解释,只输出标签字符串

User prompt 注入角色档案的关键字段:
```
角色名: {name}
性别: {gender}
年龄段: {age_range}
原型: {archetype}
性格: {personality_tags}
职业: {occupation}
社会阶层: {social_class}
时代背景: {era_period}
```

### 3.2 解析 + 兜底(instruct-recommend.ts)

```ts
export interface RecommendInstructResult {
  instruct: string          // 规范化后的合法 instruct,如 "男、中年、低音调"
  source: 'llm' | 'fallback'
}

export function parseAndValidateRecommendation(
  llmOutput: string,
  profileData: CharacterProfileData | null,
): RecommendInstructResult
```

逻辑:
1. 把 LLM 原始输出交给 `validateOmnivoiceInstruct`(已有)。
2. `ok === true` → 返回 `{ instruct: normalized, source: 'llm' }`。
3. `ok === false`(LLM 越表 / 空 / 混语言)→ 走 profileData 兜底:
   - gender 映射:`gender` 含「男/male」→ `男`,含「女/female」→ `女`,否则默认 `男`
   - age 映射:`age_range` 含「儿童/child」→ `儿童`,含「少年/teen」→ `少年`,含「青年/young」→ `青年`,含「中年/middle」→ `中年`,含「老/elder」→ `老年`,否则默认 `青年`
   - 拼成 `<gender>、<age>`(最小合法组合),返回 `{ instruct, source: 'fallback' }`
4. profileData 为 null(角色无档案)→ 兜底 `男、青年`,source `fallback`。

兜底永远产出合法 instruct —— 保证下游 OmniVoice 调用不会因 instruct 非法失败。

### 3.3 worker handler

`character-voice-recommend.ts`:
1. 读 `payload.characterId`,从 `prisma.novelPromotionCharacter.findFirst`(限定本项目)取 `name + profileData`。
2. 角色不存在 → throw `CHARACTER_NOT_FOUND`。
3. `parseProfileData(character.profileData)` → 解析档案(可能 null)。
4. 用项目分析模型(`resolveAnalysisModel`)+ `buildPromptAsync(PROMPT_IDS.NP_CHARACTER_VOICE_RECOMMEND, { ...档案字段, vocabulary })` 构造 prompt。
5. `executeAiTextStep` 调 LLM(沿用 character-profile.ts 的 stream 回调模式)。
6. `parseAndValidateRecommendation(llmText, profileData)` → instruct + source。
7. 返回 `{ success: true, instruct, source }`。

---

## 4. API 与前端

### 4.1 API 路由

`POST /api/novel-promotion/[projectId]/character/[characterId]/recommend-voice-instruct`

- `requireProjectAuthLight(projectId)` 鉴权(沿用现有模式)。
- 校验 characterId 属于本项目。
- `submitTask({ type: CHARACTER_VOICE_RECOMMEND, payload: { characterId }, ... })`。
- 返回 task 响应(走现有 `resolveTaskResponse` 客户端等待模式)。
- dedupeKey: `CHARACTER_VOICE_RECOMMEND:<characterId>`(同角色重复点合并)。

### 4.2 mutation hook

`useRecommendVoiceInstruct(projectId, characterId)`:
- POST 到上面的路由,`resolveTaskResponse<{ instruct: string; source: string }>`。

### 4.3 UI 接入

`VoiceDesignDialogBase` 新增可选 props:`characterId?: string`、`onRecommendInstruct?: () => Promise<{ instruct: string }>`。

- 仅当 `provider === 'omnivoice'` 且 `onRecommendInstruct` 存在时,在「选择声音风格」上方显示「✨ AI 推荐语音」按钮。
- 点击 → 调 `onRecommendInstruct()` → 拿到 instruct → `setVoicePrompt(instruct)`(填进描述框,chip 面板自动高亮对应标签,因为已有的 chip 状态由 voicePrompt 派生)。
- 推荐进行中显示 loading;失败显示错误条(沿用现有 error 展示)。
- 用户拿到推荐的 instruct 后,可以直接「生成 N 个方案」,也可以再手动调整 chip。

**关键复用点**:AI 推荐只负责「填好 voicePrompt」,后续生成/试听/绑定全部是现有流程。用户也能在推荐基础上手动改 chip 再生成。

novel-promotion 的 `VoiceDesignDialog` 透传 `characterId`(从角色卡片拿)+ 构造 `onRecommendInstruct`(调 `useRecommendVoiceInstruct`)。

---

## 5. 错误场景

| 场景 | 处理 |
|---|---|
| 角色无 profileData | LLM 仍可能基于 name 推断;解析失败则兜底 `男、青年` |
| LLM 输出越表(如「磁性、浑厚」) | `validateOmnivoiceInstruct` 过滤,全非法则 profileData 兜底 |
| LLM 输出中英混合 | validate 判混语言 → 兜底 |
| LLM 调用失败 / 超时 | task 失败,前端提示「AI 推荐失败,请重试或手动选择」,不阻塞手动 chip 选择 |
| 角色不存在 | route/worker 返回 CHARACTER_NOT_FOUND |
| OmniVoice 后端离线 | 推荐 task(纯 LLM)仍能成功出标签;只有后续预览生成才会失败,走现有 voice-design 错误处理 |

LLM 推荐与音频生成解耦 —— 即使 OmniVoice 后端临时不可用,用户仍能拿到 AI 推荐的标签,等后端恢复再生成。

---

## 6. 测试策略

### 6.1 单元测试(`tests/unit/providers/omnivoice/instruct-recommend.test.ts`)

- `parseAndValidateRecommendation`:
  - LLM 输出合法标签 → source=llm,instruct 规范化
  - LLM 输出含越表词 → 过滤保留合法部分(若仍有合法标签,source=llm)
  - LLM 输出全越表 → profileData 兜底,source=fallback
  - LLM 输出中英混合 → 兜底
  - profileData=null → 兜底 `男、青年`
  - gender/age 兜底映射各分支(男/女、儿童/少年/青年/中年/老年)

### 6.2 集成测试(`tests/integration/api/specific/character-voice-recommend-route.test.ts`)

- route 提交 CHARACTER_VOICE_RECOMMEND task,payload 含 characterId
- 角色不属于本项目 → 拒绝

### 6.3 契约/回归

- prompt-i18n guard:新 PROMPT_ID 有对应种子(中英文)
- 计费:CHARACTER_VOICE_RECOMMEND 是 billable,复用文本分析单价

### 6.4 不在测试范围

- 真实 LLM 输出质量(prompt 调优是运营/迭代事项,非单测)
- 真实 OmniVoice 音频生成(已有 voice-design 测试覆盖)

---

## 7. 计费

CHARACTER_VOICE_RECOMMEND 是一次 LLM 文本调用,复用现有文本分析计费路径:在 [src/lib/billing/task-policy.ts](src/lib/billing/task-policy.ts) 的 `BILLABLE_TASK_TYPES` 集合 + `buildDefaultTaskBillingInfo` 的文本分析 case 组(与 `VOICE_ANALYZE` / `ANALYZE_NOVEL` 同组,走 `buildTextTaskInfo`)里加入 `CHARACTER_VOICE_RECOMMEND`。预览生成的计费走现有 voice-design 路径,不变。

---

## 8. 实施顺序建议

1. `instruct-recommend.ts` 解析+兜底纯逻辑 + 单测(TDD,不依赖 LLM)
2. PROMPT_ID + prompt 种子(中英文)
3. worker handler + text.worker 注册
4. task type + 计费
5. API route + mutation hook + 集成测试
6. UI:VoiceDesignDialogBase 加 AI 推荐按钮 + novel-promotion 透传 characterId
7. i18n
8. typecheck + 相关测试 + 手动走一遍

---

## 9. 验收标准

- [ ] novel-promotion 角色配音音色区,选 OmniVoice provider 后出现「AI 推荐语音」按钮
- [ ] 点击后 LLM 读角色档案,自动填入合法的 OmniVoice 词表标签到描述框,chip 面板对应高亮
- [ ] LLM 输出越表/为空时,profileData 兜底产出合法标签,不报错
- [ ] 推荐后用户可直接生成多方案试听,或手动改 chip 再生成
- [ ] OmniVoice 后端离线时,AI 推荐仍能出标签(只有生成预览受影响)
- [ ] 新增单测 + 集成测试通过,typecheck 无新增错误
