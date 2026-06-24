'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ImageAssetList } from './ImageAssetList'
import { VideoAssetList } from './VideoAssetList'
import { VoiceAssetList } from './VoiceAssetList'

type AssetTab = 'video' | 'image' | 'audio' | 'bgm'

export function AssetPanel() {
  const t = useTranslations('novelPromotion.editor.assets')
  const [activeTab, setActiveTab] = useState<AssetTab>('video')

  const tabs: Array<{ key: AssetTab; label: string }> = [
    { key: 'video', label: t('tabs.video') },
    { key: 'image', label: t('tabs.image') },
    { key: 'audio', label: t('tabs.audio') },
    { key: 'bgm', label: t('tabs.bgm') },
  ]

  return (
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 bg-white text-slate-950">
      <div className="border-b border-slate-200 px-3 py-3">
        <div className="text-sm font-semibold">{t('title')}</div>
        <div className="mt-1 text-[11px] text-slate-500">{t('description')}</div>
      </div>

      <div className="grid grid-cols-4 border-b border-slate-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-2 py-2 text-xs transition-colors ${
              activeTab === tab.key
                ? 'border-b-2 border-slate-950 font-medium text-slate-950'
                : 'text-slate-500 hover:text-slate-950'
            }`}
          >
            {tab.label}
          </button>
        ))}
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
    <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
      {text}
    </div>
  )
}
