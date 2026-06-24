'use client'

import { useTranslations } from 'next-intl'

export function CaptionStylePanel({ selectedId }: { selectedId: string | null }) {
  const t = useTranslations('novelPromotion.editor.rightPanel.properties.captionStyle')

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="font-medium text-slate-950">{t('title')}</div>
      <div className="mt-2 break-all font-mono text-[11px] text-slate-500">
        {selectedId || t('noneSelected')}
      </div>
      <div className="mt-3 rounded-xl border border-dashed border-slate-200 p-3 text-[11px] leading-5 text-slate-500">
        {t('mvpHint')}
      </div>
    </div>
  )
}
