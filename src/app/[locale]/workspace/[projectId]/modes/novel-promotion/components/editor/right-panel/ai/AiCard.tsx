'use client'

import type { ReactNode } from 'react'
import { AppIcon, type AppIconName } from '@/components/ui/icons'

export type AiCardTone = 'blue' | 'violet' | 'emerald' | 'amber' | 'pink'

const TONE_STYLES: Record<AiCardTone, { surface: string; ring: string; icon: string; accent: string }> = {
  blue:    { surface: 'from-sky-50/80 via-white to-white',        ring: 'ring-sky-200/60',    icon: 'bg-sky-100 text-sky-600',        accent: 'bg-sky-500 hover:bg-sky-600 focus-visible:ring-sky-400/60' },
  violet:  { surface: 'from-violet-50/80 via-white to-white',     ring: 'ring-violet-200/60', icon: 'bg-violet-100 text-violet-600',  accent: 'bg-violet-500 hover:bg-violet-600 focus-visible:ring-violet-400/60' },
  emerald: { surface: 'from-emerald-50/80 via-white to-white',    ring: 'ring-emerald-200/60',icon: 'bg-emerald-100 text-emerald-600',accent: 'bg-emerald-500 hover:bg-emerald-600 focus-visible:ring-emerald-400/60' },
  amber:   { surface: 'from-amber-50/80 via-white to-white',      ring: 'ring-amber-200/60',  icon: 'bg-amber-100 text-amber-600',    accent: 'bg-amber-500 hover:bg-amber-600 focus-visible:ring-amber-400/60' },
  pink:    { surface: 'from-pink-50/80 via-white to-white',       ring: 'ring-pink-200/60',   icon: 'bg-pink-100 text-pink-600',      accent: 'bg-pink-500 hover:bg-pink-600 focus-visible:ring-pink-400/60' },
}

interface AiCardProps {
  tone: AiCardTone
  icon: AppIconName
  title: string
  description: string
  /** Extra controls rendered between description and status (e.g. selectors, textarea). */
  children?: ReactNode
  /** Status text (info / error). Rendered as a subtle chip above the action. */
  status?: string | null
  /** When true the status chip renders in error tone. */
  isError?: boolean
  /** Action button caption. */
  actionLabel: string
  onAction: () => void
  disabled?: boolean
  running?: boolean
}

export function AiCard({
  tone,
  icon,
  title,
  description,
  children,
  status,
  isError,
  actionLabel,
  onAction,
  disabled,
  running,
}: AiCardProps) {
  const style = TONE_STYLES[tone]
  return (
    <section
      className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${style.surface} p-3 ring-1 ${style.ring} shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:shadow-[0_4px_16px_rgba(15,23,42,0.06)]`}
    >
      <header className="flex items-start gap-2.5">
        <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl ${style.icon} shadow-sm`}>
          <AppIcon name={icon} className="h-4 w-4" strokeWidth={2.2} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-slate-900">{title}</div>
          <div className="mt-0.5 text-[11px] leading-[1.45] text-slate-500">{description}</div>
        </div>
      </header>

      {children ? <div className="mt-2.5">{children}</div> : null}

      {status ? (
        <div
          role={isError ? 'alert' : 'status'}
          aria-live={isError ? 'assertive' : 'polite'}
          className={`mt-2.5 rounded-lg px-2 py-1 text-[11px] leading-4 ${isError ? 'bg-red-50 text-red-600' : 'bg-white/70 text-slate-600 ring-1 ring-inset ring-slate-100'}`}
        >
          {status}
        </div>
      ) : null}

      <button
        type="button"
        disabled={disabled}
        onClick={onAction}
        className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-white shadow-sm transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-current ${style.accent}`}
      >
        {running ? (
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
        ) : null}
        {actionLabel}
      </button>
    </section>
  )
}
