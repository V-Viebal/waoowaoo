'use client'

import { useTranslations } from 'next-intl'
import { useEditorStageRuntime } from '@/lib/novel-promotion/stages/editor-stage-runtime-core'

export function ImageAssetList() {
  const t = useTranslations('novelPromotion.editor.assets')
  const { panelVideos } = useEditorStageRuntime()

  return (
    <div className="space-y-2">
      <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
        {t('empty.image')}
      </div>
      {panelVideos.length > 0 ? (
        <div className="rounded-2xl bg-slate-50 p-3 text-[11px] leading-5 text-slate-500">
          {t('imageHint')}
        </div>
      ) : null}
    </div>
  )
}
