import { OmniVoiceError } from '@omnivoice/sdk'

export function mapOmnivoiceError(err: unknown): { errorCode: string; error: string } {
  if (err instanceof OmniVoiceError) {
    const detail = readDetail(err.body) || err.message || `HTTP ${err.status}`
    if (err.status === 404) {
      return { errorCode: 'OMNIVOICE_PROFILE_NOT_FOUND', error: detail }
    }
    if (err.status === 400 || err.status === 422) {
      return { errorCode: 'OMNIVOICE_INVALID_PARAMS', error: detail }
    }
    if (err.status >= 500) {
      return { errorCode: 'OMNIVOICE_BACKEND_ERROR', error: detail }
    }
    return { errorCode: 'OMNIVOICE_BACKEND_ERROR', error: detail }
  }

  const message = err instanceof Error ? err.message : String(err)
  return { errorCode: 'OMNIVOICE_BACKEND_UNREACHABLE', error: message }
}

function readDetail(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const node = body as { detail?: unknown }
  if (typeof node.detail === 'string') return node.detail
  return ''
}
