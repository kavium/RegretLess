import { describe, expect, it, vi } from 'vitest'
import { extractMetadataFromReferenceCode, parseQuestionPage, parseSyllabusPage } from '../scripts/lib/parsers.mjs'

describe('source parsers', () => {
  it('extracts paper and level from reference code fallback', () => {
    expect(extractMetadataFromReferenceCode('EXE.1A.HL.TZ0.1')).toEqual({
      paper: '1A',
      level: 'HL',
    })
  })

  it('warns when reference code does not match the regex', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = extractMetadataFromReferenceCode('GARBAGE-CODE')
    expect(result).toEqual({ paper: '2', level: 'HL' })
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
