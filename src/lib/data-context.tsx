/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsWithChildren } from 'react'
import { loadPublishedManifest, loadPublishedSubjectBundle, refreshPublishedData as refreshData } from './data-client'
import type { SubjectBundle, SubjectManifest } from '../types'

interface DataContextValue {
  manifest: SubjectManifest | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  loadSubjectBundle: (subjectId: string) => Promise<SubjectBundle>
  refreshPublishedData: () => Promise<{ changedSubjectIds: string[]; scraped: boolean }>
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: PropsWithChildren) {
  const [manifest, setManifest] = useState<SubjectManifest | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const inflightBundles = useRef(new Map<string, Promise<SubjectBundle>>())

  useEffect(() => {
    let cancelled = false

    async function boot() {
      setStatus('loading')
      setError(null)

      try {
        const nextManifest = await loadPublishedManifest()

        if (!cancelled) {
          setManifest(nextManifest)
          setStatus('ready')
        }
      } catch (nextError) {
        if (!cancelled) {
          setStatus('error')
          setError(nextError instanceof Error ? nextError.message : 'Failed to load published manifest')
        }
      }
    }

    void boot()

    return () => {
      cancelled = true
    }
  }, [])

  const loadSubjectBundle = useCallback(
    async (subjectId: string) => {
      if (!manifest) {
        throw new Error('Manifest not ready')
      }

      const cachedPromise = inflightBundles.current.get(subjectId)

      if (cachedPromise) {
        return cachedPromise
      }

      const nextPromise = loadPublishedSubjectBundle(manifest, subjectId).finally(() => {
        inflightBundles.current.delete(subjectId)
      })

      inflightBundles.current.set(subjectId, nextPromise)
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
    }),
    [error, loadSubjectBundle, manifest, refreshPublishedData, status],
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
