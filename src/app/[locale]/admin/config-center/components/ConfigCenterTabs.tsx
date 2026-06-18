'use client'

import { usePathname, useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'

type TabType = 'prompts' | 'art-styles'

interface TabConfig {
  key: TabType
  labelKey: string
  path: string
}

const tabs: TabConfig[] = [
  { key: 'prompts', labelKey: 'tabs.prompts', path: '/admin/config-center' },
  { key: 'art-styles', labelKey: 'tabs.artStyles', path: '/admin/config-center/art-styles' },
]

export default function ConfigCenterTabs() {
  const t = useTranslations('configCenter')
  const pathname = usePathname()
  const router = useRouter()

  const getActiveTab = (): TabType => {
    if (pathname.includes('/admin/config-center/art-styles')) {
      return 'art-styles'
    }
    return 'prompts'
  }

  const activeTab = getActiveTab()

  const handleTabClick = (tab: TabConfig) => {
    router.push(tab.path)
  }

  return (
    <div className="flex items-center gap-1 mb-4">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.key
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleTabClick(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-xl border-2 transition-all ${isActive
              ? 'border-[var(--glass-accent-from)] bg-[var(--glass-bg-muted)] text-[var(--glass-text-primary)]'
              : 'border-transparent text-[var(--glass-text-secondary)] hover:text-[var(--glass-text-primary)] hover:bg-[var(--glass-bg-muted)]'
              }`}
          >
            {t(tab.labelKey)}
          </button>
        )
      })}
    </div>
  )
}
