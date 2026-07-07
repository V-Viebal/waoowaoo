'use client'

import React, { useState } from 'react'
import VideoPanelCardHeader from './VideoPanelCardHeader'
import VideoPanelCardBody from './VideoPanelCardBody'
import VideoPanelCardFooter from './VideoPanelCardFooter'
import PanelHistoryDrawer from '../../storyboard/PanelHistoryDrawer'
import { useVideoPanelActions, type VideoPanelCardShellProps } from './hooks/useVideoPanelActions'
import { parsePanelHistory } from '@/lib/novel-promotion/panel-history'

export type { VideoPanelCardShellProps }

function VideoPanelCardLayout(props: VideoPanelCardShellProps) {
  const runtime = useVideoPanelActions(props)
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyCount = parsePanelHistory(runtime.panel.videoHistory ?? null).length
  const panelId = runtime.panel.panelId

  return (
    <div className="glass-surface-elevated overflow-visible">
      <VideoPanelCardHeader
        runtime={runtime}
        onOpenHistory={panelId ? () => setHistoryOpen(true) : undefined}
        historyCount={historyCount}
      />
      <VideoPanelCardBody runtime={runtime} />
      <VideoPanelCardFooter runtime={runtime} />
      {panelId && (
        <PanelHistoryDrawer
          projectId={props.projectId}
          panelId={panelId}
          mediaType="video"
          open={historyOpen}
          onOpenChange={setHistoryOpen}
        />
      )}
    </div>
  )
}

export default React.memo(VideoPanelCardLayout)
