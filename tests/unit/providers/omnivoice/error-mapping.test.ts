import { describe, it, expect } from 'vitest'
import { mapOmnivoiceError } from '@/lib/providers/omnivoice/error-mapping'
import { buildOmniVoiceError } from './_helpers'

describe('mapOmnivoiceError', () => {
  it('maps 400 to OMNIVOICE_INVALID_PARAMS', () => {
    const err = buildOmniVoiceError(400, { detail: 'bad input' }, 'bad input')
    const r = mapOmnivoiceError(err)
    expect(r.errorCode).toBe('OMNIVOICE_INVALID_PARAMS')
    expect(r.error).toContain('bad input')
  })

  it('maps 404 to OMNIVOICE_PROFILE_NOT_FOUND', () => {
    const err = buildOmniVoiceError(404, { detail: 'no profile' }, 'no profile')
    expect(mapOmnivoiceError(err).errorCode).toBe('OMNIVOICE_PROFILE_NOT_FOUND')
  })

  it('maps 422 to OMNIVOICE_INVALID_PARAMS', () => {
    const err = buildOmniVoiceError(422, { detail: 'validation' }, 'validation')
    expect(mapOmnivoiceError(err).errorCode).toBe('OMNIVOICE_INVALID_PARAMS')
  })

  it('maps 500 to OMNIVOICE_BACKEND_ERROR', () => {
    const err = buildOmniVoiceError(500, { detail: 'oops' }, 'oops')
    expect(mapOmnivoiceError(err).errorCode).toBe('OMNIVOICE_BACKEND_ERROR')
  })

  it('maps 503 to OMNIVOICE_BACKEND_ERROR', () => {
    const err = buildOmniVoiceError(503, null, 'unavail')
    expect(mapOmnivoiceError(err).errorCode).toBe('OMNIVOICE_BACKEND_ERROR')
  })

  it('maps fetch network error to OMNIVOICE_BACKEND_UNREACHABLE', () => {
    const err = new TypeError('fetch failed')
    expect(mapOmnivoiceError(err).errorCode).toBe('OMNIVOICE_BACKEND_UNREACHABLE')
  })

  it('maps unknown errors to OMNIVOICE_BACKEND_UNREACHABLE with raw message', () => {
    const err = new Error('weird')
    const r = mapOmnivoiceError(err)
    expect(r.errorCode).toBe('OMNIVOICE_BACKEND_UNREACHABLE')
    expect(r.error).toContain('weird')
  })
})
