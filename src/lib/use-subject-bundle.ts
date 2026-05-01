import { useEffect, useState } from 'react'
import { useDataContext } from './data-context'
import type { SubjectBundle } from '../types'

type BundleState =
  | { status: 'idle'; bundle: null; error: null }
  | { status: 'loading'; bundle: null; error: null }
  | { status: 'ready'; bundle: SubjectBundle; error: null }
  | { status: 'error'; bundle: null; error: string }

const IDLE: BundleState = { status: 'idle', bundle: null, error: null }

export function useSubjectBundle(subjectId: string | undefined) {
  const { manifest, loadSubjectBundle } = useDataContext()
  const [state, setState] = useState<BundleState>(IDLE)
  const [lastKey, setLastKey] = useState<string | null>(null)

  const key = subjectId && manifest ? subjectId : null
  if (lastKey !== key) {
    setLastKey(key)
    setState(key ? { status: 'loading', bundle: null, error: null } : IDLE)
  }

  useEffect(() => {
    if (!key) return
    let cancelled = false
    void (async () => {
      try {
        const nextBundle = await loadSubjectBundle(key)
        if (!cancelled) setState({ status: 'ready', bundle: nextBundle, error: null })
      } catch (nextError) {
        if (!cancelled) {
          setState({
            status: 'error',
            bundle: null,
            error: nextError instanceof Error ? nextError.message : 'Failed to load subject bundle',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [key, loadSubjectBundle])

  return state
}
