import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
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
  const [resumeDismissed, setResumeDismissed] = useState(false)
  const [resumeSnapshot, setResumeSnapshot] = useState(() => getResumeState())
  const [lastResumeKey, setLastResumeKey] = useState<string | null>(null)

  useEffect(() => {
    void ensureMathJax()
  }, [])

  const onSubjectPicker = location.pathname === '/'
  const cameFromLogo = (location.state as { fromLogo?: boolean } | null)?.fromLogo === true

  // Refresh snapshot + reset dismissed flag whenever we re-enter the picker via a non-logo nav.
  // setState-during-render with a guard is React's recommended pattern for "reset on key change".
  if (onSubjectPicker && !cameFromLogo && lastResumeKey !== location.key) {
    setLastResumeKey(location.key)
    setResumeSnapshot(getResumeState())
    setResumeDismissed(false)
  }

  const safeSnapshot = resumeSnapshot && isSafeResumeUrl(resumeSnapshot.workspaceUrl) ? resumeSnapshot : null
  const shouldOfferResume = Boolean(safeSnapshot && !resumeDismissed && onSubjectPicker && !cameFromLogo)

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
          onDismiss={() => setResumeDismissed(true)}
          onResume={() => {
            setResumeDismissed(true)
            navigate(safeSnapshot.workspaceUrl)
          }}
          onForget={() => {
            clearResumeState()
            setResumeSnapshot(null)
            setResumeDismissed(true)
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
