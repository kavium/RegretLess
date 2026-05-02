declare global {
  interface Window {
    MathJax?: {
      typesetPromise?: (elements?: HTMLElement[]) => Promise<void>
    }
  }
}

let scriptPromise: Promise<void> | null = null
let warnedTypesetFailure = false

export function ensureMathJax() {
  if (window.MathJax?.typesetPromise) {
    return Promise.resolve()
  }

  if (scriptPromise) {
    return scriptPromise
  }

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-mathjax="qol-ib-qb"]')

    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('MathJax failed to load')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/mathjax/4.0.0/startup.min.js'
    script.async = true
    script.crossOrigin = 'anonymous'
    script.integrity = 'sha384-onusZe+xjPdfrdrEOOcBMVfoPckiYOimqTl8PEAc+amSKhjfhLLL1M8cZGM944Tf'
    script.dataset.mathjax = 'qol-ib-qb'
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('MathJax failed to load')), { once: true })
    document.head.append(script)
  })

  scriptPromise = scriptPromise.catch((error) => {
    scriptPromise = null
    throw error
  })

  return scriptPromise
}

export async function typesetMath(container: HTMLElement | null) {
  if (!container) {
    return
  }

  try {
    await ensureMathJax()

    if (window.MathJax?.typesetPromise) {
      await window.MathJax.typesetPromise([container])
    }
  } catch (error) {
    if (!warnedTypesetFailure) {
      warnedTypesetFailure = true
      console.warn(error instanceof Error ? error.message : 'MathJax failed to typeset')
    }
  }
}
