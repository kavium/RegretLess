import { describe, expect, it, vi } from 'vitest'
import { extractInlineImages, extractMetadataFromReferenceCode, normalizePaper, parseQuestionPage, parseSyllabusPage } from '../scripts/lib/parsers.mjs'

describe('source parsers', () => {
  it('extracts paper and level from reference code fallback', () => {
    expect(extractMetadataFromReferenceCode('EXE.1A.HL.TZ0.1')).toEqual({
      paper: '1A',
      level: 'HL',
    })
  })

  it('warns and returns null fallback when reference code does not match the regex', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = extractMetadataFromReferenceCode('GARBAGE-CODE')
    expect(result).toEqual({ paper: null, level: null })
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('does not warn when reference code is empty (no metadata available)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    extractMetadataFromReferenceCode('')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('parses syllabus rows by indentation depth', () => {
    const nodes = parseSyllabusPage(
      `
      <table class="table">
        <tr><td style="padding-left: 12px;"><a href="syllabus_sections/1.html">A. Mechanics</a></td></tr>
        <tr><td style="padding-left: 32px;"><a href="syllabus_sections/2.html">A.1 Kinematics</a></td></tr>
        <tr><td style="padding-left: 32px;"><a href="syllabus_sections/3.html">A.2 Forces</a></td></tr>
      </table>
      `,
      'https://example.com/syllabus_sections.html',
    )

    expect(nodes.map((node) => ({ id: node.id, depth: node.depth, parentId: node.parentId, kind: node.kind }))).toEqual([
      { id: '1', depth: 0, parentId: null, kind: 'umbrella' },
      { id: '2', depth: 1, parentId: '1', kind: 'subunit' },
      { id: '3', depth: 1, parentId: '1', kind: 'subunit' },
    ])
  })

  it('parses question pages from source markup', () => {
    const result = parseQuestionPage(
      `
      <table class="table table-striped meta_info">
        <tr>
          <td class="info_label">Reference code</td>
          <td class="info_value">EXE.1A.HL.TZ0.1</td>
          <td class="info_label">Paper</td>
          <td class="info_value">1A</td>
        </tr>
        <tr>
          <td class="info_label">Level</td>
          <td class="info_value">HL</td>
          <td class="info_label">Question number</td>
          <td class="info_value">1</td>
        </tr>
      </table>
      <div class="t_qn_question_content">
        <div class="qc_body"><p>Hello</p></div>
      </div>
      <div class="qc_markscheme"><div class="card-body"><p>A</p></div></div>
      <div class="syllabus_section"><div><a href="../syllabus_sections/6106.html">A</a> &raquo; <a href="../syllabus_sections/6108.html">A.2</a></div></div>
      `,
      'https://example.com/question_node_trees/3385020.html',
      'physics',
    )

    expect(result.meta.questionId).toBe('3385020')
    expect(result.meta.referenceCode).toBe('EXE.1A.HL.TZ0.1')
    expect(result.meta.paper).toBe('1A')
    expect(result.meta.level).toBe('HL')
    expect(result.meta.breadcrumbLabels).toEqual(['A', 'A.2'])
    expect(result.detail.questionId).toBe('3385020')
  })

  it('prepends parent stem from .q_resource for sub-part questions', () => {
    const result = parseQuestionPage(
      `
      <div class="t_qnt_container_full">
        <div class="t_qnt_header"><div class="qn_code_number">a.i.</div></div>
        <div class="t_qn_q_resource js-toggle-question">
          <div class="q_resource"><p>Consider <em>f(x) = x^2</em>.</p></div>
        </div>
        <div class="t_qn_question_content">
          <div class="qc_body js-toggle-question"><p>Find f'(2).</p></div>
        </div>
        <div class="qc_markscheme"><div class="card-body"><p>4</p></div></div>
      </div>
      `,
      'https://example.com/question_node_trees/9001.html',
      'math',
    )

    expect(result.detail.questionHtml).toContain('Consider')
    expect(result.detail.questionHtml).toContain("Find f'(2)")
    expect(result.detail.questionHtml.indexOf('Consider')).toBeLessThan(result.detail.questionHtml.indexOf("Find f'(2)"))
    expect(result.detail.questionHtml).toContain('qb-parent-stem')
  })

  it('chains multiple .q_resource blocks in document order for nested sub-parts', () => {
    const result = parseQuestionPage(
      `
      <div class="t_qnt_container_full">
        <div class="t_qn_q_resource"><div class="q_resource"><p>OUTER</p></div></div>
        <div class="t_qn_q_resource"><div class="q_resource"><p>MIDDLE</p></div></div>
        <div class="t_qn_q_resource"><div class="q_resource"><p>INNER</p></div></div>
        <div class="t_qn_question_content">
          <div class="qc_body js-toggle-question"><p>LEAF</p></div>
        </div>
      </div>
      `,
      'https://example.com/question_node_trees/9002.html',
      'math',
    )

    const html = result.detail.questionHtml
    expect(html.indexOf('OUTER')).toBeLessThan(html.indexOf('MIDDLE'))
    expect(html.indexOf('MIDDLE')).toBeLessThan(html.indexOf('INNER'))
    expect(html.indexOf('INNER')).toBeLessThan(html.indexOf('LEAF'))
  })

  it('keeps parent stems that are outside the question container', () => {
    const result = parseQuestionPage(
      `
      <div class="q_resource"><p>ROOT CONTEXT</p></div>
      <div class="t_qnt_container_full">
        <div class="q_resource"><p>PART CONTEXT</p></div>
        <div class="t_qn_question_content">
          <div class="qc_body"><p>LEAF</p></div>
        </div>
      </div>
      `,
      'https://example.com/question_node_trees/9004.html',
      'math',
    )

    const html = result.detail.questionHtml
    expect(html.indexOf('ROOT CONTEXT')).toBeLessThan(html.indexOf('PART CONTEXT'))
    expect(html.indexOf('PART CONTEXT')).toBeLessThan(html.indexOf('LEAF'))
  })

  it('extracts non-base64 <img src> URLs as remote refs', () => {
    const { html, images } = extractInlineImages(
      '<p>see <img src="../images/structure.png" alt="x"></p>',
      'https://example.com/question_node_trees/q1.html',
    )
    expect(images).toHaveLength(1)
    expect(images[0].sourceUrl).toBe('https://example.com/images/structure.png')
    expect(images[0].filename).toMatch(/^[a-f0-9]{40}\.png$/)
    expect(html).toContain(`__IMG__/${images[0].filename}`)
    expect(html).not.toContain('../images/structure.png')
  })

  it('promotes data-src lazy-load attrs to src before extracting', () => {
    const { html, images } = extractInlineImages(
      '<img data-src="/files/spectrum.svg" src="placeholder.gif">',
      'https://example.com/q/1.html',
    )
    expect(images.length).toBeGreaterThan(0)
    expect(html).not.toContain('data-src')
  })

  it('joins multiple .qc_body sub-parts in document order', () => {
    const result = parseQuestionPage(
      `
      <div class="t_qn_question_content">
        <div class="qc_body"><p>PART A</p></div>
        <div class="qc_body"><p>PART B</p></div>
        <div class="qc_body"><p>PART C</p></div>
      </div>
      `,
      'https://example.com/question_node_trees/multi.html',
      'math',
    )
    const html = result.detail.questionHtml
    expect(html).toContain('PART A')
    expect(html).toContain('PART B')
    expect(html).toContain('PART C')
    expect(html.indexOf('PART A')).toBeLessThan(html.indexOf('PART B'))
    expect(html.indexOf('PART B')).toBeLessThan(html.indexOf('PART C'))
  })

  it('joins multiple mark-scheme card-bodies', () => {
    const result = parseQuestionPage(
      `
      <div class="qc_body"><p>Q</p></div>
      <div class="qc_markscheme">
        <div class="card-body"><p>MS-A</p></div>
        <div class="card-body"><p>MS-B</p></div>
      </div>
      `,
      'https://example.com/question_node_trees/ms.html',
      'physics',
    )
    expect(result.detail.markschemeHtml).toContain('MS-A')
    expect(result.detail.markschemeHtml).toContain('MS-B')
  })

  it('does not silently default paper to "2" when reference code and metadata are absent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = parseQuestionPage(
      `<div class="qc_body"><p>orphan</p></div>`,
      'https://example.com/question_node_trees/orphan.html',
      'econ',
    )
    expect(result.meta.paper).toBe('unknown')
    warn.mockRestore()
  })

  it('normalizes free-form Paper metadata strings', () => {
    expect(normalizePaper('Paper 3')).toBe('3')
    expect(normalizePaper('P3')).toBe('3')
    expect(normalizePaper(' 1A ')).toBe('1A')
    expect(normalizePaper('')).toBe(null)
    expect(normalizePaper(null)).toBe(null)
  })

  it('survives metadata rows with odd cell counts', () => {
    const result = parseQuestionPage(
      `
      <table class="meta_info">
        <tr><td class="info_label">Reference code</td><td>EXE.3.HL.TZ0.1</td><td class="dangling">x</td></tr>
        <tr><td class="info_label">Paper</td><td>3</td></tr>
      </table>
      <div class="qc_body"><p>q</p></div>
      `,
      'https://example.com/question_node_trees/odd.html',
      'econ',
    )
    expect(result.meta.paper).toBe('3')
    expect(result.meta.referenceCode).toBe('EXE.3.HL.TZ0.1')
  })

  it('leaves questionHtml unchanged for standalone questions without parent stem', () => {
    const result = parseQuestionPage(
      `
      <div class="t_qnt_container_full">
        <div class="t_qn_question_content">
          <div class="qc_body"><p>What is the charge on an electron?</p></div>
        </div>
      </div>
      `,
      'https://example.com/question_node_trees/9003.html',
      'physics',
    )

    expect(result.detail.questionHtml).not.toContain('qb-parent-stem')
    expect(result.detail.questionHtml).toContain('charge on an electron')
  })
})
