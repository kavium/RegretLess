import { useEffect, useRef, useState } from 'react'
import { useDataContext } from './data-context'

export type RefreshState = 'idle' | 'working' | 'done'

export function useRefreshControl() {
  const { manifest, status, refreshPublishedData } = useDataContext()
  const [refreshState, setRefreshState] = useState<RefreshState>('idle')
  const [resultMsg, setResultMsg] = useState<string | null>(null)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    }
  }, [])

  async function handleRefresh() {
    setRefreshState('working')
    setResultMsg(null)
    try {
      const result = await refreshPublishedData()
      setRefreshState('done')
      const changed = result.changedSubjectIds.length
      setResultMsg(changed ? `${changed} subject${changed === 1 ? '' : 's'} updated` : 'No new questions')
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
      timeoutRef.current = window.setTimeout(() => {
        setRefreshState('idle')
        setResultMsg(null)
        timeoutRef.current = null
      }, 2400)
    } catch {
      setRefreshState('idle')
    }
  }

  const label =
    refreshState === 'working'
      ? 'Diffing source'
      : refreshState === 'done'
      ? resultMsg ?? 'Up to date'
      : 'Refresh data'

  const meta = manifest
    ? `${manifest.subjects.length} subjects · published ${new Date(manifest.generatedAt).toLocaleString()}`
    : null

  return { manifest, status, refreshState, handleRefresh, label, meta }
}
