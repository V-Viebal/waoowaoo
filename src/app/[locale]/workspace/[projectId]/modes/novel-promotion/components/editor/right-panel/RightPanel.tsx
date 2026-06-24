'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useTimelineContext } from '@twick/timeline'
import { CaptionPanel } from './ai/CaptionPanel'
import { EnhancePanel } from './ai/EnhancePanel'
import { SmartCutPanel } from './ai/SmartCutPanel'
import { TransitionPanel } from './ai/TransitionPanel'
import { VoiceOptimizePanel } from './ai/VoiceOptimizePanel'
import { CaptionStylePanel } from './properties/CaptionStylePanel'

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

  return (
    <div className="space-y-3 text-xs text-slate-500">
      <SmartCutPanel />
      <CaptionPanel />
      <EnhancePanel />
      <VoiceOptimizePanel />
      <TransitionPanel />
      <div className="text-center text-[10px] text-slate-400">{t('phase2Hint')}</div>
    </div>
  )
}

function PropertiesPanel({ selectedId, trackCount }: { selectedId: string | null; trackCount: number }) {
  const t = useTranslations('novelPromotion.editor.rightPanel.properties')

  return (
    <div className="space-y-3 text-xs text-slate-500">
      <CaptionStylePanel selectedId={selectedId} />
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
