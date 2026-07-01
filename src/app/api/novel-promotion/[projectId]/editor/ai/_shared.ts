import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getIdempotencyKey, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import type { TaskType } from '@/lib/task/types'
import { requireOwnedEditorProject, requireOwnedProject } from '../_auth'

export { requireOwnedEditorProject, requireOwnedProject }

// ponytail: this file used to build a per-route TaskBillingInfo, but submitter.ts always
// prefers the policy-computed one (buildDefaultTaskBillingInfo). Single source of truth is
// src/lib/billing/task-policy.ts — routes only shape the payload (e.g. durationMinutes) so
// the policy can read it.

export type EditorAiRouteContext = { params: Promise<{ projectId: string }> }

type EditorAiBody = Record<string, unknown> & {
  episodeId?: unknown
  editorProjectId?: unknown
}

type SubmitEditorAiRouteParams = {
  request: NextRequest
  context: EditorAiRouteContext
  taskType: TaskType
  action: string
  beforeSubmit?: (input: {
    projectId: string
    episodeId: string
    editorProjectId: string
    body: EditorAiBody
    editorProject: Awaited<ReturnType<typeof requireOwnedEditorProject>>
  }) => Promise<void | { body?: Partial<EditorAiBody> }>
  payload?: (body: EditorAiBody) => Record<string, unknown>
  dedupeKey?: (input: { action: string; editorProjectId: string; clientRequestId: string | null; requestId: string | null; body: EditorAiBody }) => string | null
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function readBodyRequestId(body: EditorAiBody): string | null {
  return typeof body.requestId === 'string' && body.requestId.trim()
    ? body.requestId.trim()
    : null
}

function readHeaderRequestId(request: NextRequest): string | null {
  const headerRequestId = request.headers.get('x-request-id')?.trim()
  return headerRequestId || getIdempotencyKey(request) || null
}

function buildDefaultEditorAiDedupeKey(input: {
  action: string
  editorProjectId: string
  clientRequestId: string | null
  body: EditorAiBody
}) {
  if (input.clientRequestId) {
    return `editor-ai:${input.action}:${input.editorProjectId}:${input.clientRequestId}`
  }

  const fingerprint = createHash('sha1')
    .update(stableStringify(input.body))
    .digest('hex')
    .slice(0, 16)
  return `editor-ai:${input.action}:${input.editorProjectId}:${fingerprint}`
}

const MAX_AI_BODY_CHARS = 512 * 1024

export function createEditorAiRoute(params: Omit<SubmitEditorAiRouteParams, 'request' | 'context'>) {
  return apiHandler(async (request: NextRequest, context: EditorAiRouteContext) => {
    const { projectId } = await context.params
    const authResult = await requireOwnedProject(projectId)
    if (isErrorResponse(authResult)) return authResult

    // ponytail: hard cap AI POST bodies before JSON.parse — prevents unbounded memory / prompt cost.
    const rawText = await request.text()
    if (rawText.length > MAX_AI_BODY_CHARS) {
      throw new ApiError('INVALID_PARAMS', { message: 'EDITOR_AI_BODY_TOO_LARGE' })
    }
    const body = (rawText ? JSON.parse(rawText) : {}) as EditorAiBody
    const episodeId = typeof body.episodeId === 'string' && body.episodeId.trim()
      ? body.episodeId.trim()
      : ''
    const editorProjectId = typeof body.editorProjectId === 'string' && body.editorProjectId.trim()
      ? body.editorProjectId.trim()
      : ''

    if (!episodeId || !editorProjectId) {
      throw new ApiError('INVALID_PARAMS')
    }

    const editorProject = await requireOwnedEditorProject({
      projectId,
      episodeId,
      editorProjectId,
    })

    const beforeSubmitResult = await params.beforeSubmit?.({
      projectId,
      episodeId,
      editorProjectId,
      body,
      editorProject,
    })
    const effectiveBody = beforeSubmitResult?.body
      ? { ...body, ...beforeSubmitResult.body }
      : body

    const locale = resolveRequiredTaskLocale(request, effectiveBody)
    const requestId = getRequestId(request) || null
    const clientRequestId = readBodyRequestId(body) || readHeaderRequestId(request)

    const dedupeKey = params.dedupeKey?.({
      action: params.action,
      editorProjectId,
      clientRequestId,
      requestId,
      body: effectiveBody,
    }) || buildDefaultEditorAiDedupeKey({
      action: params.action,
      editorProjectId,
      clientRequestId,
      body: effectiveBody,
    })

    const result = await submitTask({
      userId: authResult.session.user.id,
      locale,
      requestId,
      projectId,
      episodeId,
      type: params.taskType,
      targetType: 'NovelPromotionEditorProject',
      targetId: editorProjectId,
      payload: {
        ...effectiveBody,
        episodeId,
        editorProjectId,
        action: params.action,
        ...(params.payload?.(effectiveBody) || {}),
      },
      dedupeKey,
    })

    return NextResponse.json({ data: { taskId: result.taskId } })
  })
}

// Re-export helpers still used by other places — none needed now.
