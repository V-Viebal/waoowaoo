import sharp from 'sharp'
import {
  assertOfficialModelRegistered,
  type OfficialModelModality,
} from '@/lib/providers/official/model-registry'
import { getProviderConfig } from '@/lib/api-config'
import type { GenerateResult } from '@/lib/generators/base'
import { ensureStarRouterCatalogRegistered } from './catalog'
import type { StarRouterGenerateRequestOptions } from './types'

export interface StarRouterImageGenerateParams {
  userId: string
  prompt: string
  referenceImages?: string[]
  options: StarRouterGenerateRequestOptions
}

function assertRegistered(modelId: string): void {
  ensureStarRouterCatalogRegistered()
  assertOfficialModelRegistered({
    provider: 'starrouter',
    modality: 'image' satisfies OfficialModelModality,
    modelId,
  })
}

const STARSTONE_IMAGE_GENERATIONS_ENDPOINT = 'https://starrouter.io/v1/images/generations'
const STARSTONE_IMAGE_EDITS_ENDPOINT = 'https://starrouter.io/v1/images/edits'

// starrouter 图片是同步出图（单次 fetch 阻塞拿结果），上游卡顿时必须有兜底超时，
// 否则会一直占住 BullMQ 的 job 槽位，导致 worker 锁续期失败被判 stalled。
const STARSTONE_IMAGE_FETCH_TIMEOUT_MS = 120_000

// 文档约束：image 必须是 PNG，方形，<4MB
const STARSTONE_EDIT_TARGET_SIZE = 1024
const STARSTONE_EDIT_MAX_BYTES = 4 * 1024 * 1024

interface StarRouterImageSubmitResponse {
  created?: number
  data?: Array<{
    b64_json?: string
    url?: string
  }>
  error?: {
    message?: string
    code?: string
  }
}

interface StarRouterImageSubmitBody {
  model: string
  prompt: string
  size?: string
  n?: number
  response_format?: 'url' | 'b64_json'
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`STARSTONE_IMAGE_OPTION_INVALID_${fieldName.toUpperCase()}`)
  }
  return value
}

function assertNoUnsupportedOptions(options: StarRouterGenerateRequestOptions): void {
  const allowedOptionKeys = new Set([
    'provider',
    'modelId',
    'modelKey',
    'size',
    'n',
    'outputFormat',
    'resolution',
  ])
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    if (!allowedOptionKeys.has(key)) {
      throw new Error(`STARSTONE_IMAGE_OPTION_UNSUPPORTED: ${key}`)
    }
  }
}

function buildGenerationsRequest(params: StarRouterImageGenerateParams): {
  endpoint: string
  body: StarRouterImageSubmitBody
} {
  const prompt = readTrimmedString(params.prompt)
  if (!prompt) {
    throw new Error('STARSTONE_IMAGE_PROMPT_REQUIRED')
  }
  const modelId = readTrimmedString(params.options.modelId)
  if (!modelId) {
    throw new Error('STARSTONE_IMAGE_MODEL_ID_REQUIRED')
  }

  const size = readTrimmedString(params.options.size)
  const n = readOptionalPositiveInteger(params.options.n, 'n')

  const submitBody: StarRouterImageSubmitBody = {
    model: modelId,
    prompt,
    // 优先要 URL：避免单次响应里塞十几 MB base64，触发 worker 主线程长 JSON.parse
    response_format: 'url',
  }
  if (size) {
    submitBody.size = size
  }
  if (typeof n === 'number') {
    submitBody.n = n
  }

  return {
    endpoint: STARSTONE_IMAGE_GENERATIONS_ENDPOINT,
    body: submitBody,
  }
}

/**
 * 解析参考图入参（data URL 或裸 URL），统一拿到字节流。
 * normalizeReferenceImagesForGeneration 已经把所有输入转为 base64 data URL，
 * 这里仍兼容裸 URL 以防上游绕过 normalize。
 */
async function fetchReferenceImageBytes(input: string): Promise<Buffer> {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('STARSTONE_IMAGE_REFERENCE_EMPTY')

  if (trimmed.startsWith('data:')) {
    const commaIdx = trimmed.indexOf(',')
    if (commaIdx === -1) throw new Error('STARSTONE_IMAGE_REFERENCE_DATA_URL_INVALID')
    const meta = trimmed.slice(5, commaIdx) // skip "data:"
    const payload = trimmed.slice(commaIdx + 1)
    if (meta.includes(';base64')) {
      return Buffer.from(payload, 'base64')
    }
    return Buffer.from(decodeURIComponent(payload), 'utf-8')
  }

  const response = await fetch(trimmed)
  if (!response.ok) {
    throw new Error(`STARSTONE_IMAGE_REFERENCE_FETCH_FAILED(${response.status})`)
  }
  return Buffer.from(await response.arrayBuffer())
}

/**
 * 将任意来源的图转成 starrouter /v1/images/edits 接受的 PNG：
 * - 转 PNG
 * - 裁剪/填充至 1024x1024 方形（保持原图主体居中，不足部分透明填充）
 * - 控制总体积 <4MB（超出则降低 compressionLevel + 进一步缩放）
 */
async function normalizeReferenceForEdit(buffer: Buffer): Promise<Buffer> {
  let pipeline = sharp(buffer, { failOn: 'none' })
    .resize(STARSTONE_EDIT_TARGET_SIZE, STARSTONE_EDIT_TARGET_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })

  let out = await pipeline.toBuffer()
  if (out.byteLength <= STARSTONE_EDIT_MAX_BYTES) return out

  // 仍超限则再缩一档（512x512），文档允许 256/512/1024
  pipeline = sharp(buffer, { failOn: 'none' })
    .resize(512, 512, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
  out = await pipeline.toBuffer()
  if (out.byteLength <= STARSTONE_EDIT_MAX_BYTES) return out

  throw new Error('STARSTONE_IMAGE_REFERENCE_TOO_LARGE_AFTER_NORMALIZE')
}

async function buildEditsFormData(
  params: StarRouterImageGenerateParams,
  referenceImages: string[],
): Promise<FormData> {
  const prompt = readTrimmedString(params.prompt)
  if (!prompt) {
    throw new Error('STARSTONE_IMAGE_PROMPT_REQUIRED')
  }
  const modelId = readTrimmedString(params.options.modelId)
  if (!modelId) {
    throw new Error('STARSTONE_IMAGE_MODEL_ID_REQUIRED')
  }

  const formData = new FormData()
  formData.append('prompt', prompt)
  formData.append('model', modelId)
  formData.append('response_format', 'url')

  const size = readTrimmedString(params.options.size)
  if (size) {
    formData.append('size', size)
  }
  const n = readOptionalPositiveInteger(params.options.n, 'n')
  if (typeof n === 'number') {
    // 文档定义 n 为 string 类型，统一字符串化
    formData.append('n', String(n))
  }

  // 全部参考图都 append 为 image 字段；starrouter edits 文档官方只画了一张图，
  // 但服务端常见做法是支持多次同名字段或 image[]，都试一下风险有限，由服务端决定如何取用。
  for (let i = 0; i < referenceImages.length; i += 1) {
    const raw = await fetchReferenceImageBytes(referenceImages[i])
    const png = await normalizeReferenceForEdit(raw)
    const blob = new Blob([new Uint8Array(png)], { type: 'image/png' })
    const filename = `reference-${i}.png`
    formData.append('image', blob, filename)
    // 兼容某些后端的数组语法
    formData.append('image[]', blob, filename)
  }

  return formData
}

async function parseSubmitResponse(response: Response): Promise<StarRouterImageSubmitResponse> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('STARSTONE_IMAGE_RESPONSE_INVALID')
    }
    return parsed as StarRouterImageSubmitResponse
  } catch {
    throw new Error('STARSTONE_IMAGE_RESPONSE_INVALID_JSON')
  }
}

function extractResultFromResponse(data: StarRouterImageSubmitResponse): GenerateResult {
  const imageUrls = (data.data || []).map(item => item.url).filter(Boolean) as string[]
  const firstImageUrl = imageUrls[0] || null
  const firstB64Json = data.data?.[0]?.b64_json || null

  if (!firstImageUrl && !firstB64Json) {
    throw new Error('STARSTONE_IMAGE_NO_RESULT: 未返回图片数据')
  }

  return {
    success: true,
    async: false,
    imageUrl: firstImageUrl || undefined,
    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    imageBase64: firstB64Json || undefined,
  }
}

export async function generateStarRouterImage(params: StarRouterImageGenerateParams): Promise<GenerateResult> {
  assertRegistered(params.options.modelId)
  assertNoUnsupportedOptions(params.options)

  const { apiKey } = await getProviderConfig(params.userId, params.options.provider)
  const referenceImages = (params.referenceImages || []).filter((s) => typeof s === 'string' && s.trim().length > 0)

  let response: Response
  try {
    if (referenceImages.length > 0) {
      // 走 /v1/images/edits（multipart/form-data）以传入参考图
      const formData = await buildEditsFormData(params, referenceImages)
      response = await fetch(STARSTONE_IMAGE_EDITS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          // 不要手动设置 Content-Type，fetch 会自动加上含 boundary 的 multipart 头
        },
        body: formData,
        signal: AbortSignal.timeout(STARSTONE_IMAGE_FETCH_TIMEOUT_MS),
      })
    } else {
      const submitRequest = buildGenerationsRequest(params)
      response = await fetch(submitRequest.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submitRequest.body),
        signal: AbortSignal.timeout(STARSTONE_IMAGE_FETCH_TIMEOUT_MS),
      })
    }
  } catch (err) {
    // AbortSignal.timeout 触发会抛 TimeoutError；统一成稳定错误码方便上游重试与日志归类
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`STARSTONE_IMAGE_SUBMIT_TIMEOUT(${STARSTONE_IMAGE_FETCH_TIMEOUT_MS}ms)`)
    }
    throw err
  }

  const data = await parseSubmitResponse(response)
  if (!response.ok) {
    const message = readTrimmedString(data.error?.message)
    const code = readTrimmedString(data.error?.code)
    throw new Error(`STARSTONE_IMAGE_SUBMIT_FAILED(${response.status}): ${message || code || 'unknown error'}`)
  }

  return extractResultFromResponse(data)
}
