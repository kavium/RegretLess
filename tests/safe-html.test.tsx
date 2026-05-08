import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/mathjax', () => ({
  typesetMath: vi.fn().mockResolvedValue(undefined),
}))

import { SafeHtml } from '../src/components/SafeHtml'

describe('SafeHtml', () => {
  it('keeps MathML markup so equations render', () => {
    const { container } = render(
      <SafeHtml html='<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>' />,
    )
    expect(container.querySelector('math')).not.toBeNull()
  })

  it('expands deprecated MathML mfenced into visible fence operators', () => {
    const { container } = render(
      <SafeHtml html='<math xmlns="http://www.w3.org/1998/Math/MathML"><mfenced><mrow><mi>A</mi><mo>+</mo><mi>B</mi></mrow></mfenced></math>' />,
    )

    expect(container.querySelector('mfenced')).toBeNull()
    expect([...container.querySelectorAll('mo')].map((node) => node.textContent)).toEqual(['(', '+', ')'])
  })

  it('preserves grouped bases when expanding mfenced inside powers', () => {
    const { container } = render(
      <SafeHtml html='<math xmlns="http://www.w3.org/1998/Math/MathML"><msup><mfenced><mrow><mn>3</mn><msup><mi>x</mi><mn>2</mn></msup><mo>-</mo><mfrac><mi>k</mi><mi>x</mi></mfrac></mrow></mfenced><mn>9</mn></msup></math>' />,
    )
    const power = container.querySelector('msup')

    expect(container.querySelector('mfenced')).toBeNull()
    expect(power?.firstElementChild?.tagName.toLowerCase()).toBe('mrow')
    expect([...container.querySelectorAll('mo')].map((node) => node.textContent)).toContain('(')
    expect(power?.lastElementChild?.textContent).toBe('9')
  })

  it('keeps inline SVG diagrams', () => {
    const { container } = render(
      <SafeHtml html='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>' />,
    )
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('circle')).not.toBeNull()
  })

  it('still strips <script> inside SVG to block XSS', () => {
    const { container } = render(
      <SafeHtml html='<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle cx="5" cy="5" r="4"/></svg>' />,
    )
    expect(container.querySelector('script')).toBeNull()
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

  it('keeps safe images and adds lazy-loading attributes', () => {
    const { container } = render(
      <SafeHtml html='<img src="https://example.com/x.png" alt="x">' />,
    )
    const image = container.querySelector('img')
    expect(image?.getAttribute('loading')).toBe('lazy')
    expect(image?.getAttribute('decoding')).toBe('async')
  })
})
