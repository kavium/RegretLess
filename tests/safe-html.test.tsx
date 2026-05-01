import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/mathjax', () => ({
  typesetMath: vi.fn().mockResolvedValue(undefined),
}))

import { SafeHtml } from '../src/components/SafeHtml'

describe('SafeHtml', () => {
  it('preserves MathML markup so equations are not stripped', () => {
    const { container } = render(
      <SafeHtml html='<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>' />,
    )
    expect(container.querySelector('math')).not.toBeNull()
    expect(container.querySelector('mi')?.textContent).toBe('x')
  })

  it('preserves SVG markup for diagram-bearing questions', () => {
    const { container } = render(
      <SafeHtml html='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>' />,
    )
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('circle')).not.toBeNull()
  })

  it('drops <script> tags and inline event handlers', () => {
    const { container } = render(
      <SafeHtml html='<p onclick="alert(1)">hi</p><script>alert(2)</script>' />,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('p')?.getAttribute('onclick')).toBeNull()
  })

  it('forces rel=noopener on target=_blank links', () => {
    const { container } = render(
      <SafeHtml html='<a href="https://example.com" target="_blank">x</a>' />,
    )
    const link = container.querySelector('a')
    expect(link?.getAttribute('rel')).toContain('noopener')
  })
})
