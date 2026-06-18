import type { StarRouterProbeResult, StarRouterProbeStep } from './types'

function classifyStatus(status: number): string {
  if (status === 401 || status === 403) return `Authentication failed (${status})`
  if (status === 429) return `Rate limited (${status})`
  return `Provider error (${status})`
}

export async function probeStarRouter(apiKey: string, baseUrl?: string): Promise<StarRouterProbeResult> {
  const steps: StarRouterProbeStep[] = []
  const headers = { Authorization: `Bearer ${apiKey}` }
  const apiBase = baseUrl?.trim() || 'https://starrouter.io/v1'

  try {
    const modelsResponse = await fetch(`${apiBase}/models`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(20_000),
    })
    if (!modelsResponse.ok) {
      const detail = await modelsResponse.text().catch(() => '')
      steps.push({
        name: 'models',
        status: 'fail',
        message: classifyStatus(modelsResponse.status),
        detail: detail.slice(0, 500),
      })
      steps.push({
        name: 'credits',
        status: 'skip',
        message: 'Skipped because model probe failed',
      })
      return { success: false, steps }
    }

    const modelData = await modelsResponse.json() as { data?: Array<{ id?: string }> }
    const count = Array.isArray(modelData.data) ? modelData.data.length : 0
    steps.push({
      name: 'models',
      status: 'pass',
      message: `Found ${count} models`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    steps.push({
      name: 'models',
      status: 'fail',
      message: `Network error: ${message}`,
    })
    steps.push({
      name: 'credits',
      status: 'skip',
      message: 'Skipped because model probe failed',
    })
    return { success: false, steps }
  }

  try {
    const userInfoResponse = await fetch(`${apiBase}/user/info`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(20_000),
    })
    if (!userInfoResponse.ok) {
      // 404/405/501 表示端点不支持，跳过而不是失败
      if (userInfoResponse.status === 404 || userInfoResponse.status === 405 || userInfoResponse.status === 501) {
        steps.push({
          name: 'credits',
          status: 'skip',
          message: 'Credits endpoint not supported by StarRouter',
        })
        return { success: true, steps }
      }
      const detail = await userInfoResponse.text().catch(() => '')
      steps.push({
        name: 'credits',
        status: 'fail',
        message: classifyStatus(userInfoResponse.status),
        detail: detail.slice(0, 500),
      })
      return { success: false, steps }
    }

    const info = await userInfoResponse.json() as { balance?: unknown; data?: { balance?: unknown } }
    const balance = typeof info.balance === 'number'
      ? info.balance
      : typeof info.data?.balance === 'number'
        ? info.data.balance
        : undefined
    steps.push({
      name: 'credits',
      status: 'pass',
      message: typeof balance === 'number' ? `Balance: ${balance}` : 'User info reachable',
    })
    return { success: true, steps }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    steps.push({
      name: 'credits',
      status: 'skip',
      message: 'Credits endpoint not supported by StarRouter',
    })
    return { success: true, steps }
  }
}
