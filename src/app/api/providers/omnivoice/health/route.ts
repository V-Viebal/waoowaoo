import { NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { probeOmnivoice, getOmnivoiceClient } from '@/lib/providers/omnivoice'

export const GET = apiHandler(async () => {
  const probe = await probeOmnivoice()
  if (!probe.success) {
    return NextResponse.json(
      { available: false, detail: probe.steps[0]?.detail },
      { status: 200 },
    )
  }
  try {
    const ov = getOmnivoiceClient()
    const r = await ov.health()
    return NextResponse.json({
      available: true,
      version: r.version,
      device: r.device,
    })
  } catch {
    return NextResponse.json({ available: false }, { status: 200 })
  }
})
