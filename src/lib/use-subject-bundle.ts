import { useEffect, useState } from 'react'
import { useDataContext } from './data-context'
import type { SubjectBundle } from '../types'

type BundleState =
  | { status: 'idle'; bundle: null; error: null }
  | { status: 'loading'; bundle: null; error: null }
  | { status: 'ready'; bundle: SubjectBundle; error: null }
  | { status: 'error'; bundle: null; error: string }
type ResolvedBundleState =
  | { key: string; status: 'ready'; bundle: SubjectBundle; error: null }
  | { key: string; status: 'error'; bundle: null; error: string }

const IDLE: BundleState = { status: 'idle', bundle: null, error: null }

export function useSubjectBundle(subjectId: string | undefined) {
  const { manifest, loadSubjectBundle } = useDataContext()
  const [resolvedState, setResolvedState] = useState<ResolvedBundleState | null>(null)
  const key = subjectId && manifest ? subjectId : null

  useEffect(() => {
    if (!key) return

    const controller = new AbortController()

    void (async () => {
      try {
        const nextBundle = await loadSubjectBundle(key, controller.signal)
        if (!controller.signal.aborted) setResolvedState({ key, status: 'ready', bundle: nextBundle, error: null })
      } catch (nextError) {
        if (!controller.signal.aborted) {
          setResolvedState({
            key,
            status: 'error',
            bundle: null,
            error: nextError instanceof Error ? nextError.message : 'Failed to load subject bundle',
          })
        }
      }
    })()

    return () => {
      controller.abort()
    }
  }, [key, loadSubjectBundle])

  if (!key) {
    return IDLE
  }

  if (!resolvedState || resolvedState.key !== key) {
    return { status: 'loading', bundle: null, error: null } satisfies BundleState
  }

  return resolvedState
}
