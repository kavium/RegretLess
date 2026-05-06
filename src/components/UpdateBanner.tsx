import { useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { useDataContext } from '../lib/data-context'

export function UpdateBanner() {
  const { updateAvailable } = useDataContext()
  const [dismissed, setDismissed] = useState(false)

  if (!updateAvailable || dismissed) return null

  return (
    <div className="update-banner" role="status">
      <span className="update-banner__msg">A newer version is available.</span>
      <button
        type="button"
        className="update-banner__primary"
        onClick={() => window.location.reload()}
      >
        <RefreshCw size={14} /> Reload
      </button>
      <button
        type="button"
        className="update-banner__dismiss"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        <X size={14} />
      </button>
    </div>
  )
}
