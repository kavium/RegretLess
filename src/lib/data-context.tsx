/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsWithChildren } from 'react'
import {
  loadPublishedManifest,
  loadPublishedManifestVersion,
  loadPublishedSubjectBundle,
  refreshPublishedData as refreshData,
} from './data-client'
import type { SubjectBundle, SubjectManifest } from '../types'

interface DataContextValue {
  manifest: SubjectManifest | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  loadSubjectBundle: (subjectId: string, signal?: AbortSignal) => Promise<SubjectBundle>
  refreshPublishedData: () => Promise<{ changedSubjectIds: string[]; scraped: boolean }>
  updateAvailable: boolean
}

const VERSION_POLL_INTERVAL_MS = 10 * 60 * 1000

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: PropsWithChildren) {
  const [manifest, setManifest] = useState<SubjectManifest | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const bootVersionRef = useRef<string | null>(null)
  const inflightBundles = useRef(new Map<string, Promise<SubjectBundle>>())

  useEffect(() => {
    const controller = new AbortController()

    async function boot() {
      setStatus('loading')
      setError(null)

      try {
        const nextManifest = await loadPublishedManifest(controller.signal)

        if (!controller.signal.aborted) {
          setManifest(nextManifest)
          setStatus('ready')
          if (!bootVersionRef.current) {
            bootVersionRef.current = nextManifest.version
          }
        }
      } catch (nextError) {
        if (!controller.signal.aborted) {
          setStatus('error')
          setError(nextError instanceof Error ? nextError.message : 'Failed to load published manifest')
        }
      }
    }

    void boot()

    return () => {
      controller.abort()
    }
  }, [])

  // Poll the published manifest periodically. If its `version` changes
  // (a new deploy was published), surface a banner so users running an
  // old tab can reload without us forcing it.
  useEffect(() => {
    if (status !== 'ready' || updateAvailable) return

    let cancelled = false

    const checkVersion = async () => {
      if (cancelled || document.hidden) return
      try {
        const remoteVersion = await loadPublishedManifestVersion()
        if (cancelled) return
        if (remoteVersion && bootVersionRef.current && remoteVersion !== bootVersionRef.current) {
          setUpdateAvailable(true)
        }
      } catch {
        // best-effort; ignore network blips
      }
    }

    const interval = window.setInterval(checkVersion, VERSION_POLL_INTERVAL_MS)
    const onVisibility = () => {
      if (!document.hidden) void checkVersion()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [status, updateAvailable])

  const loadSubjectBundle = useCallback(
    async (subjectId: string, signal?: AbortSignal) => {
      if (!manifest) {
        throw new Error('Manifest not ready')
      }

      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }

      if (!signal) {
        const cachedPromise = inflightBundles.current.get(subjectId)

        if (cachedPromise) {
          return cachedPromise
        }
      }

      const nextPromise = loadPublishedSubjectBundle(manifest, subjectId, signal).finally(() => {
        if (!signal) {
          inflightBundles.current.delete(subjectId)
        }
      })

      if (!signal) {
        inflightBundles.current.set(subjectId, nextPromise)
      }
      return nextPromise
    },
    [manifest],
  )

  const refreshPublishedData = useCallback(
    async () => {
      const result = await refreshData(manifest)
      setManifest(result.manifest)
      setStatus('ready')
      setError(null)
      return { changedSubjectIds: result.changedSubjectIds, scraped: result.scraped }
    },
    [manifest],
  )

  const value = useMemo<DataContextValue>(
    () => ({
      manifest,
      status,
      error,
      loadSubjectBundle,
      refreshPublishedData,
      updateAvailable,
    }),
    [error, loadSubjectBundle, manifest, refreshPublishedData, status, updateAvailable],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useDataContext() {
  const context = useContext(DataContext)

  if (!context) {
    throw new Error('useDataContext must be used inside DataProvider')
  }

  return context
}
