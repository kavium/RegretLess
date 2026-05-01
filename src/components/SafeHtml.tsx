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

const FORBID_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'meta', 'link']
const FORBID_ATTR = [
  'onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onfocus', 'onblur',
  'onchange', 'onsubmit', 'onkeydown', 'onkeyup', 'onkeypress', 'onabort', 'oncontextmenu',
  'formaction',
]

interface SafeHtmlProps {
  html: string
  className?: string
}

export function SafeHtml({ html, className }: SafeHtmlProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sanitizedHtml = useMemo(
    () =>
      DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
        ADD_ATTR: ['target'],
        FORBID_TAGS,
        FORBID_ATTR,
      }),
    [html],
  )

  useEffect(() => {
    void typesetMath(containerRef.current)
  }, [sanitizedHtml])

  return <div ref={containerRef} className={className} dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
}
