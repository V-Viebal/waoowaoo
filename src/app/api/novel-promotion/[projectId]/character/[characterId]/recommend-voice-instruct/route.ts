import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { getProjectModelConfig } from '@/lib/config-service'

/**
 * AI 推荐角色语音特征
 * - engine=omnivoice (默认): OmniVoice 受控词表标签(男、中年、低音调 ...)
 * - engine=cosyvoice:  CosyVoice 自然语言声音描述(中年男性,声音低沉浑厚...)
 * POST /api/novel-promotion/[projectId]/character/[characterId]/recommend-voice-instruct
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; characterId: string }> },
) => {
  const { projectId, characterId } = await context.params
  if (!characterId || !characterId.trim()) {
    throw new ApiError('INVALID_PARAMS')
  }

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const locale = resolveRequiredTaskLocale(request, body)
  const engine = body.engine === 'omnivoice' ? 'omnivoice' : 'cosyvoice'

  const projectModelConfig = await getProjectModelConfig(projectId, session.user.id)
  const payload = {
    characterId,
    engine,
    displayMode: 'detail' as const,
    ...(projectModelConfig.analysisModel ? { analysisModel: projectModelConfig.analysisModel } : {}),
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.CHARACTER_VOICE_RECOMMEND,
    targetType: 'NovelPromotionCharacter',
    targetId: characterId,
    payload,
    dedupeKey: `${TASK_TYPE.CHARACTER_VOICE_RECOMMEND}:${characterId}:${engine}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.CHARACTER_VOICE_RECOMMEND, payload),
  })

  return NextResponse.json(result)
})
