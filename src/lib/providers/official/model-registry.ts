export type OfficialProviderKey = 'bailian' | 'siliconflow' | 'starrouter' | 'omnivoice'
export type OfficialModelModality = 'llm' | 'image' | 'video' | 'audio'

interface RegisterOfficialModelInput {
  provider: OfficialProviderKey
  modality: OfficialModelModality
  modelId: string
}

interface AssertOfficialModelInput {
  provider: OfficialProviderKey
  modality: OfficialModelModality
  modelId: string
}

const registry = new Set<string>()

function buildRegistryKey(input: RegisterOfficialModelInput): string {
  return `${input.provider}::${input.modality}::${input.modelId}`
}

function readTrimmedString(value: string): string {
  return value.trim()
}

export function registerOfficialModel(input: RegisterOfficialModelInput): void {
  const modelId = readTrimmedString(input.modelId)
  if (!modelId) {
    throw new Error('MODEL_REGISTRY_INVALID_MODEL_ID')
  }
  registry.add(buildRegistryKey({ ...input, modelId }))
}

export function isOfficialModelRegistered(input: AssertOfficialModelInput): boolean {
  const modelId = readTrimmedString(input.modelId)
  if (!modelId) return false
  return registry.has(buildRegistryKey({ ...input, modelId }))
}

export function assertOfficialModelRegistered(input: AssertOfficialModelInput): void {
  if (isOfficialModelRegistered(input)) return
  throw new Error(`MODEL_NOT_REGISTERED: ${input.provider}/${input.modality}/${input.modelId}`)
}

export interface OfficialCatalogModel {
  provider: OfficialProviderKey
  modelId: string
  modelKey: string
  modality: OfficialModelModality
}

/**
 * 列出指定 modality 下所有已注册的官方 catalog 模型。
 * 用于在用户没有自定义模型时,提供可选的预置模型(如 OmniVoice TTS)。
 */
export function listOfficialCatalogModels(modality: OfficialModelModality): OfficialCatalogModel[] {
  const results: OfficialCatalogModel[] = []
  const suffix = `::${modality}::`
  for (const key of registry) {
    const idx = key.indexOf(suffix)
    if (idx === -1) continue
    const provider = key.slice(0, idx) as OfficialProviderKey
    const modelId = key.slice(idx + suffix.length)
    results.push({
      provider,
      modelId,
      modelKey: `${provider}:${modelId}`,
      modality,
    })
  }
  return results
}

export function resetOfficialModelRegistryForTest(): void {
  registry.clear()
}
