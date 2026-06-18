import {
  assertOfficialModelRegistered,
  type OfficialModelModality,
} from '@/lib/providers/official/model-registry'
import { getProviderConfig } from '@/lib/api-config'
import type { GenerateResult } from '@/lib/generators/base'
import { toFetchableUrl } from '@/lib/storage/utils'
import { ensureStarRouterCatalogRegistered } from './catalog'
import type { StarRouterGenerateRequestOptions } from './types'

export interface StarRouterVideoGenerateParams {
  userId: string
  imageUrl: string
  prompt?: string
  options: StarRouterGenerateRequestOptions
}

function assertRegistered(modelId: string): void {
  ensureStarRouterCatalogRegistered()
  assertOfficialModelRegistered({
    provider: 'starrouter',
    modality: 'video' satisfies OfficialModelModality,
    modelId,
  })
}

const STARSTONE_VIDEO_ENDPOINT = 'https://starrouter.io/v1/videos/createVideoGeneration'

// 视频是异步任务，submit 只是创建任务拿 task_id；上游卡住的话也得有兜底，
// 否则会一直占住 BullMQ 的 job 槽位，影响后续锁续期。
const STARSTONE_VIDEO_SUBMIT_TIMEOUT_MS = 30_000

interface StarRouterVideoSubmitResponse {
  code?: string
  message?: string
  data?: {
    task_id?: string
  }
}

interface StarRouterVideoSubmitBody {
  model: string
  prompt?: string
  input_image_url?: string
  duration?: number
  aspect_ratio?: string
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`STARSTONE_VIDEO_OPTION_INVALID_${fieldName.toUpperCase()}`)
  }
  return value
}

function assertNoUnsupportedOptions(options: StarRouterGenerateRequestOptions): void {
  const allowedOptionKeys = new Set([
    'provider',
    'modelId',
    'modelKey',
    'prompt',
    'duration',
    'aspectRatio',
    'aspect_ratio',
    'outputFormat',
    'resolution',
    'fps',
  ])
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    if (!allowedOptionKeys.has(key)) {
      throw new Error(`STARSTONE_VIDEO_OPTION_UNSUPPORTED: ${key}`)
    }
  }
}

function buildSubmitRequest(params: StarRouterVideoGenerateParams): {
  endpoint: string
  body: StarRouterVideoSubmitBody
} {
  const imageUrl = readTrimmedString(params.imageUrl)
  if (!imageUrl) {
    throw new Error('STARSTONE_VIDEO_IMAGE_URL_REQUIRED')
  }
  const modelId = readTrimmedString(params.options.modelId)
  if (!modelId) {
    throw new Error('STARSTONE_VIDEO_MODEL_ID_REQUIRED')
  }

  const prompt = readTrimmedString(params.prompt) || readTrimmedString(params.options.prompt)
  const duration = readOptionalPositiveInteger(params.options.duration, 'duration')
  const aspectRatio = readTrimmedString(params.options.aspectRatio) || readTrimmedString(params.options.aspect_ratio)

  const submitBody: StarRouterVideoSubmitBody = {
    model: modelId,
    input_image_url: toFetchableUrl(imageUrl),
  }
  if (prompt) {
    submitBody.prompt = prompt
  }
  if (typeof duration === 'number') {
    submitBody.duration = duration
  }
  if (aspectRatio) {
    submitBody.aspect_ratio = aspectRatio
  }

  return {
    endpoint: STARSTONE_VIDEO_ENDPOINT,
    body: submitBody,
  }
}

async function parseSubmitResponse(response: Response): Promise<StarRouterVideoSubmitResponse> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('STARSTONE_VIDEO_RESPONSE_INVALID')
    }
    return parsed as StarRouterVideoSubmitResponse
  } catch {
    throw new Error('STARSTONE_VIDEO_RESPONSE_INVALID_JSON')
  }
}

export async function generateStarRouterVideo(params: StarRouterVideoGenerateParams): Promise<GenerateResult> {
  assertRegistered(params.options.modelId)
  assertNoUnsupportedOptions(params.options)

  const { apiKey } = await getProviderConfig(params.userId, params.options.provider)
  const submitRequest = buildSubmitRequest(params)
  let response: Response
  try {
    response = await fetch(submitRequest.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(submitRequest.body),
      signal: AbortSignal.timeout(STARSTONE_VIDEO_SUBMIT_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`STARSTONE_VIDEO_SUBMIT_TIMEOUT(${STARSTONE_VIDEO_SUBMIT_TIMEOUT_MS}ms)`)
    }
    throw err
  }
  const data = await parseSubmitResponse(response)

  if (!response.ok) {
    const code = readTrimmedString(data.code)
    const message = readTrimmedString(data.message)
    throw new Error(`STARSTONE_VIDEO_SUBMIT_FAILED(${response.status}): ${code || message || 'unknown error'}`)
  }

  const taskId = readTrimmedString(data.data?.task_id)
  if (!taskId) {
    throw new Error('STARSTONE_VIDEO_TASK_ID_MISSING')
  }

  return {
    success: true,
    async: true,
    requestId: taskId,
    externalId: `STARSTONE:VIDEO:${taskId}`,
  }
}
