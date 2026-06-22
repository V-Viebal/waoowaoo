'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useTimelineContext } from '@twick/timeline'

type RightPanelTab = 'ai' | 'properties'

export function RightPanel() {
  const t = useTranslations('novelPromotion.editor.rightPanel')
  const [activeTab, setActiveTab] = useState<RightPanelTab>('ai')
  const { present, selectedItem } = useTimelineContext()
  const selectedId = selectedItem?.getId() ?? null
  const trackCount = present?.tracks?.length ?? 0

  return (
    <aside className="flex h-full w-72 flex-col border-l border-slate-200 bg-white text-slate-950">
      <div className="grid grid-cols-2 border-b border-slate-200">
        {(['ai', 'properties'] as RightPanelTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-3 text-xs transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-slate-950 font-medium text-slate-950'
                : 'text-slate-500 hover:text-slate-950'
            }`}
          >
            {t(`tabs.${tab}`)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === 'ai' ? <AiPanel /> : <PropertiesPanel selectedId={selectedId} trackCount={trackCount} />}
      </div>
    </aside>
  )
}

function AiPanel() {
  const t = useTranslations('novelPromotion.editor.rightPanel.ai')
  const cards = [
    { key: 'roughCut', button: 'execute' },
    { key: 'captions', button: 'generate' },
    { key: 'polish', button: 'open' },
  ] as const

  return (
    <div className="space-y-3 text-xs text-slate-500">
      {cards.map((card) => (
        <div key={card.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="font-medium text-slate-950">{t(`${card.key}.title`)}</div>
          <div className="mt-1 leading-5">{t(`${card.key}.description`)}</div>
          <button
            type="button"
            disabled
            className="mt-3 w-full rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white opacity-50"
          >
            {t(`buttons.${card.button}`)}
          </button>
        </div>
      ))}
      <div className="text-center text-[10px] text-slate-400">{t('phase2Hint')}</div>
    </div>
  )
}

function PropertiesPanel({ selectedId, trackCount }: { selectedId: string | null; trackCount: number }) {
  const t = useTranslations('novelPromotion.editor.rightPanel.properties')

  return (
    <div className="space-y-3 text-xs text-slate-500">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="font-medium text-slate-950">{t('selection')}</div>
        <div className="mt-2 break-all font-mono text-[11px]">
          {selectedId || t('noneSelected')}
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="font-medium text-slate-950">{t('timeline')}</div>
        <div className="mt-2">{t('trackCount', { count: trackCount })}</div>
      </div>
      <div className="rounded-2xl border border-dashed border-slate-200 p-3 text-center">
        {t('phase2Hint')}
      </div>
    </div>
  )
}
