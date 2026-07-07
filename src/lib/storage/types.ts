import type { Readable } from 'node:stream'

export type StorageType = 'minio' | 'local' | 'cos' | 'oss'

export interface UploadObjectParams {
  key: string
  body: Buffer
  contentType?: string
}

export interface UploadObjectResult {
  key: string
}

export interface DeleteObjectsResult {
  success: number
  failed: number
}

export interface SignedUrlParams {
  key: string
  expiresInSeconds: number
}

export interface GetObjectStreamOptions {
  /** Raw Range header value, e.g. "bytes=0-1023". If omitted, fetches the whole object. */
  rangeHeader?: string | null
}

export interface GetObjectStreamResult {
  body: Readable
  contentType?: string
  contentLength?: number
  contentRange?: string
  acceptsRanges?: string
  statusCode?: number
}

export interface StorageProvider {
  readonly kind: StorageType
  uploadObject(params: UploadObjectParams): Promise<UploadObjectResult>
  deleteObject(key: string): Promise<void>
  deleteObjects(keys: string[]): Promise<DeleteObjectsResult>
  getSignedObjectUrl(params: SignedUrlParams): Promise<string>
  getObjectBuffer(key: string): Promise<Buffer>
  getObjectStream?(key: string, options?: GetObjectStreamOptions): Promise<GetObjectStreamResult>
  extractStorageKey(input: string | null | undefined): string | null
  toFetchableUrl(inputUrl: string): string
  generateUniqueKey(params: { prefix: string; ext: string }): string
}

export interface StorageFactoryOptions {
  storageType?: string
}
