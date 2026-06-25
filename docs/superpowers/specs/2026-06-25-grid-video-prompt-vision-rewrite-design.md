# 宫格视频提示词 Vision 重写 — 设计文档

**日期**：2026-06-25
**作者**：fuyang + Claude
**关联**：`2026-06-23-grid-video-prompt-llm-rewrite-design.md`（一期纯文本重写）

## 1. 背景与问题

一期已实现宫格面板的纯文本 LLM 重写（`rewriteGridVideoPrompt`），但 LLM 仅基于面板的结构化文本上下文（`description`/`shot_type`/`cameraMove`/`characters`/`location`/`srtSegment` 等）理解宫格意图。**LLM 看不到实际的宫格分镜图**——它不知道每个格子具体画了什么、角色的实际姿态、场景的光影细节。这导致重写出的视频提示词可能与宫格图的视觉内容存在偏差。

**核心诉求**：让 LLM **真正"看"到宫格分镜图**，结合生成该图时的完整元数据，按 Seedance 规范重写视频提示词。

## 2. 目标与非目标

### 目标
- 宫格图生成时保存完整的生成上下文（`buildPanelPromptContext` 的 JSON 输出）。
- 视频阶段支持 **vision 路径**：把宫格图（base64）+ 保存的生成上下文 JSON 一起喂给 vision-capable LLM，让它逐格分析视觉内容后重写。
- 支持 **text fallback**：未配置 vision model 时，用保存的完整上下文做纯文本重写（比一期从各字段重新组装更忠实）。
- 新增项目级 `gridVideoPromptVisionModel` 配置，用户自选 vision-capable 模型。
- 手动重生按钮（`AI_GRID_VIDEO_PROMPT`）同样支持 vision/text 双路径。

### 非目标
- **不**改动宫格图生成逻辑（`panel-image-task-handler.ts` 只增加保存字段）。
- **不**改动单镜头（`imageLayout='single'`）面板的视频提示词路径。
- **不**支持实时 vision（不实时截图/抓图，只用已生成的宫格图）。
- **不**要求所有用户必须配 vision model（text fallback 保证零配置也可用）。

## 3. 关键设计决策（已与用户确认）

| 决策点 | 选择 |
| --- | --- |
| Vision model 配置 | 新增专用 `gridVideoPromptVisionModel` 字段（项目级，可选） |
| 保存的上下文来源 | `buildPanelPromptContext` 的完整 JSON（宫格图生成时的原始输入） |
| 双路径策略 | 配了 vision model + 有宫格图 → vision；否则 → text fallback |
| Vision 输入 | 宫格图 base64 + 生成上下文 JSON + prompt 模板 |
| Billing | Vision 路径同样用 `withTextBilling` 即时计费（text 同价） |

## 4. 架构与数据流

### 4.1 总览

```
[生成宫格图] ──► panel-image-task-handler
                     │
                     └─► 保存 contextJson → panel.gridGenerationContext

[生成宫格视频] ──► video.worker 宫格分支
                     │
                     ├─ 有 gridVideoPromptVisionModel + panel.imageUrl ?
                     │    ├─ YES ──► rewriteGridVideoPrompt(vision)
                     │    │              ├─ 图转 base64
                     │    │              ├─ executeAiVisionStep(图 + context + prompt)
                     │    │              └─ 回写 videoPrompt + gridVideoPromptAt
                     │    └─ NO  ──► rewriteGridVideoPrompt(text)
                     │                 └─ executeAiTextStep(context + prompt)
                     │
                     └─ 用 videoPrompt 生成视频
```

### 4.2 新增 / 改动的单元

**① Prisma 字段**

`NovelPromotionPanel` 新增：
- `gridGenerationContext String? @db.Text` — 宫格图生成时的完整 `buildPanelPromptContext` JSON

`NovelPromotionProject` 新增：
- `gridVideoPromptVisionModel String?` — 宫格视频提示词 vision 模型（`provider:modelId` 格式），可选

**② `buildPanelPromptContext` 复用 + 保存（panel-image-task-handler.ts）**

宫格图生成分支（`panelGridSize > 1`）中，`contextJson = JSON.stringify(promptContext)` 已存在。在 `prisma.novelPromotionPanel.update` 的 `data` 中增加 `gridGenerationContext: contextJson`。

> 注意：需一并写入 Task 5 的 `gridVideoPromptAt: null`（宫格图重新生成时清空重写标记）。

**③ `rewriteGridVideoPrompt` 重构为双路径（grid-video-prompt.ts）**

输入新增：
- `imageUrl?: string` — 宫格图 URL（vision 路径需要）
- `visionModel?: string` — 配置的 vision model
- `gridGenerationContext: string` — 保存的生成上下文 JSON（替代一期的手工 `panelContext` 组装）

输出不变： `{ prompt; promptTokens; completionTokens } | null`

内部逻辑：
```
if (visionModel && imageUrl) {
  // Vision 路径
  const imageBase64 = await normalizeToBase64ForGeneration(imageUrl)
  const visionPrompt = await buildPromptAsync({
    promptId: PROMPT_IDS.NP_PANEL_GRID_VIDEO_VISION, // 新模板
    variables: { storyboard_context_json: gridGenerationContext, ... }
  })
  const completion = await executeAiVisionStep({
    model: visionModel, userId, projectId,
    prompt: visionPrompt, imageUrls: [imageBase64],
    ...
  })
  return parseResult(completion)
} else {
  // Text fallback（复用一期逻辑，但 context 来自 gridGenerationContext）
  const textPrompt = await buildPromptAsync({
    promptId: PROMPT_IDS.NP_PANEL_GRID_VIDEO,
    variables: { storyboard_context_json: gridGenerationContext, ... }
  })
  const completion = await executeAiTextStep({...})
  return parseResult(completion)
}
```

**④ 新 prompt 模板（vision 版）**

`lib/prompts/novel-promotion/panel_grid_video_vision.{zh,en}.txt`：
- 要求 LLM 分析上传的宫格图每个格子的视觉内容（角色姿态、表情、场景、光影、道具）。
- 结合 `storyboard_context_json`（生成时的完整元数据）理解每个格子的意图。
- 按 Seedance 时间戳分镜规范输出一条视频提示词。
- 明确提示："请基于你看到的图像和提供的结构化信息，逐格分析后重写。"

**⑤ video.worker 宫格分支改造**

- 加载 panel 时同时取 `gridGenerationContext`。
- 解析项目配置中的 `gridVideoPromptVisionModel`（通过 `getProjectModels` 或新增查询）。
- 调用 `rewriteGridVideoPrompt` 时传入 `imageUrl` + `visionModel` + `gridGenerationContext`。
- 计费：`withTextBilling` 包裹（vision 和 text 都走同一计费路径，apiType='text'，按 analysisModel 价）。

**⑥ 手动重生 handler（grid-video-prompt-rewrite.ts）**

- 加载 panel 时取 `gridGenerationContext`。
- 同样走 `rewriteGridVideoPrompt` 的双路径逻辑（vision 优先）。
- 回写 `videoPrompt` + `gridVideoPromptAt`。

**⑦ 项目配置 UI**

- 项目设置页面（`/admin` 或 workspace 设置）新增「宫格视频提示词 Vision 模型」下拉选择。
- 选项来源：用户已配置的、支持 vision 的模型列表（或不做过滤，让用户自选）。
- 未配置时显示提示文案："未配置 vision 模型时将使用纯文本路径重写提示词"。

**⑧ 测试**

- 单测 `rewriteGridVideoPrompt`：mock `executeAiVisionStep` 和 `executeAiTextStep`，验证 vision 路径和 text fallback 分支。
- 单测 panel-image handler：验证 `gridGenerationContext` 写入。
- 单测 video.worker 宫格分支：验证 vision model 存在时走 vision 路径。

## 5. 错误处理

- `gridGenerationContext` 为空（旧数据/单镜头图）：text fallback 用一期方式从各字段组装 context（向后兼容）。
- `imageUrl` 无效/下载失败：vision 路径降级为 text fallback，记 warn 日志。
- vision model 未配置或无效：`resolveAnalysisModel` 抛错 → text fallback。
- LLM vision 调用失败（返回 null）：text fallback（不阻塞视频生成）。

## 6. 影响面 / 迁移

- Prisma：新增 `gridGenerationContext`（panel）和 `gridVideoPromptVisionModel`（project），需 `prisma db push`。
- Prompt 模板：新增 `panel_grid_video_vision.{zh,en}.txt`。
- i18n：新增项目设置页面文案。
- 一期代码：`rewriteGridVideoPrompt` 参数扩展，`panelContext` 参数被 `gridGenerationContext` 替代（或共存兼容）。
- 旧宫格面板：`gridGenerationContext` 为空，自动走 text fallback + 字段组装（兼容）。

## 7. 开放问题

- `gridVideoPromptVisionModel` 的候选列表是否过滤 vision-capable 模型？实现时可先做全量列表，后续加 capability 过滤。
- Vision 路径的 `imageUrls` 支持 base64 字符串直接传入（需确认 `executeAiVisionStep` 的 `imageUrls` 是否支持 data URL 或仅限 http URL）。若仅支持 http URL，需先生成 signed URL。
