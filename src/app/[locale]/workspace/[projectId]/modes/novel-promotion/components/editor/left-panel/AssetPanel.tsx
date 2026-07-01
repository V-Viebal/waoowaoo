'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { ImageAssetList } from './ImageAssetList'
import { VideoAssetList } from './VideoAssetList'
import { VoiceAssetList } from './VoiceAssetList'

type AssetTab = 'video' | 'image' | 'audio' | 'bgm'

export function AssetPanel() {
  const t = useTranslations('novelPromotion.editor.assets')
  const [activeTab, setActiveTab] = useState<AssetTab>('video')

  const tabs: Array<{ key: AssetTab; label: string; icon: AppIconName }> = [
    { key: 'video', label: t('tabs.video'), icon: 'film' },
    { key: 'image', label: t('tabs.image'), icon: 'image' },
    { key: 'audio', label: t('tabs.audio'), icon: 'mic' },
    { key: 'bgm', label: t('tabs.bgm'), icon: 'music' },
  ]

  return (
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 bg-white text-slate-950">
      <div className="border-b border-slate-200 px-3 py-3">
        <div className="text-sm font-semibold text-slate-900">{t('title')}</div>
        <div className="mt-1 text-[11px] leading-4 text-slate-500">{t('description')}</div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 bg-slate-50/60 p-1.5">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              aria-pressed={isActive}
              title={tab.label}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition ${
                isActive
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-500 hover:bg-white/60 hover:text-slate-900'
              }`}
            >
              <AppIcon name={tab.icon} className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === 'video' && <VideoAssetList />}
        {activeTab === 'image' && <ImageAssetList />}
        {activeTab === 'audio' && <VoiceAssetList />}
        {activeTab === 'bgm' && <EmptyState text={t('empty.bgm')} />}
      </div>
    </aside>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 p-6 text-center text-xs text-slate-500">
      <AppIcon name="inbox" className="h-6 w-6 text-slate-300" strokeWidth={1.8} aria-hidden />
      {text}
    </div>
  )
}
