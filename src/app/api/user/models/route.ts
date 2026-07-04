/**
 * 获取用户的模型列表
 *
 * 返回用户在个人中心启用的模型，供项目配置下拉框使用。
 * capabilities 仅来自系统内置目录（不信任用户提交的 model.capabilities）。
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  composeModelKey,
  parseModelKeyStrict,
  type CapabilityValue,
  type ModelCapabilities,
  type UnifiedModelType,
} from '@/lib/model-config-contract'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'
import { findBuiltinPricingCatalogEntry } from '@/lib/model-pricing/catalog'
import type { VideoPricingTier } from '@/lib/model-pricing/video-tier'
import {
  listOfficialCatalogModels,
  type OfficialCatalogModel,
} from '@/lib/providers/official/model-registry'
import { ensureBailianCatalogRegistered } from '@/lib/providers/bailian/catalog'
import { ensureOmnivoiceCatalogRegistered } from '@/lib/providers/omnivoice/catalog'
import { ensureSiliconFlowCatalogRegistered } from '@/lib/providers/siliconflow/catalog'
import { ensureStarRouterCatalogRegistered } from '@/lib/providers/starrouter/catalog'

// Eagerly register all catalog models so listOfficialCatalogModels()
// returns the complete set available for user selection.
ensureBailianCatalogRegistered()
ensureOmnivoiceCatalogRegistered()
ensureSiliconFlowCatalogRegistered()
ensureStarRouterCatalogRegistered()

type StoredModelType = UnifiedModelType | string

interface StoredModel {
  modelId?: string
  modelKey?: string
  name?: string
  type?: StoredModelType
  provider?: string
}

interface StoredProvider {
  id?: string
  name?: string
  apiKey?: string
}

interface UserModelOption {
  value: string
  label: string
  provider?: string
  providerName?: string
  capabilities?: ModelCapabilities
  videoPricingTiers?: VideoPricingTier[]
}

interface UserModelsPayload {
  llm: UserModelOption[]
  image: UserModelOption[]
  video: UserModelOption[]
  audio: UserModelOption[]
  lipsync: UserModelOption[]
}

const AUDIO_MODEL_EXCLUDED_IDS = new Set([
  'qwen-voice-design',
])

function isUnifiedModelType(type: unknown): type is UnifiedModelType {
  return (
    type === 'llm'
    || type === 'image'
    || type === 'video'
    || type === 'audio'
    || type === 'lipsync'
  )
}

function toModelKey(model: StoredModel): string {
  const provider = typeof model.provider === 'string' ? model.provider.trim() : ''
  const modelId = typeof model.modelId === 'string' ? model.modelId.trim() : ''

  if (provider && modelId) {
    return composeModelKey(provider, modelId)
  }

  const parsed = parseModelKeyStrict(typeof model.modelKey === 'string' ? model.modelKey : '')
  return parsed?.modelKey || ''
}

function toProvider(model: StoredModel): string | undefined {
  if (typeof model.provider === 'string' && model.provider.trim()) return model.provider.trim()
  const parsed = parseModelKeyStrict(typeof model.modelKey === 'string' ? model.modelKey : '')
  return parsed?.provider || undefined
}

function toModelId(model: StoredModel): string {
  if (typeof model.modelId === 'string' && model.modelId.trim()) {
    return model.modelId.trim()
  }
  const parsed = parseModelKeyStrict(typeof model.modelKey === 'string' ? model.modelKey : '')
  return parsed?.modelId || ''
}

function toDisplayLabel(model: StoredModel, fallbackModelId: string): string {
  if (typeof model.name === 'string' && model.name.trim()) return model.name.trim()
  return fallbackModelId
}

function dedupeByModelKey(items: UserModelOption[]): UserModelOption[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.value)) return false
    seen.add(item.value)
    return true
  })
}

function cloneVideoPricingTiers(rawTiers: Array<{ when: Record<string, CapabilityValue> }>): VideoPricingTier[] {
  return rawTiers.map((tier) => ({
    when: { ...tier.when },
  }))
}

function parseStoredModels(rawModels: string | null | undefined): StoredModel[] {
  if (!rawModels) return []
  let parsedUnknown: unknown
  try {
    parsedUnknown = JSON.parse(rawModels)
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_PAYLOAD_INVALID',
      field: 'customModels',
    })
  }
  if (!Array.isArray(parsedUnknown)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_PAYLOAD_INVALID',
      field: 'customModels',
    })
  }
  return parsedUnknown as StoredModel[]
}

function parseStoredProviders(rawProviders: string | null | undefined): StoredProvider[] {
  if (!rawProviders) return []
  let parsedUnknown: unknown
  try {
    parsedUnknown = JSON.parse(rawProviders)
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROVIDER_PAYLOAD_INVALID',
      field: 'customProviders',
    })
  }
  if (!Array.isArray(parsedUnknown)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROVIDER_PAYLOAD_INVALID',
      field: 'customProviders',
    })
  }
  return parsedUnknown as StoredProvider[]
}

function hasStoredProviderApiKey(provider: StoredProvider): boolean {
  return typeof provider.apiKey === 'string' && provider.apiKey.trim().length > 0
}

function isUserSelectableModel(model: StoredModel): boolean {
  if (model.type !== 'audio') return true
  const modelId = toModelId(model)
  return !AUDIO_MODEL_EXCLUDED_IDS.has(modelId)
}

function getCatalogProviderDisplayName(provider: string): string {
  switch (provider) {
    case 'bailian': return '百炼'
    case 'omnivoice': return 'OmniVoice'
    case 'siliconflow': return 'SiliconFlow'
    case 'starrouter': return 'StarRouter'
    default: return provider
  }
}

const COSYVOICE_LABELS: Readonly<Record<string, string>> = {
  'cosyvoice-v3.5-plus': 'CosyVoice v3.5 Plus',
  'cosyvoice-v3.5-flash': 'CosyVoice v3.5 Flash',
  'cosyvoice-v3-plus': 'CosyVoice v3 Plus',
  'cosyvoice-v3-flash': 'CosyVoice v3 Flash',
  'cosyvoice-v2': 'CosyVoice v2',
}

function buildCatalogModelLabel(model: OfficialCatalogModel): string {
  const providerName = getCatalogProviderDisplayName(model.provider)
  // Use a shorter, user-friendly label for catalog models
  if (model.provider === 'bailian' && model.modelId.includes('tts')) {
    return `${providerName} · Qwen TTS`
  }
  if (model.provider === 'bailian' && model.modelId.startsWith('cosyvoice-')) {
    return `${providerName} · ${COSYVOICE_LABELS[model.modelId] || model.modelId}`
  }
  if (model.provider === 'omnivoice') {
    return `${providerName} · OmniVoice TTS`
  }
  return `${providerName} · ${model.modelId}`
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { customModels: true, customProviders: true },
  })

  const modelsRaw: StoredModel[] = parseStoredModels(pref?.customModels)
  const providers: StoredProvider[] = parseStoredProviders(pref?.customProviders)

  const providerNameMap = new Map<string, string>()
  const providerIdsWithApiKey = new Set<string>()
  providers.forEach((provider) => {
    const providerId = typeof provider?.id === 'string' ? provider.id.trim() : ''
    if (!providerId) return

    if (provider?.name && typeof provider.name === 'string') {
      providerNameMap.set(providerId, provider.name)
    }
    if (hasStoredProviderApiKey(provider)) providerIdsWithApiKey.add(providerId)
  })

  const grouped: UserModelsPayload = {
    llm: [],
    image: [],
    video: [],
    audio: [],
    lipsync: [],
  }

  for (const model of modelsRaw) {
    if (!isUnifiedModelType(model.type)) continue
    if (!isUserSelectableModel(model)) continue

    const modelType = model.type
    const modelKey = toModelKey(model)
    if (!modelKey) continue

    const provider = toProvider(model)
    if (!provider || !providerIdsWithApiKey.has(provider)) continue
    const modelId = toModelId(model)
    const option: UserModelOption = {
      value: modelKey,
      label: toDisplayLabel(model, modelId || modelKey),
      provider,
      providerName: provider ? providerNameMap.get(provider) : undefined,
    }

    if (provider && modelId) {
      const capabilities = findBuiltinCapabilities(modelType, provider, modelId)
      if (capabilities) {
        option.capabilities = capabilities
      }

      if (modelType === 'video') {
        const pricingEntry = findBuiltinPricingCatalogEntry('video', provider, modelId)
        if (pricingEntry?.pricing.mode === 'capability' && Array.isArray(pricingEntry.pricing.tiers)) {
          option.videoPricingTiers = cloneVideoPricingTiers(pricingEntry.pricing.tiers)
        }
      }
    }

    grouped[modelType].push(option)
  }

  // Add catalog-only audio models (e.g. OmniVoice, Bailian TTS) that don't
  // require per-user custom model rows. Users can set them as project defaults
  // or select them in the voice stage toolbar.
  const catalogAudioModels = listOfficialCatalogModels('audio')
  const existingAudioModelKeys = new Set(grouped.audio.map((m) => m.value))
  for (const catalogModel of catalogAudioModels) {
    if (existingAudioModelKeys.has(catalogModel.modelKey)) continue
    if (AUDIO_MODEL_EXCLUDED_IDS.has(catalogModel.modelId)) continue
    const label = buildCatalogModelLabel(catalogModel)
    const capabilities = findBuiltinCapabilities('audio', catalogModel.provider, catalogModel.modelId)
    grouped.audio.push({
      value: catalogModel.modelKey,
      label,
      provider: catalogModel.provider,
      providerName: providerNameMap.get(catalogModel.provider) || getCatalogProviderDisplayName(catalogModel.provider),
      ...(capabilities ? { capabilities } : {}),
    })
  }

  return NextResponse.json({
    llm: dedupeByModelKey(grouped.llm),
    image: dedupeByModelKey(grouped.image),
    video: dedupeByModelKey(grouped.video),
    audio: dedupeByModelKey(grouped.audio),
    lipsync: dedupeByModelKey(grouped.lipsync),
  } satisfies UserModelsPayload)
})
