# Task 1.3 Report: Editor Project CRUD API

## 改动文件
- `src/app/api/novel-promotion/[projectId]/editor/route.ts`
- `tests/integration/api/editor-project-api.test.ts`
- `.superpowers/sdd/task-1.3-report.md`

## 复用的真实 auth/error 工具
- `apiHandler(handler)` from `@/lib/api-errors`
  - 真实签名：`apiHandler<TParams extends RouteParams>(handler: (req: NextRequest, ctx: { params: Promise<TParams> }) => Promise<Response | NextResponse>)`
  - 用于统一 request id、日志和 `ApiError` 转响应。
- `ApiError` from `@/lib/api-errors`
  - 真实签名：`new ApiError(code: UnifiedErrorCode, details?: Record<string, unknown>)`
  - 用于 `INVALID_PARAMS`、`NOT_FOUND`、`CONFLICT`。
- `getAuthSession()` from `@/lib/api-auth`
  - 真实签名：`getAuthSession(): Promise<AuthSession | null>`
  - 本路由通过 session user id + `project.findFirst({ id, userId })` 验证项目归属，使他人项目对当前用户表现为 404。
- `unauthorized(message?)`, `notFound(resource?)`, `isErrorResponse(result)` from `@/lib/api-auth`
  - 用于保持项目现有错误响应结构。

## 实现说明
- `GET /api/novel-promotion/[projectId]/editor?episodeId=...`
  - 校验登录。
  - 校验 `projectId` 属于当前用户；不存在或不属于当前用户返回 `NOT_FOUND` / 404。
  - 校验 episode 属于该 project：`novelPromotionEpisode.findFirst({ id: episodeId, novelPromotionProject: { projectId } })`。
  - 读取 `prisma.novelPromotionEditorProject.findUnique({ where: { episodeId } })`。
  - 返回 `{ data: editorProject | null }`。
- `PUT /api/novel-promotion/[projectId]/editor`
  - body: `{ episodeId, projectData, version? }`。
  - 校验登录、项目归属、episode 归属。
  - 不存在则创建 `NovelPromotionEditorProject`，`version = 1`。
  - 已存在则必须提交与当前一致的 `version`，成功后 `version: { increment: 1 }`。
  - 返回 `{ data: editorProject }`，包含 `id/episodeId/projectData/version/renderStatus/renderOutputMediaObjectId/renderSettings/renderTaskId/createdAt/updatedAt`。

## 乐观锁与冲突
- 冲突条件：已有 editor project 且 `existing.version !== body.version`。
- 冲突错误：`new ApiError('CONFLICT', { currentVersion, message: 'Editor project has been modified elsewhere' })`。
- HTTP 状态：项目统一错误码 `CONFLICT`，真实配置为 409（`src/lib/errors/codes.ts`）。

## 测试
- 新增 `tests/integration/api/editor-project-api.test.ts`，覆盖：
  - GET 未授权 → 401。
  - GET 他人项目 → 404。
  - PUT 创建新项目成功，version=1。
  - PUT 更新 version 递增。
  - PUT 版本冲突 → 409。
- TDD RED：初次可运行测试在旧实现下失败：3 failed / 2 passed，失败原因是旧 route 使用 legacy `videoEditorProject` 响应格式且没有乐观锁冲突。
- GREEN 命令：
  - `BILLING_TEST_BOOTSTRAP=1 npx vitest run tests/integration/api/editor-project-api.test.ts --reporter=dot`
  - 结果：通过，`1 passed`, `5 passed`。

## 与 brief 的偏差
- brief 推测使用 `checkAuth` / `handleApiError`；真实项目该路由和同目录路由使用 `apiHandler` + `ApiError` + `@/lib/api-auth` 工具。
- 为满足“他人项目返回 404”并避免泄露多租户资源，本路由没有直接复用 `requireProjectAuthLight`（它对存在但不属于当前用户的项目返回 403），而是复用真实 `getAuthSession` 并用 `project.findFirst({ id, userId })` 验证归属。
- 测试中 `getAuthSession` 被 mock：真实 `getAuthSession` 在 Vitest 直接调用 route handler 时会触发 Next.js `headers()` request-scope 限制；这是现有 API route tests 中 mock `@/lib/api-auth` 的同类模式。项目归属和 episode/editor 持久化仍使用真实 Prisma + 测试 MySQL。
- 删除了旧 route 中的 `DELETE` 导出，因为 Task 1.3 需求为 editor project CRUD 的 GET/PUT 保存读取，且旧 DELETE 操作的是 legacy `VideoEditorProject`，保留会继续误删旧模型而非 Twick editor project。


## 修复轮次

### 改了什么
- 修复 `src/app/api/novel-promotion/[projectId]/editor/route.ts` 的 PUT 乐观锁：已存在记录不再使用“先读 version 再无条件 upsert”的非原子流程，改为原子 compare-and-swap。
- 补充 `projectData` 基础防护：必须是普通 JSON 对象形态（非 `null`、非数组、非字符串/数字等），且可 `JSON.stringify`，序列化长度不能超过 `5 * 1024 * 1024` 字符。
- 扩展 `tests/integration/api/editor-project-api.test.ts`：新增同旧 version 并发 PUT 的 CAS 测试；新增数组/字符串/超大 JSON 的 `INVALID_PARAMS` 校验测试。

### CAS 怎么实现
- 对已存在的 editor project 使用：`updateMany({ where: { episodeId, version: submittedVersion }, data: { projectData, version: { increment: 1 } } })`。
- 当 `updateMany().count === 0` 时，重新读取当前 `version`，用项目统一 `ApiError('CONFLICT', { currentVersion, message })` 返回 409。
- 对新建路径使用 `create({ data: { episodeId, projectData, version: 1 } })`；捕获 Prisma 唯一键冲突 `P2002` 后重新读取当前 version 并返回同样的 `CONFLICT` 409。
- 保持语义：新建 `version=1`，更新成功后 `version` 递增，冲突响应包含 `currentVersion`。

### projectData 校验阈值
- 查找了现有 P2002 和 JSON size 相关约定：项目内已有 P2002 捕获模式（例如 `src/lib/media/service.ts`、`src/lib/task/service.ts`），未找到现成 JSON 字段大小限制工具/统一阈值。
- 本轮采用 `MAX_PROJECT_DATA_JSON_CHARS = 5 * 1024 * 1024`，通过 `JSON.stringify(projectData).length` 估算，超限返回项目统一 `INVALID_PARAMS`。

### 测试命令和完整输出
命令：
```bash
BILLING_TEST_BOOTSTRAP=1 npx vitest run tests/integration/api/editor-project-api.test.ts --reporter=dot
```

完整输出：
```text
[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v2.1.9 /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor

 Network twick-editor_default Creating 
 Network twick-editor_default Created 
 Container vvicat-test-redis Creating 
 Container vvicat-test-mysql Creating 
 Container vvicat-test-mysql Created 
 Container vvicat-test-redis Created 
 Container vvicat-test-redis Starting 
 Container vvicat-test-mysql Starting 
 Container vvicat-test-mysql Started 
 Container vvicat-test-redis Started 
Prisma schema loaded from prisma/schema.prisma
Datasource "db": MySQL database "vvicat_test" at "127.0.0.1:3307"

🚀  Your database is now in sync with your Prisma schema. Done in 2.21s

stderr | tests/integration/api/editor-project-api.test.ts > editor project API > PUT returns 409 when version conflicts
{"ts":"2026-06-22T11:34:05.682+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Editor project has been modified elsewhere","requestId":"09b3a16f-cdaf-4054-9ff2-303127f70468","projectId":"429248f3-564d-48b3-a7e0-15d5842a67a7","errorCode":"CONFLICT","retryable":false,"durationMs":2,"details":{"method":"PUT","path":"/api/novel-promotion/429248f3-564d-48b3-a7e0-15d5842a67a7/editor","errorType":"ApiError"},"error":{"name":"ApiError","message":"Editor project has been modified elsewhere","stack":"ApiError: Editor project has been modified elsewhere\n    at throwConflict (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/route.ts:99:9)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/route.ts:207:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-project-api.test.ts:275:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)","code":"CONFLICT"}}

stderr | tests/integration/api/editor-project-api.test.ts > editor project API > PUT uses atomic compare-and-swap when two requests submit the same version
{"ts":"2026-06-22T11:34:05.693+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Editor project has been modified elsewhere","requestId":"c6af3d8a-9e1b-4785-a9f2-4d220d453d25","projectId":"429248f3-564d-48b3-a7e0-15d5842a67a7","errorCode":"CONFLICT","retryable":false,"durationMs":5,"details":{"method":"PUT","path":"/api/novel-promotion/429248f3-564d-48b3-a7e0-15d5842a67a7/editor","errorType":"ApiError"},"error":{"name":"ApiError","message":"Editor project has been modified elsewhere","stack":"ApiError: Editor project has been modified elsewhere\n    at throwConflict (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/route.ts:99:9)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/route.ts:207:5\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at async Promise.all (index 1)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-project-api.test.ts:298:35\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)","code":"CONFLICT"}}

stderr | tests/integration/api/editor-project-api.test.ts > editor project API > PUT rejects array and string projectData with INVALID_PARAMS
{"ts":"2026-06-22T11:34:05.697+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Invalid parameters","requestId":"b02ab6dd-2592-407b-a7da-b532f69b86df","projectId":"429248f3-564d-48b3-a7e0-15d5842a67a7","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"PUT","path":"/api/novel-promotion/429248f3-564d-48b3-a7e0-15d5842a67a7/editor","errorType":"ApiError"},"error":{"name":"ApiError","message":"Invalid parameters","stack":"ApiError: Invalid parameters\n    at assertValidProjectData (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/route.ts:70:11)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/route.ts:157:3\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-project-api.test.ts:335:19\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)","code":"INVALID_PARAMS"}}
{"ts":"2026-06-22T11:34:05.698+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Invalid parameters","requestId":"39fc19d6-e8a1-45cc-a1d2-05a8fae2e159","projectId":"429248f3-564d-48b3-a7e0-15d5842a67a7","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":0,"details":{"method":"PUT","path":"/api/novel-promotion/429248f3-564d-48b3-a7e0-15d5842a67a7/editor","errorType":"ApiError"},"error":{"name":"ApiError","message":"Invalid parameters","stack":"ApiError: Invalid parameters\n    at assertValidProjectData (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/route.ts:70:11)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/route.ts:157:3\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-project-api.test.ts:335:19\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)","code":"INVALID_PARAMS"}}

stderr | tests/integration/api/editor-project-api.test.ts > editor project API > PUT rejects oversized projectData with INVALID_PARAMS
{"ts":"2026-06-22T11:34:05.713+08:00","level":"ERROR","service":"vvicat","audit":false,"module":"api","action":"api.request.error","message":"Invalid parameters","requestId":"9e8e4a60-2e18-4f9e-9b9f-6eacef392ed9","projectId":"429248f3-564d-48b3-a7e0-15d5842a67a7","errorCode":"INVALID_PARAMS","retryable":false,"durationMs":6,"details":{"method":"PUT","path":"/api/novel-promotion/429248f3-564d-48b3-a7e0-15d5842a67a7/editor","errorType":"ApiError"},"error":{"name":"ApiError","message":"Invalid parameters","stack":"ApiError: Invalid parameters\n    at assertValidProjectData (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/route.ts:81:11)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/app/api/novel-promotion/[projectId]/editor/route.ts:157:3\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:94\n    at Module.withInternalLLMStreamCallbacks (/Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/llm-observe/internal-stream-context.ts:36:10)\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:473:28\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/src/lib/api-errors.ts:453:12\n    at /Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/tests/integration/api/editor-project-api.test.ts:351:17\n    at file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:533:5\n    at runTest (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1056:11)\n    at runSuite (file:///Users/xiaomao/Documents/fuyang/waoowaoo/.claude/worktrees/twick-editor/node_modules/@vitest/runner/dist/index.js:1205:15)","code":"INVALID_PARAMS"}}

 ✓ tests/integration/api/editor-project-api.test.ts (8 tests) 259ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  11:33:56
   Duration  9.48s (transform 139ms, setup 4ms, collect 94ms, tests 259ms, environment 0ms, prepare 37ms)

 Container vvicat-test-mysql Stopping 
 Container vvicat-test-redis Stopping 
 Container vvicat-test-redis Stopped 
 Container vvicat-test-redis Removing 
 Container vvicat-test-redis Removed 
 Container vvicat-test-mysql Stopped 
 Container vvicat-test-mysql Removing 
 Container vvicat-test-mysql Removed 
 Network twick-editor_default Removing 
 Network twick-editor_default Removed
```

结果：`1 passed (1)` test file，`8 passed (8)` tests。
