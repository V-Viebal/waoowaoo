import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getOmnivoiceClient, getOmnivoiceBaseUrl, resetOmnivoiceClientForTest } from '@/lib/providers/omnivoice/client'

describe('omnivoice client', () => {
  const originalEnv = { ...process.env }
  beforeEach(() => {
    resetOmnivoiceClientForTest()
  })
  afterEach(() => {
    process.env = { ...originalEnv }
    resetOmnivoiceClientForTest()
  })

  it('uses default baseUrl when env unset', () => {
    delete process.env.OMNIVOICE_BASE_URL
    expect(getOmnivoiceBaseUrl()).toBe('http://127.0.0.1:3900')
  })

  it('reads baseUrl from env', () => {
    process.env.OMNIVOICE_BASE_URL = 'http://omni.test:9000'
    expect(getOmnivoiceBaseUrl()).toBe('http://omni.test:9000')
  })

  it('returns same instance on repeat calls (singleton)', () => {
    const a = getOmnivoiceClient()
    const b = getOmnivoiceClient()
    expect(a).toBe(b)
  })

  it('resetOmnivoiceClientForTest clears singleton', () => {
    const a = getOmnivoiceClient()
    resetOmnivoiceClientForTest()
    const b = getOmnivoiceClient()
    expect(a).not.toBe(b)
  })
})
