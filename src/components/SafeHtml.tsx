import DOMPurify from 'dompurify'
import { useEffect, useMemo, useRef } from 'react'
import { typesetMath } from '../lib/mathjax'

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof HTMLImageElement) {
    if (!node.getAttribute('loading')) node.setAttribute('loading', 'lazy')
    if (!node.getAttribute('decoding')) node.setAttribute('decoding', 'async')
  }
  if (node instanceof HTMLAnchorElement && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'

// MathJax 4 dropped <mfenced> (removed from MathML Core). Expand to explicit
// <mrow><mo>open</mo>...<mo>close</mo></mrow> so brackets/parens render.
function expandMfenced(root: ParentNode) {
  const fences = root.querySelectorAll('mfenced')
  fences.forEach((node) => {
    const doc = node.ownerDocument
    if (!doc) return
    const open = node.getAttribute('open') ?? '('
    const close = node.getAttribute('close') ?? ')'
    const sepAttr = node.getAttribute('separators')
    const separators = sepAttr === null ? [','] : Array.from(sepAttr.replace(/\s+/g, ''))
    const children = Array.from(node.childNodes)

    const mrow = doc.createElementNS(MATHML_NS, 'mrow')
    if (open) {
      const o = doc.createElementNS(MATHML_NS, 'mo')
      o.setAttribute('fence', 'true')
      o.textContent = open
      mrow.append(o)
    }
    children.forEach((child, i) => {
      if (i > 0 && separators.length > 0) {
        const sep = separators[Math.min(i - 1, separators.length - 1)]
        if (sep) {
          const s = doc.createElementNS(MATHML_NS, 'mo')
          s.setAttribute('separator', 'true')
          s.textContent = sep
          mrow.append(s)
        }
      }
      mrow.append(child)
    })
    if (close) {
      const c = doc.createElementNS(MATHML_NS, 'mo')
      c.setAttribute('fence', 'true')
      c.textContent = close
      mrow.append(c)
    }
    node.replaceWith(mrow)
  })
}

const FORBID_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'meta', 'link']
const FORBID_ATTR = [
  'onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onfocus', 'onblur',
  'onchange', 'onsubmit', 'onkeydown', 'onkeyup', 'onkeypress', 'onabort', 'oncontextmenu',
  'formaction',
]
const SANITIZE_PROFILES = { html: true, svg: true, svgFilters: true, mathMl: true }

interface SafeHtmlProps {
  html: string
  className?: string
}

export function SafeHtml({ html, className }: SafeHtmlProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sanitizedHtml = useMemo(
    () =>
      DOMPurify.sanitize(html, {
        USE_PROFILES: SANITIZE_PROFILES,
        ADD_ATTR: ['target'],
        FORBID_TAGS,
        FORBID_ATTR,
      }),
    [html],
  )

  useEffect(() => {
    let cancelled = false
    if (containerRef.current) {
      expandMfenced(containerRef.current)
    }
    typesetMath(containerRef.current).finally(() => {
      if (cancelled) return
      // Notify the parent virtualizer that intrinsic size may have changed
      // after async MathJax rendering. ResizeObserver picks up the dispatch
      // implicitly because reflow happens; we also fire a microtask resize
      // event so any custom listeners can react.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('safehtml:typeset'))
      }
    })
    return () => {
      cancelled = true
    }
  }, [sanitizedHtml])

  return <div ref={containerRef} className={className} dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
}
