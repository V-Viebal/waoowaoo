import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthSession, isErrorResponse, notFound, unauthorized } from '@/lib/api-auth'
import { apiHandler, ApiError, getIdempotencyKey, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE, type TaskBillingInfo, type TaskType } from '@/lib/task/types'
import { BILLING_ITEM, calculateBillingItemCost, getBillingItemDefinition, type BillingItemKey } from '@/lib/billing/items'
import { BUILTIN_PRICING_VERSION } from '@/lib/model-pricing/version'

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
  billingItem?: BillingItemKey
  billingQuantity?: (body: EditorAiBody) => number
  payload?: (body: EditorAiBody) => Record<string, unknown>
  dedupeKey?: (input: { action: string; editorProjectId: string; clientRequestId: string | null; requestId: string | null; body: EditorAiBody }) => string | null
}

function readPositiveNumber(value: unknown, fallback = 1): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return numeric
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

export function readCaptionBillingMinutes(body: EditorAiBody): number {
  return readPositiveNumber(body.durationMinutes ?? body.quantity, 1)
}

export function readEnhanceBillingSeconds(body: EditorAiBody): number {
  return readPositiveNumber(body.durationSeconds ?? body.quantity, 1)
}

export function readVoiceOptimizeBillingSeconds(body: EditorAiBody): number {
  return readPositiveNumber(body.durationSeconds ?? body.maxSeconds, 5)
}

export function resolveEnhanceBillingItem(body: EditorAiBody): BillingItemKey {
  return body.enhanceType === 'restore'
    ? BILLING_ITEM.EDITOR_AI_ENHANCE_RESTORE
    : BILLING_ITEM.EDITOR_AI_ENHANCE_SMART_CROP
}

function buildEditorBillingInfo(params: {
  taskType: TaskType
  billingItem: BillingItemKey
  quantity: number
  requestId: string | null
  editorProjectId: string
}): TaskBillingInfo {
  const quantity = readPositiveNumber(params.quantity, 1)
  const definition = getBillingItemDefinition(params.billingItem)
  return {
    billable: true,
    source: 'task',
    taskType: params.taskType,
    apiType: 'editor',
    model: params.billingItem,
    quantity,
    unit: definition.unit,
    maxFrozenCost: calculateBillingItemCost(params.billingItem, quantity),
    pricingVersion: BUILTIN_PRICING_VERSION,
    action: params.billingItem,
    billingKey: `${params.billingItem}:${params.editorProjectId}:${params.requestId || 'no-request-id'}`,
    metadata: {
      billingItem: params.billingItem,
      editorProjectId: params.editorProjectId,
      quantity,
    },
    status: 'quoted',
  }
}

async function requireOwnedProject(projectId: string) {
  const session = await getAuthSession()
  if (!session?.user?.id) {
    return unauthorized()
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: session.user.id,
    },
    select: {
      id: true,
      userId: true,
      name: true,
    },
  })

  if (!project) {
    return notFound('Project')
  }

  return { session, project }
}

async function requireOwnedEditorProject(params: {
  projectId: string
  episodeId: string
  editorProjectId: string
}) {
  const editorProject = await prisma.novelPromotionEditorProject.findFirst({
    where: {
      id: params.editorProjectId,
      episodeId: params.episodeId,
      episode: {
        novelPromotionProject: {
          projectId: params.projectId,
        },
      },
    },
    select: {
      id: true,
      episodeId: true,
    },
  })

  if (!editorProject) {
    throw new ApiError('NOT_FOUND')
  }

  return editorProject
}

export function createEditorAiRoute(params: Omit<SubmitEditorAiRouteParams, 'request' | 'context'>) {
  return apiHandler(async (request: NextRequest, context: EditorAiRouteContext) => {
    const { projectId } = await context.params
    const authResult = await requireOwnedProject(projectId)
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json() as EditorAiBody
    const episodeId = typeof body.episodeId === 'string' && body.episodeId.trim()
      ? body.episodeId.trim()
      : ''
    const editorProjectId = typeof body.editorProjectId === 'string' && body.editorProjectId.trim()
      ? body.editorProjectId.trim()
      : ''

    if (!episodeId || !editorProjectId) {
      throw new ApiError('INVALID_PARAMS')
    }

    await requireOwnedEditorProject({
      projectId,
      episodeId,
      editorProjectId,
    })

    const locale = resolveRequiredTaskLocale(request, body)
    const requestId = getRequestId(request) || null
    const clientRequestId = readBodyRequestId(body) || readHeaderRequestId(request)
    const billingItem = params.taskType === TASK_TYPE.EDITOR_AI_ENHANCE
      ? resolveEnhanceBillingItem(body)
      : params.billingItem
    const billingInfo = billingItem
      ? buildEditorBillingInfo({
        taskType: params.taskType,
        billingItem,
        quantity: params.billingQuantity?.(body) ?? 1,
        requestId,
        editorProjectId,
      })
      : null

    const dedupeKey = params.dedupeKey?.({
      action: params.action,
      editorProjectId,
      clientRequestId,
      requestId,
      body,
    }) || buildDefaultEditorAiDedupeKey({
      action: params.action,
      editorProjectId,
      clientRequestId,
      body,
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
        ...body,
        episodeId,
        editorProjectId,
        action: params.action,
        ...(params.payload?.(body) || {}),
      },
      dedupeKey,
      billingInfo,
    })

    return NextResponse.json({ data: { taskId: result.taskId } })
  })
}
