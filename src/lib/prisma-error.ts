type PrismaLikeError = {
  code?: unknown
  message?: unknown
  cause?: unknown
}

const PRISMA_CODE_PATTERN = /^P\d{4}$/i

const RETRYABLE_PRISMA_CODES = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'P2028',
])

const DISCONNECT_MESSAGE_MARKERS = [
  'server has closed the connection',
  'unable to start a transaction in the given time',
  'connection timed out',
  "can't reach database server",
  'connection lost',
  'too many connections',
  'pool closed',
  'the database connection is invalid',
  'read econnreset',
  'broken pipe',
  'mysql server has gone away',
]

function toMessage(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return ''
}

function walkErrorChain(start: unknown, visit: (err: PrismaLikeError) => boolean | void): void {
  const seen = new Set<unknown>()
  let current: unknown = start
  for (let depth = 0; depth < 8; depth += 1) {
    if (!current || typeof current !== 'object' || seen.has(current)) break
    seen.add(current)
    const shouldStop = visit(current as PrismaLikeError)
    if (shouldStop) break
    const next = (current as PrismaLikeError).cause
    if (!next) break
    current = next
  }
}

export function isPrismaErrorCode(value: unknown): value is string {
  return typeof value === 'string' && PRISMA_CODE_PATTERN.test(value.trim())
}

export function getPrismaErrorCode(error: unknown): string | null {
  let found: string | null = null
  walkErrorChain(error, (err) => {
    const code = err.code
    if (isPrismaErrorCode(code)) {
      found = code.trim().toUpperCase()
      return true
    }
  })
  return found
}

export function isPrismaRetryableCode(code: string): boolean {
  return RETRYABLE_PRISMA_CODES.has(code.trim().toUpperCase())
}

export function isLikelyPrismaDisconnectError(error: unknown): boolean {
  let detected = false
  walkErrorChain(error, (err) => {
    const message = toMessage(err.message).toLowerCase()
    if (!message) return
    for (const marker of DISCONNECT_MESSAGE_MARKERS) {
      if (message.includes(marker)) {
        detected = true
        return true
      }
    }
  })
  return detected
}

export function isRetryablePrismaError(error: unknown): boolean {
  const code = getPrismaErrorCode(error)
  if (code && isPrismaRetryableCode(code)) return true
  return isLikelyPrismaDisconnectError(error)
}
