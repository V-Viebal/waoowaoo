import { getOmnivoiceClient } from './client'

export interface OmnivoiceProbeStep {
  name: 'health'
  status: 'pass' | 'fail'
  message: string
  detail?: string
}

export interface OmnivoiceProbeResult {
  success: boolean
  steps: OmnivoiceProbeStep[]
}

export async function probeOmnivoice(): Promise<OmnivoiceProbeResult> {
  const ov = getOmnivoiceClient()
  try {
    const r = await ov.health()
    return {
      success: true,
      steps: [{
        name: 'health',
        status: 'pass',
        message: `OmniVoice ${r.version ?? '?'} on ${r.device ?? '?'}`,
      }],
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      steps: [{
        name: 'health',
        status: 'fail',
        message: 'Network or backend error',
        detail: message.slice(0, 500),
      }],
    }
  }
}
