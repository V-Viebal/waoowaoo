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

const STARSTONE_IMAGE_ENDPOINT = 'https://starrouter.io/v1/images/generations'

interface StarRouterImageSubmitResponse {
  code?: string
  message?: string
  data?: {
    task_id?: string
  }
}

interface StarRouterImageSubmitBody {
  model: string
  prompt: string
  size?: string
  n?: number
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
  ])
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    if (!allowedOptionKeys.has(key)) {
      throw new Error(`STARSTONE_IMAGE_OPTION_UNSUPPORTED: ${key}`)
    }
  }
}

function buildSubmitRequest(params: StarRouterImageGenerateParams): {
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
  }
  if (size) {
    submitBody.size = size
  }
  if (typeof n === 'number') {
    submitBody.n = n
  }

  return {
    endpoint: STARSTONE_IMAGE_ENDPOINT,
    body: submitBody,
  }
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

export async function generateStarRouterImage(params: StarRouterImageGenerateParams): Promise<GenerateResult> {
  assertRegistered(params.options.modelId)
  assertNoUnsupportedOptions(params.options)

  const { apiKey } = await getProviderConfig(params.userId, params.options.provider)
  const submitRequest = buildSubmitRequest(params)
  const response = await fetch(submitRequest.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(submitRequest.body),
  })
  const data = await parseSubmitResponse(response)

  if (!response.ok) {
    const code = readTrimmedString(data.code)
    const message = readTrimmedString(data.message)
    throw new Error(`STARSTONE_IMAGE_SUBMIT_FAILED(${response.status}): ${code || message || 'unknown error'}`)
  }

  const taskId = readTrimmedString(data.data?.task_id)
  if (!taskId) {
    throw new Error('STARSTONE_IMAGE_TASK_ID_MISSING')
  }

  return {
    success: true,
    async: true,
    requestId: taskId,
    externalId: `STARSTONE:IMAGE:${taskId}`,
  }
}
