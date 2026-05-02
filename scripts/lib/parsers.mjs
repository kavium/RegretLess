import { createHash } from 'node:crypto'
import * as cheerio from 'cheerio'

function textContent(value) {
  return value.replace(/\s+/g, ' ').trim()
}

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
}

const DATA_URI_PATTERN = /^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/

export function extractInlineImages(html) {
  if (!html) return { html: '', images: [] }
  const images = []
  const seen = new Set()
  const $ = cheerio.load(`<div id="__root__">${html}</div>`, null, false)

  $('#__root__ *').each((_, element) => {
    if (!element.attribs) return

    for (const [attr, rawValue] of Object.entries(element.attribs)) {
      const match = DATA_URI_PATTERN.exec(rawValue)
      if (!match) continue

      const [, mime, data] = match
      const cleanedData = data.replace(/\s+/g, '')
      const ext = MIME_EXT[mime.toLowerCase()] ?? 'bin'
      const hash = createHash('sha1').update(`${ext}:${cleanedData}`).digest('hex')
      const filename = `${hash}.${ext}`
      if (!seen.has(hash)) {
        seen.add(hash)
        images.push({ filename, base64: cleanedData })
      }
      $(element).attr(attr, `__IMG__/${filename}`)
    }
  })

  return { html: $('#__root__').html() ?? '', images }
}

export function normalizeLevel(value) {
  const upper = (value ?? '').toUpperCase()
  return upper === 'AHL' ? 'HL' : upper
}

export function extractMetadataFromReferenceCode(referenceCode) {
  const match = referenceCode.match(/\.((?:1A|1B|1|2|3))\.(AHL|HL|SL|hl|sl|ahl)\./i)

  if (!match) {
    if (referenceCode) {
      console.warn(`[parsers] paper/level regex miss on referenceCode="${referenceCode}", falling back to paper=2 level=HL`)
    }
    return {
      paper: '2',
      level: 'HL',
    }
  }

  return {
    paper: match[1],
    level: normalizeLevel(match[2]),
  }
}

function humanizeSubjectId(id) {
  const trimmed = id.replace(/^\d+-/, '')
  const words = trimmed.split('-').map((word) => {
    if (word.length <= 2) return word.toUpperCase()
    return word.charAt(0).toUpperCase() + word.slice(1)
  })
  let name = words.join(' ')
  name = name.replace(/\bDp\b/g, 'DP')
  name = name.replace(/\bIb\b/g, 'IB')
  name = name.replace(/(\d{4})/, '($1)')
  return name
}

export function parseSubjectLinksFromHtml(html, pageUrl) {
  const $ = cheerio.load(html)
  const subjectLinks = []
  const seen = new Set()
  const baseUrl = pageUrl.endsWith('/') ? pageUrl : `${pageUrl}/`

  $('a').each((_, element) => {
    const href = $(element).attr('href') ?? ''
    if (!href) return

    let resolved
    try {
      resolved = new URL(href, pageUrl).toString()
    } catch {
      return
    }

    const cleanResolved = resolved.split(/[?#]/)[0]
    const folderMatch = cleanResolved.match(/\/questionbanks\/(\d+-[A-Za-z0-9-]+)\/?$/)
    if (!folderMatch) return

    const id = folderMatch[1]
    if (seen.has(id)) return
    seen.add(id)

    subjectLinks.push({
      id,
      name: humanizeSubjectId(id),
      url: new URL(`${id}/syllabus_sections.html`, baseUrl).toString(),
    })
  })

  return subjectLinks
}

export function parseSyllabusPage(html, pageUrl) {
  const $ = cheerio.load(html)
  const rows = []
  const stack = []

  $('table.table tr').each((rowIndex, row) => {
    const link = $(row).find('a').first()
    const href = link.attr('href')
    const label = textContent(link.text())
    const style = $(row).find('td').attr('style') ?? ''

    if (!href || !label) {
      return
    }

    const padding = Number.parseInt(style.match(/padding-left:\s*(\d+)/)?.[1] ?? '12', 10)
    const depth = padding <= 12 ? 0 : padding <= 32 ? 1 : 2
    const id = new URL(href, pageUrl).pathname.split('/').pop().replace(/\.html$/, '')

    while (stack.length > depth) {
      stack.pop()
    }

    const parentId = depth > 0 ? stack[depth - 1] : null
    const node = {
      id,
      label,
      depth,
      kind: 'subunit',
      parentId,
      childIds: [],
      canonicalOrder: rowIndex,
    }

    rows.push(node)

    if (parentId) {
      const parent = rows.find((entry) => entry.id === parentId)

      if (parent) {
        parent.childIds.push(id)
      }
    }

    stack[depth] = id
  })

  for (const row of rows) {
    row.kind = row.childIds.length ? 'umbrella' : 'subunit'
  }

  return rows
}

export function parseSectionPage(html, pageUrl) {
  const $ = cheerio.load(html)
  const questions = []
  const seen = new Set()

  $('a').each((_, element) => {
    const href = $(element).attr('href') ?? ''

    if (!href.includes('../question_node_trees/')) {
      return
    }

    const url = new URL(href, pageUrl).toString()
    const questionId = url.split('/').pop().replace(/\.html$/, '')

    if (seen.has(questionId)) {
      return
    }

    seen.add(questionId)
    questions.push({
      questionId,
      url,
    })
  })

  return questions
}

export function parseQuestionPage(html, pageUrl, subjectId) {
  const $ = cheerio.load(html)
  const metadata = {}

  $('table.meta_info tr').each((_, row) => {
    const cells = $(row).find('td').toArray()

    for (let index = 0; index < cells.length; index += 2) {
      const label = textContent($(cells[index]).text())
      const value = textContent($(cells[index + 1]).text())

      if (label) {
        metadata[label] = value
      }
    }
  })

  const referenceCode = metadata['Reference code'] ?? ''
  const fallback = extractMetadataFromReferenceCode(referenceCode)
  const breadcrumbLabels = []

  $('.syllabus_section a').each((_, element) => {
    const label = textContent($(element).text())
    if (label) {
      breadcrumbLabels.push(label)
    }
  })

  const questionId = pageUrl.split('/').pop().replace(/\.html$/, '')
  const parentStems = []
  $('.t_qnt_container_full .q_resource').each((_, el) => {
    const stemHtml = $(el).html()?.trim()
    if (stemHtml) {
      parentStems.push(`<div class="qb-parent-stem">${stemHtml}</div>`)
    }
  })
  const leafBodyHtml = $('.t_qn_question_content .qc_body').first().html()?.trim() ?? $('.qc_body').first().html()?.trim() ?? ''
  const rawQuestionHtml = parentStems.length
    ? `${parentStems.join('\n')}\n<div class="qb-leaf-prompt">${leafBodyHtml}</div>`
    : leafBodyHtml
  const rawMarkschemeHtml = $('.qc_markscheme .card-body').first().html()?.trim() ?? ''
  const q = extractInlineImages(rawQuestionHtml)
  const m = extractInlineImages(rawMarkschemeHtml)
  const images = [...q.images, ...m.images]
  const questionHtml = q.html
  const markschemeHtml = m.html

  return {
    images,
    meta: {
      questionId,
      referenceCode,
      subjectId,
      title: textContent($('.qc_body').text()).slice(0, 180),
      paper: metadata.Paper || fallback.paper,
      level: normalizeLevel(metadata.Level || fallback.level),
      questionNumber: metadata['Question number'] || '',
      marksAvailable: metadata['Marks available'] || textContent($('.qn_maximum_mark').text()),
      breadcrumbLabels,
      memberSectionIds: [],
      sectionOrders: {},
    },
    detail: {
      questionId,
      questionHtml,
      markschemeHtml,
    },
  }
}
