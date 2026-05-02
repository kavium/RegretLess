import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { DataProvider } from './lib/data-context'
import { SubjectPickerPage } from './pages/SubjectPickerPage'
import { StudySetupPage } from './pages/StudySetupPage'
import { WorkspacePage } from './pages/WorkspacePage'
import { ResumeModal } from './components/ResumeModal'
import { clearResumeState, getResumeState } from './lib/storage'
import { ensureMathJax } from './lib/mathjax'

const RESUME_URL_PATTERN = /^\/subject\/[\w-]+\/workspace(\?.*)?$/

function isSafeResumeUrl(url: string | undefined | null): url is string {
  return typeof url === 'string' && RESUME_URL_PATTERN.test(url)
}

// Force a fresh WorkspacePage instance per subject so all per-subject state resets cleanly.
function KeyedWorkspace() {
  const { subjectId } = useParams()
  return <WorkspacePage key={subjectId ?? '__none__'} />
}

function AppFrame() {
  const location = useLocation()
  const navigate = useNavigate()
  const [dismissedResumeKey, setDismissedResumeKey] = useState<string | null>(null)

  useEffect(() => {
    void ensureMathJax()
  }, [])

  const onSubjectPicker = location.pathname === '/'
  const cameFromLogo = (location.state as { fromLogo?: boolean } | null)?.fromLogo === true
  const resumeKey = onSubjectPicker && !cameFromLogo ? location.key : null
  const safeSnapshot = useMemo(() => {
    if (!resumeKey) {
      return null
    }
    const nextSnapshot = getResumeState()
    return nextSnapshot && isSafeResumeUrl(nextSnapshot.workspaceUrl) ? nextSnapshot : null
  }, [resumeKey])
  const shouldOfferResume = Boolean(safeSnapshot && resumeKey !== null && dismissedResumeKey !== resumeKey)

  return (
    <div className="app-shell">
      <main className="app-main app-main--bleed">
        <Routes>
          <Route path="/" element={<SubjectPickerPage />} />
          <Route path="/subject/:subjectId" element={<StudySetupPage />} />
          <Route path="/subject/:subjectId/workspace" element={<KeyedWorkspace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {shouldOfferResume && safeSnapshot ? (
        <ResumeModal
          resume={safeSnapshot}
          onDismiss={() => setDismissedResumeKey(resumeKey)}
          onResume={() => {
            setDismissedResumeKey(resumeKey)
            navigate(safeSnapshot.workspaceUrl)
          }}
          onForget={() => {
            clearResumeState()
            setDismissedResumeKey(resumeKey)
          }}
        />
      ) : null}
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <DataProvider>
        <AppFrame />
      </DataProvider>
    </HashRouter>
  )
}
