# 配置中心、品牌、提示词、画风与故事板生成设计

日期：2026-06-17

## 背景

`docs/req.md` 提出 4 类新版优化需求：

1. 将项目中涉及 logo 的地方替换为用户提供的新 logo。
2. 将系统提示词入库，支持版本管理和增删改查。
3. 将当前内置画风抽象为画风库，方便编辑和查看提示词。
4. 分镜图生成支持单张分镜、AI 故事板图、拼接故事板图三类能力，故事板图支持 3/6/9/n 宫格。

本设计采用「配置中心化重构」方案，但范围限定在品牌、提示词、画风和分镜故事板生成四类资源，不扩展为全系统通用配置平台。

## 目标

- 品牌统一从 `waoowaoo` 改为 `vvicat`，覆盖用户可见文案、metadata、README、`package.json` 等仓库文本与配置，但不改目录名和历史数据库数据。
- 用户提供的 base64 logo 解码为 `public` 下 PNG 文件，并作为统一 logo 文件路径使用，不在代码中长期嵌入 data URL。
- 所有 `lib/prompts` 下的现有提示词进入数据库，由管理员在后台维护草稿、发布和停用版本。
- 普通用户不能编辑提示词，也不能选择提示词版本；项目默认使用管理员发布的最新版。管理员可以在后台为指定项目锁定某个提示词版本。
- 画风库支持系统画风和用户自定义画风。管理员可编辑系统画风，用户可在个人中心维护自己的画风。
- 画风包含名称、描述、提示词、预览图、启用状态和排序信息，项目工作台只负责选择和快捷查看。
- 分镜图生成支持三类模式：单张分镜图、AI 故事板图、拼接故事板图。默认入口为 AI 故事板图。
- AI 故事板图和拼接故事板图都保存历史，并支持回滚。拼接故事板回滚时需要恢复最终故事板图和参与拼接的每个分镜图。

## 非目标

- 不修改仓库目录名 `/Users/xiaomao/Documents/fuyang/waoowaoo`。
- 不迁移历史项目名称、历史生成记录中的旧品牌字符串。
- 不开放普通用户编辑系统提示词或系统画风。
- 不把所有业务设置都纳入配置中心。本期只覆盖品牌、提示词、画风、故事板生成。
- 不要求普通用户进行提示词版本选择。提示词版本锁定只属于管理员后台能力。

## 现有上下文

- 当前项目是 Next.js + Prisma + MySQL + BullMQ/worker 架构。
- 当前提示词通过 `src/lib/prompt-i18n/template-store.ts` 从 `lib/prompts/**/*.txt` 读取，并由 `PROMPT_IDS` 和 `PROMPT_CATALOG` 管理变量。
- 当前画风主要由 `src/lib/style-presets.ts` 维护，`NovelPromotionProject` 和 `UserPreference` 中已有 `artStyle` 字段，项目中还有 `artStylePrompt` 兜底字段。
- 当前分镜数据已具备 `NovelPromotionStoryboard.storyboardImageUrl`、`NovelPromotionPanel.imageUrl`、`candidateImages`、`imageHistory` 等字段。
- 当前未发现稳定的用户角色字段。管理员机制按新增 `User.role` 设计，初始化管理员可通过环境变量或一次性脚本设置。

## 总体架构

新增「配置中心」作为系统级配置入口，拆分为 4 个资源域：

1. 品牌配置：保存品牌名、logo 路径、favicon 路径和 metadata 标题模板。
2. 提示词配置：保存提示词定义、语言版本、状态、发布记录和项目级版本覆盖。
3. 画风配置：保存系统画风和用户自定义画风。
4. 故事板生成配置：保存故事板生成模式、宫格配置、故事板图历史和回滚快照。

运行时通过服务层读取配置：

- `PromptService` 统一读取提示词。
- `ArtStyleService` 统一读取画风。
- `BrandConfigService` 统一输出品牌资源。
- `StoryboardImageService` 统一处理 AI 故事板图、拼接故事板图、历史记录和回滚。

数据库配置优先于随包文件和代码常量。为降低迁移风险，第一版保留随包文件和内置常量作为初始化种子和兜底来源。

## 权限模型

新增用户角色：

- `user`：默认普通用户。
- `admin`：管理员。

建议在 `User` 表新增 `role String @default("user")`。首次管理员可通过 `ADMIN_USER_NAMES`、`ADMIN_USER_EMAILS` 环境变量或一次性脚本提升。运行时权限判断以数据库 `role` 为准。

权限边界：

- 管理员可以访问配置中心后台。
- 管理员可以新增、编辑、发布、停用提示词版本。
- 管理员可以为项目锁定提示词版本。
- 管理员可以新增、编辑、停用系统画风。
- 普通用户可以新增、编辑、删除自己的画风。
- 普通用户只能查看和选择已启用的系统画风与自己的已启用画风。
- 普通用户不能访问提示词编辑页，不能编辑系统提示词，不能选择提示词版本。

所有配置中心写接口都需要服务端权限校验，不能只依赖前端隐藏入口。

## 数据模型

### 品牌配置

新增 `BrandConfig`，字段建议如下：

- `id`
- `brandName`
- `logoPath`
- `faviconPath`
- `metadataTitle`
- `metadataDescription`
- `updatedByUserId`
- `createdAt`
- `updatedAt`

默认配置值：

- `brandName`：`vvicat`
- `logoPath`：例如 `/vvicat-logo.png`
- `faviconPath`：例如 `/vvicat-icon.png`
- `metadataTitle`：包含 `vvicat` 的标题模板

logo 文件落地：

- 将用户提供的 base64 PNG 解码为 `public/vvicat-logo.png`。
- 需要 favicon 或小图时，可以由该 PNG 派生 `public/vvicat-icon.png`，并统一更新引用。
- 旧 `public/logo*.png` 可保留作兼容，但新代码不再引用旧品牌资源。

### 提示词配置

新增 `PromptDefinition`：

- `id`
- `promptId`：例如 `np_single_panel_image`
- `pathStem`：例如 `novel-promotion/single_panel_image`
- `category`：从路径第一段推导，例如 `novel-promotion`
- `name`
- `description`
- `variableKeys`：JSON 字符串，来源于 `PROMPT_CATALOG`，未注册文件为空数组
- `isRegistered`：是否存在于 `PROMPT_CATALOG`
- `createdAt`
- `updatedAt`

新增 `PromptVersion`：

- `id`
- `promptDefinitionId`
- `locale`：例如 `zh`、`en`
- `version`：递增整数
- `status`：`draft`、`published`、`disabled`
- `content`
- `createdByUserId`
- `publishedByUserId`
- `publishedAt`
- `disabledAt`
- `changeNote`
- `createdAt`
- `updatedAt`

约束：

- `PromptDefinition.promptId` 唯一。
- `PromptVersion(promptDefinitionId, locale, version)` 唯一。
- 同一 `promptDefinitionId + locale` 可以有多个 `published` 历史版本，但默认生效版本取 `publishedAt` 最新且未停用的版本。
- 发布时校验 `variableKeys` 中的占位符都存在于内容中，例如 `{input}`、`{style}`、`{aspect_ratio}`。

新增 `ProjectPromptOverride`：

- `id`
- `projectId`
- `promptDefinitionId`
- `locale`
- `promptVersionId`
- `createdByUserId`
- `reason`
- `createdAt`
- `updatedAt`

该表只允许管理员写入。运行时若发现项目级覆盖，使用覆盖版本；否则使用最新已发布版本。

### 画风库

新增 `ArtStyle`：

- `id`
- `scope`：`system` 或 `user`
- `ownerUserId`：系统画风为空，用户画风为创建者
- `name`
- `description`
- `prompt`
- `previewImageUrl`
- `previewMediaId`
- `enabled`
- `sortOrder`
- `createdByUserId`
- `updatedByUserId`
- `createdAt`
- `updatedAt`

项目侧新增 `NovelPromotionProject.artStyleId`，用户偏好新增 `UserPreference.artStyleId`。

兼容规则：

- 读取项目画风时优先使用 `artStyleId`。
- 若 `artStyleId` 为空或画风不可用，回退到当前 `artStyle` 和 `artStylePrompt`。
- 后续迁移稳定后再考虑清理旧字段，本期不删除旧字段。

### 故事板图历史

新增 `StoryboardImageVersion`：

- `id`
- `storyboardId`
- `mode`：`ai_storyboard` 或 `composited_storyboard`
- `imageUrl`
- `imageMediaId`
- `gridPreset`：`grid_3`、`grid_6`、`grid_9`、`grid_auto`
- `gridConfig`：JSON，记录行列、间距、背景、标题策略等
- `promptSnapshot`：AI 故事板图使用的完整提示词快照
- `sourcePanelsSnapshot`：JSON，记录拼接故事板参与的 panel 图和 media 快照
- `inputSnapshot`：JSON，记录源文本、分镜 JSON、画风、比例、模型等生成输入
- `createdByUserId`
- `createdAt`

回滚规则：

- `ai_storyboard`：恢复 `NovelPromotionStoryboard.storyboardImageUrl` 和 `media`。
- `composited_storyboard`：恢复 `NovelPromotionStoryboard.storyboardImageUrl` 和 `media`，并恢复 `sourcePanelsSnapshot` 中每个 `NovelPromotionPanel.imageUrl`、`imageMediaId`、`candidateImages` 等快照字段。
- 回滚必须在事务中完成，失败时不允许部分恢复。

## 提示词运行时

保留现有 `getPromptTemplate(promptId, locale)` 对外接口，内部改为：

1. 检查当前运行上下文是否存在项目级覆盖。如果有，读取 `ProjectPromptOverride.promptVersionId`。
2. 否则读取该 `promptId + locale` 最新已发布版本。
3. 若数据库未初始化或找不到可用版本，回退读取 `lib/prompts` 文件。
4. 发生回退时记录结构化日志，方便管理员发现缺失配置。

需要替换所有直接读取 `lib/prompts` 的代码路径，使业务运行时统一通过 `PromptService`。`PROMPT_CATALOG` 继续作为提示词注册、变量校验和迁移种子的来源。

缓存策略：

- `PromptService` 可以缓存已发布版本，但缓存必须支持短 TTL 或版本更新时间校验。
- 管理员发布或停用版本后，应失效服务端缓存。
- worker 进程也必须遵守同一缓存策略，不能长期持有旧模板。

新增 AI 故事板图提示词：

- `promptId`：`np_storyboard_grid_image`
- 变量：`storyboard_text_json_input`、`source_text`、`aspect_ratio`、`style`、`grid_layout`、`panel_count`
- 初始中文提示词：

```text
你是一名短剧分镜故事板视觉导演。请根据给定分镜 JSON 和原文片段，生成一张完整故事板图。

要求：
1. 画面必须是一张故事板，不是单个镜头。
2. 按 {grid_layout} 排列，共 {panel_count} 个分镜格，阅读顺序从左到右、从上到下。
3. 每个分镜格要表现对应分镜的主体、场景、动作、情绪和镜头关系。
4. 全图保持统一画风：{style}
5. 最终图片比例为 {aspect_ratio}。
6. 不要生成中文或英文文字、水印、编号、对白气泡和界面元素。
7. 分镜格之间需要有清晰边界，但不要让边框压过主体。
8. 角色外貌、服装、场景和道具需要在多个分镜格中保持一致。

分镜 JSON：
{storyboard_text_json_input}

原文片段：
{source_text}
```

## 画风运行时

`ArtStyleService` 提供：

- 查询系统启用画风。
- 查询当前用户启用画风。
- 合并系统画风与用户画风，供项目工作台选择。
- 根据 `artStyleId` 解析生成用 `stylePrompt`。
- 当画风被停用或删除时，返回默认系统画风并给出可展示的回退原因。

画风使用规则：

- 项目生成图片、角色、场景、单张分镜和 AI 故事板图时，只消费解析后的 `stylePrompt`。
- 生成服务不直接读取 UI 选项，也不依赖旧 `style-presets.ts` 常量。
- 系统画风和用户画风同名时，显示时需要带来源标识，保存时以 `artStyleId` 为准。

## 故事板生成模式

新增三类模式：

1. `single_panel`：逐个 `NovelPromotionPanel` 生成单张分镜图，保持现有工作流能力。结果写入 panel 图字段，后续视频继续使用这些单张图。
2. `ai_storyboard`：默认模式。图片模型一次生成完整故事板图，结果写入 `NovelPromotionStoryboard.storyboardImageUrl`，同时创建 `StoryboardImageVersion`。
3. `composited_storyboard`：服务端读取当前 panel 图，用图像处理拼接成一张故事板图，结果写入 `storyboardImageUrl`，同时创建 `StoryboardImageVersion`。用户可以先编辑每个分镜图，再重新拼接。

宫格规则：

- `grid_3`：1 列 3 行，最多容纳 3 个分镜。
- `grid_6`：2 列 3 行，最多容纳 6 个分镜。
- `grid_9`：3 列 3 行，最多容纳 9 个分镜。
- `grid_auto`：按当前 panel 数自动生成 n 宫格，默认最多 3 列，行数向上取整。

固定宫格容量不足时，前端应禁用该选项并提示使用 n 宫格。panel 数少于固定宫格容量时，空格保持留白或透明背景，不生成虚构分镜。

拼接实现建议：

- 使用现有 `sharp` 依赖在服务端完成拼接。
- 拼接前检查所有参与 panel 是否有可用图。
- 缺图时阻止拼接，并返回缺失 panel 编号。
- 拼接图写入统一媒体存储，避免仅保存外部临时 URL。

## 页面与交互

### 管理员后台

新增配置中心入口，包含：

- 品牌配置：查看品牌名、logo、favicon、metadata。首版重点完成 `vvicat` 固化和资源替换，后台可先提供只读展示。
- 提示词库：按分类、语言、状态筛选；查看变量列表；编辑草稿；发布新版本；停用版本；查看历史；为指定项目锁定提示词版本。
- 系统画风库：新增、编辑、停用系统画风；维护提示词、描述、预览图和排序。

### 个人中心

新增画风库入口：

- 普通用户新增、编辑、删除自己的画风。
- 普通用户上传或生成画风预览图。
- 普通用户启用或停用自己的画风。
- 系统画风只读展示，可复制为个人画风后修改。

### 项目工作台

项目工作台只暴露使用层能力：

- 项目设置中选择画风，列表包含系统画风和自己的画风。
- 选择画风时可快捷查看提示词和预览图。
- 分镜图生成区域默认选中 AI 故事板图。
- 同一区域提供单张分镜图和拼接故事板图入口。
- 拼接故事板图入口允许选择 3/6/9/n 宫格。
- 故事板图区域显示当前最终图，无论来源是 AI 故事板还是拼接故事板。
- 历史面板展示生成方式、创建时间、宫格配置、缩略图，并提供回滚。

## 迁移方案

### 品牌迁移

1. 将用户提供的 base64 PNG 解码为 `public/vvicat-logo.png`。
2. 若需要 favicon，生成 `public/vvicat-icon.png` 或更新现有 favicon 引用。
3. 全仓库替换用户可见文案和配置中的 `waoowaoo` 为 `vvicat`。
4. 不改仓库目录名，不改历史数据库数据。

### 提示词迁移

1. 扫描 `lib/prompts/**/*.txt`。
2. 通过 `PROMPT_CATALOG` 匹配已注册提示词，写入 `PromptDefinition`。
3. 对未注册但存在于 `lib/prompts` 的文件，也写入 `PromptDefinition`，标记 `isRegistered=false`。
4. 按语言写入初始 `PromptVersion`，状态为 `published`，版本号为 1。
5. 迁移脚本必须幂等。重复执行不能生成重复定义或重复初始版本。

### 画风迁移

1. 将当前 `style-presets.ts` 中的内置画风写入系统画风。
2. 默认系统画风至少包含当前项目默认值 `american-comic` 的可用记录。
3. 为已有项目尽量补充 `artStyleId`；无法匹配时保留旧字段兜底。

### 运行时切换

1. `getPromptTemplate` 内部切换到 `PromptService`。
2. 画风选择和生成链路切换到 `ArtStyleService`。
3. 故事板生成接口新增模式参数。
4. 旧字段和文件兜底保留到本期验收完成后。

## 错误处理

- 提示词没有已发布版本时，回退文件默认提示词，并记录管理员可排查日志。
- 提示词变量校验失败时禁止发布，并展示缺失变量。
- 普通用户访问管理员接口时返回权限错误。
- 用户选择的画风被停用或删除时，项目回退默认系统画风，并展示可理解提示。
- AI 故事板生成失败时保留上一张故事板图，不覆盖历史。
- 拼接故事板缺少 panel 图时阻止拼接，并列出缺失分镜。
- 故事板回滚失败时不做部分提交。
- 数据库配置读取失败时，运行时允许使用兜底配置，但后台页面应提示配置服务异常。

## 测试策略

### 单元测试

- 提示词迁移：导入、幂等、变量列表保留。
- 提示词发布：变量缺失禁止发布。
- `PromptService`：数据库读取、项目覆盖、文件兜底、缓存失效。
- `ArtStyleService`：系统+用户画风合并、停用回退、同名来源展示。
- 宫格布局：3/6/9/n 行列计算、容量不足禁用、缺图报错。

### 集成测试

- 普通用户不能编辑提示词和系统画风。
- 管理员可以创建草稿、发布、停用提示词版本。
- 管理员可以为项目锁定提示词版本，运行时读取锁定版本。
- 用户可以创建个人画风并在项目中选择。
- AI 故事板图生成成功后写入 `storyboardImageUrl` 和历史版本。
- 拼接故事板图生成成功后写入 `storyboardImageUrl`、历史版本和 panel 快照。
- 拼接故事板历史回滚恢复最终图和 panel 图。

### 回归与守卫

- 品牌主要入口不再显示 `waoowaoo`。
- metadata、Navbar、公共资源路径使用 `vvicat`。
- `getPromptTemplate` 现有调用方不需要改调用签名。
- 现有单张分镜图生成和视频生成不因新增模式回归。

## 验收标准

- `docs/req.md` 保留原始提纲，本规格作为详细设计文档存在。
- 新品牌 `vvicat` 在用户可见页面、metadata 和仓库配置中生效。
- 新 logo 以 `public` 下 PNG 文件方式统一引用。
- 管理员可以在后台管理全部提示词文件对应的数据库版本。
- 提示词版本生命周期支持草稿、已发布、已停用。
- 普通用户不能编辑提示词，也不能选择提示词版本。
- 管理员可以为项目锁定提示词版本。
- 管理员可以管理系统画风。
- 普通用户可以在个人中心管理自己的画风。
- 项目工作台可以选择系统画风和用户画风。
- 分镜图生成默认模式为 AI 故事板图。
- 单张分镜图、AI 故事板图、拼接故事板图三类能力都可用。
- AI 故事板图和拼接故事板图都保存历史。
- 拼接故事板图回滚会恢复最终故事板图和参与拼接的每个分镜图。
