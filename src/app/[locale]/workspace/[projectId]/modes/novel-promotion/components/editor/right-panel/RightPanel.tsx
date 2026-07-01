'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useTimelineContext } from '@twick/timeline'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { CaptionPanel } from './ai/CaptionPanel'
import { EnhancePanel } from './ai/EnhancePanel'
import { SmartCutPanel } from './ai/SmartCutPanel'
import { TransitionPanel } from './ai/TransitionPanel'
import { VoiceOptimizePanel } from './ai/VoiceOptimizePanel'
import { ClipPropertiesPanel } from './properties/ClipPropertiesPanel'

type RightPanelTab = 'ai' | 'properties'

const TAB_META: Record<RightPanelTab, { icon: AppIconName }> = {
  ai: { icon: 'sparkles' },
  properties: { icon: 'slidersHorizontal' },
}

export function RightPanel() {
  const t = useTranslations('novelPromotion.editor.rightPanel')
  const [activeTab, setActiveTab] = useState<RightPanelTab>('properties')
  const { present, selectedItem } = useTimelineContext()
  const selectedId = selectedItem?.getId() ?? null
  const trackCount = present?.tracks?.length ?? 0

  return (
    <aside className="flex h-full w-72 flex-col border-l border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--glass-text-primary)]">
      <div className="flex gap-1 border-b border-[var(--glass-border)] bg-[var(--glass-bg-muted)]/40 p-1.5">
        {(['ai', 'properties'] as RightPanelTab[]).map((tab) => {
          const isActive = activeTab === tab
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              aria-pressed={isActive}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition ${
                isActive
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-500 hover:bg-white/60 hover:text-slate-900'
              }`}
            >
              <AppIcon name={TAB_META[tab].icon} className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
              {t(`tabs.${tab}`)}
            </button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === 'ai' ? <AiPanel /> : <PropertiesPanel selectedId={selectedId} trackCount={trackCount} />}
      </div>
    </aside>
  )
}

function AiPanel() {
  const t = useTranslations('novelPromotion.editor.rightPanel.ai')
  // ponytail: five panels mount together but each panel's useTaskStatus only polls when
  // its own submittedTaskId is non-null, so the "5 concurrent polls" concern from the
  // audit is only real when the user has kicked off all five — worth it for discoverability.

  return (
    <div className="space-y-3">
      <SmartCutPanel />
      <CaptionPanel />
      <EnhancePanel />
      <VoiceOptimizePanel />
      <TransitionPanel />
      <div className="pt-1 text-center text-[10px] text-slate-400">{t('phase2Hint')}</div>
    </div>
  )
}

function PropertiesPanel({ selectedId, trackCount }: { selectedId: string | null; trackCount: number }) {
  const t = useTranslations('novelPromotion.editor.rightPanel.properties')

  return (
    <div className="space-y-3 text-xs text-[var(--glass-text-secondary)]">
      <ClipPropertiesPanel selectedId={selectedId} />
      <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg-muted)] p-3">
        <div className="font-medium text-[var(--glass-text-primary)]">{t('timeline')}</div>
        <div className="mt-2">{t('trackCount', { count: trackCount })}</div>
      </div>
    </div>
  )
}
