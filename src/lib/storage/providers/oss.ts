import type {
  DeleteObjectsResult,
  GetObjectStreamOptions,
  GetObjectStreamResult,
  SignedUrlParams,
  StorageProvider,
  UploadObjectParams,
  UploadObjectResult,
} from '@/lib/storage/types'
import { normalizeKey, requireEnv, toFetchableUrl } from '@/lib/storage/utils'
import { StorageConfigError } from '@/lib/storage/errors'
import type { Readable } from 'node:stream'

// ali-oss SDK types (package ships no .d.ts; keep surface minimal)
type OssGetResult = { content: Buffer; res?: { status: number; headers: Record<string, string | string[] | undefined> } }
type OssGetStreamResult = {
  stream: Readable
  res?: { status: number; headers: Record<string, string | string[] | undefined> }
}
type OssDeleteMultiResult = { deleted?: string[] }
type OssClient = {
  put(key: string, body: Buffer, options?: { mime?: string; headers?: Record<string, string> }): Promise<unknown>
  get(key: string, options?: { headers?: Record<string, string> }): Promise<OssGetResult>
  getStream(key: string, options?: { headers?: Record<string, string> }): Promise<OssGetStreamResult>
  delete(key: string): Promise<unknown>
  deleteMulti(keys: string[], options?: { quiet?: boolean }): Promise<OssDeleteMultiResult>
  signatureUrl(key: string, options?: { expires?: number; method?: string; headers?: Record<string, string> }): string
  options: {
    bucket: string
    endpoint: string
    internal: boolean
    cname: boolean
    secure: boolean
  }
}

type OssModule = {
  default: new (config: Record<string, unknown>) => OssClient
}

export class OssStorageProvider implements StorageProvider {
  readonly kind = 'oss' as const

  private readonly bucket: string
  private readonly region: string
  private readonly accessKeyId: string
  private readonly accessKeySecret: string
  private readonly endpoint: string | undefined
  private readonly internal: boolean
  private readonly cname: boolean
  private readonly secure: boolean
  private clientPromise: Promise<OssClient> | null = null

  constructor() {
    this.region = requireEnv('OSS_REGION')
    this.accessKeyId = (process.env.OSS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY || '').trim()
    this.accessKeySecret = (process.env.OSS_ACCESS_KEY_SECRET || process.env.OSS_SECRET_KEY || '').trim()
    if (!this.accessKeyId) {
      throw new StorageConfigError('Missing required environment variable: OSS_ACCESS_KEY_ID (or OSS_ACCESS_KEY)')
    }
    if (!this.accessKeySecret) {
      throw new StorageConfigError('Missing required environment variable: OSS_ACCESS_KEY_SECRET (or OSS_SECRET_KEY)')
    }
    this.bucket = requireEnv('OSS_BUCKET')

    this.endpoint = process.env.OSS_ENDPOINT?.trim() || undefined
    this.internal = process.env.OSS_INTERNAL === 'true'
    this.cname = process.env.OSS_CNAME === 'true'
    this.secure = process.env.OSS_SECURE !== 'false'
  }

  private async loadSdk(): Promise<OssModule> {
    return await import('ali-oss') as unknown as OssModule
  }

  private async getClient(): Promise<OssClient> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const mod = await this.loadSdk()
        const OSS = mod.default
        const config: Record<string, unknown> = {
          region: this.region,
          accessKeyId: this.accessKeyId,
          accessKeySecret: this.accessKeySecret,
          bucket: this.bucket,
          secure: this.secure,
          internal: this.internal,
          cname: this.cname,
          timeout: '600s',
        }
        if (this.endpoint) {
          config.endpoint = this.endpoint
        }
        return new OSS(config)
      })()
    }
    return await this.clientPromise
  }

  async uploadObject(params: UploadObjectParams): Promise<UploadObjectResult> {
    const client = await this.getClient()
    const key = normalizeKey(params.key)
    await client.put(key, params.body, params.contentType ? { mime: params.contentType } : undefined)
    return { key }
  }

  async deleteObject(key: string): Promise<void> {
    const client = await this.getClient()
    await client.delete(normalizeKey(key))
  }

  async deleteObjects(keys: string[]): Promise<DeleteObjectsResult> {
    const validKeys = keys
      .filter((k) => typeof k === 'string' && k.trim().length > 0)
      .map((k) => normalizeKey(k))
    if (validKeys.length === 0) {
      return { success: 0, failed: 0 }
    }

    const client = await this.getClient()
    // ali-oss deleteMulti has a 1000-key limit per request; batch it.
    const BATCH = 1000
    let success = 0
    let failed = 0
    for (let i = 0; i < validKeys.length; i += BATCH) {
      const batch = validKeys.slice(i, i + BATCH)
      try {
        const result = await client.deleteMulti(batch, { quiet: true })
        // quiet mode returns {} with no deleted list; treat all batched keys as success.
        success += result.deleted?.length ?? batch.length
      } catch {
        // ponytail: per-key error detail not exposed by SDK in quiet mode; fall back to one-by-one.
        for (const k of batch) {
          try {
            await client.delete(k)
            success += 1
          } catch {
            failed += 1
          }
        }
      }
    }
    return { success, failed }
  }

  async getSignedObjectUrl(params: SignedUrlParams): Promise<string> {
    const client = await this.getClient()
    return client.signatureUrl(normalizeKey(params.key), {
      expires: params.expiresInSeconds,
      method: 'GET',
    })
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const client = await this.getClient()
    const result = await client.get(normalizeKey(key))
    return result.content
  }

  async getObjectStream(key: string, options?: GetObjectStreamOptions): Promise<GetObjectStreamResult> {
    const client = await this.getClient()
    const normalizedKey = normalizeKey(key)
    const headers: Record<string, string> = {}
    if (options?.rangeHeader) headers.Range = options.rangeHeader
    const result = await client.getStream(normalizedKey, { headers })
    const resHeaders = result.res?.headers ?? {}
    const pick = (name: string): string | undefined => {
      const val = resHeaders[name]
      return Array.isArray(val) ? val[0] : (val as string | undefined)
    }
    return {
      body: result.stream,
      contentType: pick('content-type'),
      contentLength: pick('content-length') ? Number(pick('content-length')) : undefined,
      contentRange: pick('content-range'),
      acceptsRanges: pick('accept-ranges') ?? 'bytes',
      statusCode: result.res?.status,
    }
  }

  extractStorageKey(input: string | null | undefined): string | null {
    if (!input) return null
    if (!input.startsWith('http') && !input.startsWith('/')) {
      return normalizeKey(input)
    }

    try {
      const parsed = new URL(input)
      // Public endpoint: https://<bucket>.<endpoint>/<key>
      // Path-style / internal may look like https://<endpoint>/<bucket>/<key>
      const pathname = parsed.pathname.replace(/^\/+/, '')
      const host = parsed.hostname
      const bucketDotPrefix = `${this.bucket}.`
      if (host.startsWith(bucketDotPrefix)) {
        // virtual-hosted style
        return normalizeKey(pathname)
      }
      if (pathname.startsWith(`${this.bucket}/`)) {
        return normalizeKey(pathname.slice(this.bucket.length + 1))
      }
      return pathname ? normalizeKey(pathname) : null
    } catch {
      return null
    }
  }

  toFetchableUrl(inputUrl: string): string {
    return toFetchableUrl(inputUrl)
  }

  generateUniqueKey(params: { prefix: string; ext: string }): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    return `images/${params.prefix}-${timestamp}-${random}.${params.ext}`
  }
}
