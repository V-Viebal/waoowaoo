import {
  assertOfficialModelRegistered,
  type OfficialModelModality,
} from '@/lib/providers/official/model-registry'
import { getProviderConfig } from '@/lib/api-config'
import type { GenerateResult } from '@/lib/generators/base'
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

const STARSTONE_VIDEO_SUBMIT_ENDPOINT = 'https://starrouter.io/volcengine/doubao/contents/generations/tasks'

// 视频是异步任务，submit 只是创建任务拿 task_id；上游卡住的话也得有兜底，
// 否则会一直占住 BullMQ 的 job 槽位，影响后续锁续期。
const STARSTONE_VIDEO_SUBMIT_TIMEOUT_MS = 30_000

interface StarRouterVideoSubmitResponse {
  code?: string
  message?: string
  data?: {
    task_id?: string
    id?: string
  }
  id?: string
  task_id?: string
  error?: {
    code?: string
    message?: string
  }
}

function readTaskIdFromResponse(data: StarRouterVideoSubmitResponse): string {
  return readTrimmedString(data.data?.task_id)
    || readTrimmedString(data.data?.id)
    || readTrimmedString(data.id)
    || readTrimmedString(data.task_id)
}

interface StarRouterVideoSubmitBody {
  model: string
  content: Array<{ type: string; text?: string; image_url?: { url: string } }>
  resolution?: string
  ratio?: string
  duration?: number
  seed?: number
  watermark?: boolean
  fps?: number
  n?: number
  response_format?: string
  user?: string
  metadata?: Record<string, unknown>
}

// Volcengine Doubao 接口直接使用 resolution 和 ratio 字符串，无需映射尺寸
// 支持的 resolution: '720p', '1080p'
// 支持的 ratio: '16:9', '9:16', '1:1', '3:2', '2:3'

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

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readOptionalRecord(value: unknown, fieldName: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`STARSTONE_VIDEO_OPTION_INVALID_${fieldName.toUpperCase()}`)
  }
  return { ...(value as Record<string, unknown>) }
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
    'fps',
    'seed',
    'n',
    'outputFormat',
    'response_format',
    'resolution',
    'generateAudio',
    'generate_audio',
    'watermark',
    'user',
    'metadata',
  ])
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    if (!allowedOptionKeys.has(key)) {
      throw new Error(`STARSTONE_VIDEO_OPTION_UNSUPPORTED: ${key}`)
    }
  }
}

// 常见 aspect ratio 映射（保留供将来参考，新接口直接传 resolution 和 ratio 字符串）
const _ASPECT_RATIO_TO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 720, height: 720 },
  '3:2': { width: 1080, height: 720 },
  '2:3': { width: 720, height: 1080 },
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
  const fps = readOptionalPositiveInteger(params.options.fps, 'fps')
  const seed = readOptionalPositiveInteger(params.options.seed, 'seed')
  const n = readOptionalPositiveInteger(params.options.n, 'n')
  const responseFormat = readTrimmedString(params.options.outputFormat) || readTrimmedString(params.options.response_format)
  const user = readTrimmedString(params.options.user)
  const resolution = readTrimmedString(params.options.resolution)
  const ratio = readTrimmedString(params.options.aspectRatio) || readTrimmedString(params.options.aspect_ratio)

  // metadata 是 StarRouter 的模型扩展参数入口，必须保留调用方传入的负向词、风格、质量等字段。
  const metadata = readOptionalRecord(params.options.metadata, 'metadata') ?? {}

  // generate_audio 放入 metadata（文档说 metadata 放扩展参数）
  const generateAudio = readOptionalBoolean(params.options.generateAudio)
    ?? readOptionalBoolean(params.options.generate_audio)
  if (typeof generateAudio === 'boolean') {
    metadata.generate_audio = generateAudio
  }

  // 构建 content 数组：text + image_url
  const content: StarRouterVideoSubmitBody['content'] = []
  if (prompt) {
    content.push({ type: 'text', text: prompt })
  }
  content.push({ type: 'image_url', image_url: { url: imageUrl } })

  const submitBody: StarRouterVideoSubmitBody = {
    model: modelId,
    content,
    watermark: false,
  }
  if (typeof duration === 'number') submitBody.duration = duration
  if (resolution) submitBody.resolution = resolution
  if (ratio) submitBody.ratio = ratio
  if (typeof fps === 'number') submitBody.fps = fps
  if (typeof seed === 'number') submitBody.seed = seed
  if (typeof n === 'number') submitBody.n = n
  if (responseFormat) submitBody.response_format = responseFormat
  if (user) submitBody.user = user
  if (Object.keys(metadata).length > 0) submitBody.metadata = metadata

  return {
    endpoint: STARSTONE_VIDEO_SUBMIT_ENDPOINT,
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
    const code = readTrimmedString(data.code) || readTrimmedString(data.error?.code)
    const message = readTrimmedString(data.message) || readTrimmedString(data.error?.message)
    throw new Error(`STARSTONE_VIDEO_SUBMIT_FAILED(${response.status}): ${code || message || 'unknown error'}`)
  }

  const taskId = readTaskIdFromResponse(data)
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
