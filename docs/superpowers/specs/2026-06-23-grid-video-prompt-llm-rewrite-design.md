# 宫格视频提示词 LLM 重写 — 设计文档

**日期**：2026-06-23
**作者**：fuyang + Claude
**关联**：`2026-06-18-panel-grid-image-design.md`（宫格图生成）

## 1. 背景与问题

短剧制作流程中，分镜面板（`NovelPromotionPanel`）可以渲染成「宫格图」（`imageLayout='grid'`）：一张图包含 N 个分镜格，表现同一镜头主体的不同 angle / 瞬间 / 动作分解（见 `lib/prompts/novel-promotion/panel_grid_image.zh.txt`）。

视频生成阶段，宫格面板走 `video.worker` 的宫格分支（`src/lib/workers/video.worker.ts:123`），当前调用 `buildGridVideoPrompt`（`src/lib/storyboard-images/grid-video-prompt.ts:41`）。

**核心问题**：`buildGridVideoPrompt` 只是**模板填充**——它把面板原有的 `videoPrompt`/`description` 文本塞进一个固定的「请把各格补间成连续镜头」包装模板里，**没有任何 LLM 真正理解宫格的内容**。结果是 Seedance 收到的本质上还是用于「生成宫格图」的描述，并不是一条符合 Seedance 视频规范的提示词，导致宫格生成视频效果差。

**用户诉求**：用 LLM 真正理解宫格里每一个分镜格，按 Seedance 规范重写成视频提示词，写入 `video_prompt` 字段，再用该字段生成视频。

## 2. 目标与非目标

### 目标
- 宫格面板生成视频时，先用 LLM（文本，基于结构化上下文）把宫格理解为「同一连续镜头的关键帧序列」，按 Seedance 时间戳分镜规范重写出一条视频提示词。
- 重写结果回写到 `panel.videoPrompt`，在视频阶段 UI 中可见、可手动编辑。
- 带缓存：已重写且用户未手改时，复用，不重复调 LLM。
- 提供「重新生成宫格视频提示词」的手动按钮，让用户主动触发重写。

### 非目标
- **不**做视觉理解（不把宫格图喂给多模态模型）。仅基于面板的结构化文本上下文（description / shot_type / camera_move / characters / location / srtSegment 等）。
- **不**把宫格拆成 N 条独立视频。输出仍是**一条**提示词、一条视频；用时间戳分镜在单条提示词内串联各格。
- **不**改动宫格图生成逻辑。
- **不**改动非宫格（single）面板的视频提示词路径。

## 3. 关键设计决策（已与用户确认）

| 决策点 | 选择 |
| --- | --- |
| LLM 输入 | 仅文本上下文（不喂图） |
| 输出形态 | 一条提示词 · Seedance 时间戳分镜（不拆 N 条） |
| 执行时机 | 实时重写 + 回写 `video_prompt` 字段 |
| 缓存策略 | 缓存 + 手动重生按钮（复用优先，用户手改优先） |
| 架构 | 方案 A：video.worker 内联实时重写 + 独立重生 task |

## 4. 架构与数据流

### 4.1 总览

```
[生成宫格视频] ──► video.worker 宫格分支
                     │
                     ├─ 判断：是否需要 LLM 重写？
                     │    ├─ videoPrompt 已是宫格重写版（缓存标记命中）且用户未手改 ──► 直接复用，跳过 LLM
                     │    └─ 否则 ──► 调用 rewriteGridVideoPrompt(LLM) ──► 回写 panel.videoPrompt + 缓存标记
                     │
                     └─ 用最终 videoPrompt 生成视频

[UI: 重新生成宫格视频提示词按钮] ──► enqueue AI_GRID_VIDEO_PROMPT (text task)
                                        └─ rewriteGridVideoPrompt(LLM) ──► 回写 panel.videoPrompt + 缓存标记 ──► UI 刷新
```

### 4.2 新增 / 改动的单元

**① `rewriteGridVideoPrompt`（新，核心 LLM 重写函数）**
- 位置：`src/lib/storyboard-images/grid-video-prompt.ts`（与现有 `buildGridVideoPrompt` 同文件，逐步替代其角色；保留 `isGridLayout`）。
- 职责：给定面板上下文 + 宫格布局 + locale + 模型，调用 `executeAiTextStep` 让 LLM 按 Seedance 规范输出一条时间戳分镜视频提示词。
- 依赖：`resolveAnalysisModel`（解析项目/用户分析模型）、`executeAiTextStep`（`@/lib/ai-runtime`）、`buildPromptAsync`（新 prompt 模板）。
- 输入：`{ panelContext, gridSize, shotType, cameraMove, locale, projectId, userId, model, jobMeta }`。
- 输出：`{ prompt: string; usage: TokenUsage } | null`（失败返回 null，调用方回退到原 basePrompt）。
- 解析：LLM 返回纯文本提示词（必要时去掉 markdown 代码块包裹）。

**② Prompt 模板（新）**
- 复用现有 `np_panel_grid_video` 的 prompt id 与文件 `lib/prompts/novel-promotion/panel_grid_video.{zh,en}.txt`，但**改写内容**：从「给视频模型的包装指令」改为「给 LLM 的重写指令」——要求 LLM 阅读结构化分镜上下文，理解 N 格为同一镜头关键帧，输出符合 Seedance 2.0 规范（时间戳分镜、镜头语言、音效、禁止项）的中文视频提示词。
- 变量：`storyboard_context_json`（面板结构化上下文）、`grid_layout`、`panel_grid_size`、`shot_type`、`camera_move`、`base_prompt`（原 videoPrompt/description 作为参考）。
- 与现有 `panel_grid_image` 模板风格一致（结构化分镜 JSON 输入）。

**③ video.worker 宫格分支改造**
- 文件：`src/lib/workers/video.worker.ts`（`generateVideoForPanel`）。
- 原 `buildGridVideoPrompt(...)` 调用替换为缓存判断 + `rewriteGridVideoPrompt(...)`：
  - 缓存命中（见 4.3）→ 直接用 `panel.videoPrompt`。
  - 否则调 LLM 重写 → 回写 `panel.videoPrompt` + 缓存标记 → 用新提示词生成视频。
- LLM token 计费：**不能**累加进 video task 的计费 payload —— 计费架构是「一个 task = 单一 `apiType` + 单一 `model`」，video task 用单一视频模型结算（`resolveTaskActual` / `settleTaskBilling`，`src/lib/billing/service.ts`），没有「视频费之外附加一笔文本费」的机制。改用 `withTextBilling(userId, analysisModel, maxIn, maxOut, recordParams, fn)`（`src/lib/billing/service.ts:624`）在重写调用处即时、独立地记一笔 text 费用。
- 失败回退：`rewriteGridVideoPrompt` 返回 null 时，退回当前 basePrompt，不阻塞视频生成（仅记日志）。

**④ 缓存标记字段（新，Prisma schema）**
- 在 `NovelPromotionPanel` 增加字段（见 4.3）。

**⑤ 重写 task（新，手动重生）**
- 新增 `TASK_TYPE.AI_GRID_VIDEO_PROMPT = 'ai_grid_video_prompt'`，路由到 text 队列。
- handler：`src/lib/workers/handlers/grid-video-prompt-rewrite.ts`，调用 `rewriteGridVideoPrompt` 并回写。
- 进度/intent/计费接线参照 `AI_MODIFY_SHOT_PROMPT` 现有模式（`intent.ts` / `progress-message.ts`）。

**⑥ UI：手动重生按钮**
- 位置：视频阶段面板卡片提示词编辑区（`panel-card/runtime/hooks` + `useVideoMutations`）。现有 `useUpdateProjectPanelVideoPrompt`（`src/lib/query/mutations/useVideoMutations.ts:51`）已提供 videoPrompt 回写通道，可在其旁新增一个触发 `AI_GRID_VIDEO_PROMPT` task 的 mutation。
- 仅对宫格面板（`imageLayout==='grid'`）显示「重新生成宫格视频提示词」。
- 触发 mutation → enqueue `AI_GRID_VIDEO_PROMPT` → task 完成后刷新 `videoPrompt`。

### 4.3 缓存与手改判定

新增字段（`NovelPromotionPanel`）：
- `gridVideoPromptHash String? @db.Text` — 记录上次成功重写后 `videoPrompt` 的内容指纹（如该字段值的 hash 或直接存重写后的副本指纹）。

判定逻辑：
- **复用条件**：`imageLayout==='grid'` 且 `gridVideoPromptHash` 非空 且 `hash(panel.videoPrompt) === gridVideoPromptHash`（说明当前 videoPrompt 正是上次 LLM 重写产物，用户没手改）。→ 跳过 LLM。
- **触发重写**：上述条件不满足（首次、或用户手改使 hash 不匹配、或手动重生按钮强制）。→ 调 LLM，成功后同时更新 `videoPrompt` 与 `gridVideoPromptHash`。
- **用户手改优先**：用户在 UI 改了 `videoPrompt` → hash 不再匹配 → 但**这正是我们想要的「以手改为准」**？需要区分两种语义：
  - 自动路径（生成视频时）：若用户手改过，hash 不匹配会触发重写，可能覆盖手改。**为避免覆盖手改，自动路径的复用条件放宽为：只要 `videoPrompt` 非空且 `gridVideoPromptHash` 非空就复用**（即一旦重写过，自动路径不再二次重写，无论是否手改）。重写仅由「首次（hash 为空）」或「手动按钮（强制）」触发。
  - 手动按钮：强制重写并覆盖（用户主动要求）。

> 决议：**自动路径** = 「首次 hash 为空才重写，之后一律复用现有 videoPrompt」；**手动按钮** = 强制重写覆盖。这样既缓存、又不覆盖手改、又给用户主动重生的出口。`gridVideoPromptHash` 实际只需作为「是否已重写过」的布尔标记即可（存任意非空值/时间戳）。简化为 `gridVideoPromptAt DateTime?`。

**最终字段**：`gridVideoPromptAt DateTime?`（非空表示已重写过；自动路径仅在为空时重写，手动按钮强制重写并刷新此时间戳）。

## 5. 错误处理

- LLM 调用失败 / 返回空：`rewriteGridVideoPrompt` 返回 null。
  - 自动路径：回退到当前 basePrompt 继续生成视频，记 warn 日志，不阻塞。
  - 手动 task：task 失败，UI 提示用户重试（不改 `videoPrompt`）。
- 分析模型未配置：`resolveAnalysisModel` 抛错。自动路径捕获后回退 basePrompt；手动 task 直接失败并提示「请先配置分析模型」。
- 非宫格面板：完全不走此逻辑（`isGridLayout` 守卫）。
- 计费：用 `withTextBilling` 包裹重写 LLM 调用，独立记一笔 text 费用。失败/回退（返回 null）时该笔费用按其正常结算逻辑处理（实际 usage 为 0 / 调用未发生则不产生费用）。

## 6. 测试策略

- **单测 `rewriteGridVideoPrompt`**：mock `executeAiTextStep`，验证：宫格上下文正确组装进 prompt 变量；返回提示词被正确解析/去包裹；失败返回 null。
- **单测缓存判定**：`gridVideoPromptAt` 为空→触发重写；非空→自动路径复用；手动强制→重写。
- **单测 video.worker 宫格分支**：mock 重写函数，验证命中缓存时不调 LLM、未命中时回写字段与时间戳、重写失败时回退 basePrompt。
- **handler 单测**：`AI_GRID_VIDEO_PROMPT` task 回写 `videoPrompt` + `gridVideoPromptAt`，计费 payload 含 LLM usage。
- 既有 `tests/unit/storyboard-images/grid-video-prompt.test.ts` 需相应更新（当前测的是模板填充行为）。

## 7. 影响面 / 迁移

- Prisma：新增 `gridVideoPromptAt`，需 `prisma db push` / migration。
- i18n：新增按钮文案、task 进度文案（`messages/{zh,en}`）。
- Prompt 模板内容改写：`panel_grid_video.{zh,en}.txt`（这两个文件已在 commit `f8dcec4` 提交、当前工作区干净；需在现有「视频模型包装指令」内容基础上**改写为「给 LLM 的重写指令」**）。
- TASK_TYPE / 队列路由 / intent / progress-message 新增 `AI_GRID_VIDEO_PROMPT` 接线。队列路由无需改动 `getQueueTypeByTaskType`——未列入 IMAGE/VIDEO/VOICE 集合的 type 默认进 text 队列（`src/lib/task/queues.ts:71`）；但需在 `text.worker.ts` 的 switch 中注册 handler（参照 `AI_MODIFY_SHOT_PROMPT`，`text.worker.ts:691`）。

## 8. 开放问题

- 暂无阻塞项。`gridVideoPromptAt` 命名/类型在实现时可再微调（布尔 vs 时间戳），不影响整体设计。

## 9. 审计记录（2026-06-23）

对照实际代码核实假设，修正两处错误：

1. **计费**（实质修正）：原 spec 称「把 LLM token 累加进 video task 计费 payload」。核实 `resolveTaskActual`/`settleTaskBilling`（`src/lib/billing/service.ts`）后确认：计费是「一 task = 单一 apiType + 单一 model」，video task 无法附加文本费。已改为用 `withTextBilling`（`service.ts:624`）即时独立计费。commit `616f851` 实为给「创建独立 text task 的 route」补 analysisModel，与本场景不同。
2. **模板状态**（事实修正）：原 spec 称两个 `panel_grid_video` 模板「有未提交改动」。实际它们已在 commit `f8dcec4` 提交、工作区干净。

核实无误的假设：text 队列路由（默认分支，无需改 `getQueueTypeByTaskType`）；`text.worker.ts` switch 注册 handler 的模式（`AI_MODIFY_SHOT_PROMPT`）；`executeAiTextStep` + `resolveAnalysisModel` 复用路径；UI 回写通道 `useUpdateProjectPanelVideoPrompt` 已存在；现有 grid 测试 `tests/unit/storyboard-images/grid-video-prompt.test.ts` 测的是模板填充行为，需更新。
