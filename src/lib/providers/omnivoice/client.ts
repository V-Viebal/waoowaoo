import { OmniVoice } from '@omnivoice/sdk'

const DEFAULT_BASE_URL = 'http://127.0.0.1:3900'
const DEFAULT_TIMEOUT_MS = 300_000

let cachedClient: OmniVoice | null = null
let cachedBaseUrl: string | null = null

export function getOmnivoiceBaseUrl(): string {
  const fromEnv = process.env.OMNIVOICE_BASE_URL
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return fromEnv.trim()
  }
  return DEFAULT_BASE_URL
}

function getOmnivoiceTimeoutMs(): number {
  const raw = process.env.OMNIVOICE_REQUEST_TIMEOUT_MS
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_TIMEOUT_MS
}

export function getOmnivoiceClient(): OmniVoice {
  const baseUrl = getOmnivoiceBaseUrl()
  if (cachedClient && cachedBaseUrl === baseUrl) {
    return cachedClient
  }
  cachedClient = new OmniVoice({
    baseUrl,
    timeoutMs: getOmnivoiceTimeoutMs(),
  })
  cachedBaseUrl = baseUrl
  return cachedClient
}

export function resetOmnivoiceClientForTest(): void {
  cachedClient = null
  cachedBaseUrl = null
}
