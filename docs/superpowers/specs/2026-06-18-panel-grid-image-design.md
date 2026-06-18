# 镜头级分镜（N 宫格）图生成设计

**日期**：2026-06-18
**作者**：fuyang + Claude
**关联分支**：`feat/panel-grid-image`（待创建）

## 背景与动机

当前分镜（Storyboard）阶段提供两种"宫格图"能力，作用在**片段（StoryboardGroup）**层级：

1. **AI 生成故事板**：调模型一次性生成一张包含 N 个分镜的宫格大图（`handleStoryboardImageTask` + `NP_STORYBOARD_GRID_IMAGE` prompt）
2. **拼接故事板**：把片段下所有镜头已有的图片用 `sharp` 拼接成一张宫格图（`composeGridImage`）

实际产品里，宫格图的语义其实属于**单镜头**——用户希望对一个镜头内的多个分镜（angle/瞬间/构图变体）一次性生成一张大图来观察整体效果。当前"以片段为单位"的设计与心智模型不符，且 UI 上 `n宫格 select + AI生成故事板 + 拼接故事板` 三按钮挤在片段标题栏，造成认知负担。

## 目标

把"N 宫格"能力从片段层下沉到**单镜头层**：
- 镜头层"生成图片" / "重新生成"按钮旁新增**两个并列下拉**：分镜数 `1–16`、候选数 `1–4`
- 分镜数 = 1 → 与今天行为完全一致（单图）
- 分镜数 > 1 → 调模型生成一张含 N 个子图的宫格大图
- 候选数 K → 生成 K 张这样的大图，进入现有候选选择流程，用户挑 1 张
- 移除片段层的 `AI生成故事板`、`拼接故事板` 按钮与 `gridPreset select`
- 后端 AI 宫格生成能力（worker + prompt）保留，仅删除拼接服务（`composeGridImage` 等）

## 非目标

- 不动后端 `handleStoryboardImageTask` 与 `NP_STORYBOARD_GRID_IMAGE`（保留作为兜底/未来批量入口）
- 不迁移历史 `StoryboardImageVersion` 记录
- 不引入"按 N 加价"的计费逻辑（仍按 candidateCount 计费）
- 不提供"从宫格图抽取单格作为 panel.imageUrl"能力（后续单独迭代）

## 用户故事

- 作为用户，点击单镜头的"生成图片"按钮，可以在原位通过下拉选择"分镜数=6 / 候选数=2"，得到 2 张 6 宫格图作为候选，从中挑选 1 张作为该镜头最终图
- 分镜数与候选数选择被记忆（localStorage），下次打开默认沿用

## 需求矩阵（决策摘要）

| 维度 | 决策 |
|------|------|
| 触发位置 | 镜头级 ImageSection（空态 + 已有图态），两个并列内联下拉，**不弹窗** |
| 下拉 1：分镜数 | 1–16，全局 localStorage 记忆，新 scope `storyboard-grid` |
| 下拉 2：候选数 | 1–4，沿用现有 `storyboard-candidates` scope |
| N 宫格语义 | 调模型生 1 张含 N 个分镜的大图（`panel.imageUrl` 直接是这张大图） |
| 候选机制 | 沿用现有 `candidateImages`：候选数=K 生 K 张大图，K=1 直接落 `imageUrl`，K>1 进选择模式 |
| 视频生成 | 不动 — 宫格图直接作为视频参考图 |
| 宽高比 | 整张宫格保持 `videoRatio`，子格被压缩 |
| 后端清理 | 保留 AI 宫格生成 worker；删除 `composeGridImage` 拼接服务 |

## 实现方案：方案 B（panel 任务 payload 扩展）

镜头任务路由不变（`POST /api/novel-promotion/[projectId]/regenerate-panel-image` → `TASK_TYPE.IMAGE_PANEL` → `handlePanelImageTask`），通过 payload 新增 `panelGridSize` 字段控制宫格生成。Prompt 在 `panelGridSize > 1` 时切换到新 prompt id `NP_PANEL_GRID_IMAGE`。

### Section 1：UI 变更

#### 镜头层（保留并增强）

**`ImageSection` 空态**：

```
┌──────────────┐
│  待生成      │
│  [生成图片]  │
│              │
│  分镜数:1▾   │
│  候选数:1▾   │
└──────────────┘
```

- 分镜数下拉 1–16，使用 `useImageGenerationCount('storyboard-grid')` 持久化
- 候选数下拉 1–4，沿用 `useImageGenerationCount('storyboard-candidates')`
- 点"生成图片" → 调 `onRegeneratePanelImage(panelId, candidateCount, false, panelGridSize)`

**`ImageSectionActionButtons`（已有图后底部条）**：

替换原"重新生成 1（candidateCount 下拉）"为：

```
[↻ 重新生成]  [分镜数 6 ▾]  [候选数 1 ▾]  | [查看AI数据] [AI修图] [撤回]
```

- 点"重新生成" → 同上 mutation，`force=true`（与现 `isSubmittingPanelImageTask ? force=true : false` 语义一致）

#### 片段层（移除）

`StoryboardGroupActions` 删除以下 UI 元素：
- `<select value={gridPreset}>` 下拉
- `AI生成故事板` 按钮（`onCreateAiStoryboardImage`）
- `拼接故事板` 按钮（`onCreateCompositedStoryboardImage`）

保留的动作：
- `重新生成文字`、`生成全部分镜`（pending 时）、`添加镜头`、`删除`

`StoryboardGroup`/`StoryboardCanvas`/`StoryboardGroupDialogs` 父组件不再传递 `gridPreset`、`onCreateAiStoryboardImage`、`onCreateCompositedStoryboardImage` 等 prop（接口收窄）。`storyboard.storyboardImageUrl` 大图区块（如有渲染）一并移除。

### Section 2：前端数据流

#### Mutation 签名扩展

`useRegenerateProjectPanelImage` 入参：

```ts
// before
{ panelId: string; count?: number }

// after
{ panelId: string; count?: number; panelGridSize?: number }
```

透传 `panelGridSize` 到 API body。

#### Hook 链路

`useImageGeneration`（aka `useStoryboardImageGeneration`）暴露的 `onRegeneratePanelImage` 签名：

```ts
// before
(panelId: string, count?: number, force?: boolean) => void

// after
(panelId: string, candidateCount?: number, force?: boolean, panelGridSize?: number) => void
```

`ImageSection` / `ImageSectionActionButtons` 内部各持有两个独立 `useImageGenerationCount` hook，分别对应两个 scope。

#### 删除/简化

`useImageGeneration` 移除：
- `gridPreset` 状态及其 setter
- `createAiStoryboardImage` mutation 调用
- `createCompositedStoryboardImage` mutation 调用
- `useCreateProjectStoryboardImage` 的 import 与使用

`StoryboardCanvas` / `StoryboardGroup` 移除以上对应 prop 链路。

#### 候选机制（无改动）

后端返回多张时仍写入 `panel.candidateImages`，前端 `usePanelCandidates` + `ImageSectionCandidateMode` 沿用。K=1 时直接落 `imageUrl`，K>1 时进入候选选择模式 —— **与今天行为一致**。

#### 持久化新增

`src/lib/image-generation/count.ts`：

```ts
'storyboard-grid': {
  defaultValue: 1,
  min: 1,
  max: 16,
  storageKey: 'image-count:storyboard-grid',
}
```

`ImageGenerationCountScope` 联合类型增加 `'storyboard-grid'`。

### Section 3：后端 API & Worker

#### API 路由 `POST /api/novel-promotion/[projectId]/regenerate-panel-image`

```ts
const panelGridSize = Math.max(1, Math.min(16, Number(body?.panelGridSize ?? 1)))
```

- 写入 `billingPayload.panelGridSize` 透传到 task payload
- `dedupeKey` 扩展为 `image_panel:${panelId}:${candidateCount}:${panelGridSize}` —— 让"换分镜数重新生成"不被去重打回

#### Worker `handlePanelImageTask`

读取并校验：

```ts
const panelGridSize = clampCount(payload.panelGridSize, 1, 16, 1)
```

**当 `panelGridSize === 1`**：走现有路径，prompt 不变，回归行为。

**当 `panelGridSize > 1`**：
- `buildStoryboardGridLayout('grid_auto', panelGridSize)` 复用行列计算（`grid_auto` 已支持任意 N≥1，columns = min(3, N)，rows = ceil(N / columns)）
- `formatGridLayout(layout, locale)` 生成"行 × 列共 N 个分镜"的中/英描述
- prompt 切换到 `PROMPT_IDS.NP_PANEL_GRID_IMAGE`，注入变量：
  - `aspect_ratio = projectData.videoRatio`（整张宫格保持视频比例）
  - `grid_layout`（如"3 行 2 列共 6 个分镜"）
  - `panel_grid_size = String(panelGridSize)`
  - 其他 panel 上下文变量与单图 prompt 共用（`storyboard_text_json_input`、`source_text`、`style`）

#### 新 Prompt: `NP_PANEL_GRID_IMAGE`

通过 `prompt-i18n` 系统注册（`PromptDefinition` + `PromptVersion`），由 `scripts/seed-prompt-config.ts` 写入。初始内容基于 `NP_STORYBOARD_GRID_IMAGE` 改写，但视角从"片段全文 storyboard"切换到"单镜头多分镜变体"，**强调**：

> 在一张画布上画 N 个子图，整体保持 `{aspect_ratio}` 比例，N 个子图围绕同一镜头主体（角色/场景/动作）的不同 angle、瞬间、构图变体，**而非 N 个独立故事板分镜**。

变量列表：`aspect_ratio`、`storyboard_text_json_input`、`source_text`、`style`、`grid_layout`、`panel_grid_size`。

#### 输出处理（不改）

仍走现有 `for (let i = 0; i < candidateCount; i++)` 循环，每次产出一张完整宫格图，写入 `candidateImages` / `imageUrl`。

#### 计费

`buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, billingPayload)` 已基于 `candidateCount` 计费；分镜数 N 不增加生成次数，暂不引入"按 N 加价"。

### Section 4：清理 — 拼接能力下线

#### 前端删除

`StoryboardGroupActions.tsx`：
- 删除 `gridPreset`、`onCreateAiStoryboardImage`、`onCreateCompositedStoryboardImage`、`isSubmittingStoryboardTask`、`isCompositingStoryboardImage`、`canCompositeStoryboardImage` props 与对应 UI
- 删除 `GRID_OPTIONS` 常量

`StoryboardGroup` / `StoryboardCanvas` / `StoryboardGroupDialogs`：删除拼接相关状态机、错误展示、对话框传参链路。

`useImageGeneration`：移除 `gridPreset`、`createAiStoryboardImage`、`createCompositedStoryboardImage` 字段。

`useCreateProjectStoryboardImage`（前端 mutation hook）在所有 caller 移除后随之删除。

#### 后端删除

`src/lib/storyboard-images/service.ts`：
- 删除 `composeGridImage`
- 删除 `fetchPanelImageBuffer`
- 删除 `resolveCellSize`、`resolveGap`
- 删除 `buildSourcePanelsSnapshot`
- 删除 `createCompositedStoryboardImage`
- 删除 `StoryboardPanelForComposite` 等只服务 composite 的类型
- **保留** `persistAiStoryboardImage`、`findStoryboardForProject`/`findStoryboardForImageTask`（worker 仍用）

`POST /api/novel-promotion/[projectId]/storyboard-images` 路由：仅保留 `mode: 'ai_storyboard'` 分支（如果路由还需要保留作为后端能力的 HTTP 触发口）；删除 `mode: 'composited_storyboard'` 分支。

> 落实施时需确认：移除前端入口后此路由是否仍有 caller。若无，整体路由可删除（YAGNI）。

#### 数据库（不动）

- `StoryboardImageVersion` 表的 `mode='composited_storyboard'` 历史记录保留（审计）
- `NovelPromotionStoryboard.storyboardImageUrl` 字段保留，但 UI 不再渲染

#### 任务/后端兜底（保留）

`TASK_TYPE.STORYBOARD_IMAGE` 的 worker、handler、prompt、grid layout 计算 **全部保留**（按 Q7 决策）。

#### i18n

删除 key（具体路径以现有 i18n 文件为准）：
- `storyboard.storyboardImage.compose`
- `storyboard.storyboardImage.aiGenerate`
- `storyboard.storyboardImage.gridPreset`
- `storyboard.storyboardImage.grid3` / `grid6` / `grid9` / `gridAuto`
- `storyboard.storyboardImage.missingPanelImages`

新增 key：
- `storyboard.image.panelGridSize.label`（"分镜数"）
- `storyboard.image.candidateCount.label`（"候选数"，如还没有）

#### 收尾

落实施时跑一次：
```
grep -rn "composited_storyboard\|composeGridImage\|createCompositedStoryboardImage" src/
```
确认零残留。

### Section 5：测试

#### 新增/扩展

`tests/unit/worker/panel-image-task-handler.test.ts`：
- `panelGridSize=1`：与今天行为一致（回归）
- `panelGridSize=6`：prompt 包含 `grid_layout` 描述、`aspectRatio === videoRatio`、prompt id 切换到 `NP_PANEL_GRID_IMAGE`
- `panelGridSize=6, candidateCount=2`：仍生成 2 个 candidate，`candidateImages` 写入 2 张 URL
- 边界：`panelGridSize=0/-1/17/'foo'` 都被 clamp 到 [1,16]

API 路由层 dedupeKey 测试（如已有 image_panel 路由集成测试）：相同 `panelId` 不同 `panelGridSize` 不互相去重。

#### 回归

- `tests/unit/worker/storyboard-image-task-handler.test.ts`：保留，验证后端 AI 故事板能力未受影响
- 候选选择/确认流程：`candidateImages` 写入与 `usePanelCandidates` 链路无 regression

#### 删除

- `composeGridImage` / `createCompositedStoryboardImage` 相关单测

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 模型把 N 宫格当 N 个独立 storyboard panel | Prompt 明确"围绕同一镜头主体的多个 angle/瞬间/构图变体"，提供 1 个 fixture sample；落实施时人工验证 1/3/6/9/16 各跑一次 |
| 视频生成对宽屏宫格图理解不可控 | 已确认（Q9）不动，由用户自行评估；UI 不加阻断 |
| `dedupeKey` 历史值与新值在 24h 内冲突 | 新格式包含 `panelGridSize`，老任务自然 expire |
| `storyboard-grid` localStorage 在 SSR 首屏闪烁 | 沿用 `useImageGenerationCount` 现有 lazy init 模式（已处理 SSR） |
| 删除 composite 分支后 `mode` 字段成单一值 | API body schema 收窄到 `mode: 'ai_storyboard'`；服务层 `mode` 入参可移除（YAGNI） |
| 大 N（如 16）下模型生成质量下降 | UI 不限制；用户自由选择，文档/tooltip 说明"建议常用 1/3/6/9" |

## 关键文件落点

**新增**：
- Prompt seed: `scripts/seed-prompt-config.ts` 增加 `NP_PANEL_GRID_IMAGE` 定义与初始版本
- i18n key（按 Section 4 列举）

**修改**：
- `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/ImageSection.tsx`
- `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/ImageSectionActionButtons.tsx`
- `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/useImageGeneration.ts`
- `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroupActions.tsx`（瘦身）
- `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroup.tsx`
- `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardCanvas.tsx`
- `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroupDialogs.tsx`
- `src/lib/query/mutations/storyboard-panel-mutations.ts`（`useRegenerateProjectPanelImage` 入参 + 移除 `useCreateProjectStoryboardImage` 如无 caller）
- `src/lib/image-generation/count.ts`（新 scope `storyboard-grid`）
- `src/app/api/novel-promotion/[projectId]/regenerate-panel-image/route.ts`（新参数 + dedupeKey）
- `src/lib/workers/handlers/panel-image-task-handler.ts`（grid 分支 + prompt 切换）
- `src/app/api/novel-promotion/[projectId]/storyboard-images/route.ts`（删除 composite 分支或整体删除）
- `src/lib/storyboard-images/service.ts`（瘦身）
- 对应 i18n 文件 `messages/{locale}/`

**删除**：
- `composeGridImage`、`createCompositedStoryboardImage` 函数体
- 拼接相关测试
- 拼接相关 i18n key
- （可能）`useCreateProjectStoryboardImage` 整个 hook

## 实施顺序

1. **后端基建**：`scripts/seed-prompt-config.ts` 添加 `NP_PANEL_GRID_IMAGE` → API 路由校验 `panelGridSize` → `handlePanelImageTask` 适配 grid 分支
2. **前端接通**：`useImageGenerationCount` 新 scope → `useImageGeneration` 签名扩展 → `ImageSection` / `ImageSectionActionButtons` 双下拉 UI
3. **端到端验证**：手动跑 1/3/6/9/16 宫格各一次，候选数 1 / 2 各一次，确认输出符合预期
4. **清理**：移除片段层 UI（`StoryboardGroupActions` 瘦身、prop 链路收窄）
5. **拼接服务下线**：删除 `composeGridImage` / `createCompositedStoryboardImage` / 相关路由分支 / 前端 hook
6. **测试与 i18n**：新增/扩展测试，删除拼接相关测试与 i18n key
7. **验证**：`npm run verify:commit`（lint + typecheck + tests），`grep` 收尾确认零残留
