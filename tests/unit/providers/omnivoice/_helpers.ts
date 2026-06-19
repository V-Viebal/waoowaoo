import { OmniVoiceError } from '@omnivoice/sdk'

/**
 * Build an OmniVoiceError instance with a chosen status, for unit tests.
 *
 * The SDK's real constructor signature is (message, Response, body), where
 * the Response.status drives err.status. This helper hides that wiring.
 */
export function buildOmniVoiceError(
  status: number,
  body: unknown,
  message: string = `HTTP ${status}`,
): OmniVoiceError {
  const response = new Response(null, { status })
  return new OmniVoiceError(message, response, body)
}
