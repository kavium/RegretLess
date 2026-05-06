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
  'image/avif': 'avif',
}

const KNOWN_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'])
const DATA_URI_PATTERN = /^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/
const REMOTE_IMAGE_ATTRS = new Set(['src', 'href', 'xlink:href', 'poster'])
const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-srcset']
const SKIP_SCHEME_PATTERN = /^(?:javascript|mailto|tel|about|blob):/i

function extFromUrl(rawUrl) {
  const cleaned = String(rawUrl).split(/[?#]/)[0]
  const m = cleaned.match(/\.([A-Za-z0-9]+)$/)
  if (!m) return null
  let ext = m[1].toLowerCase()
  if (ext === 'jpeg') ext = 'jpg'
  return KNOWN_IMAGE_EXTS.has(ext) ? ext : null
}

function resolveUrl(rawValue, baseUrl) {
  try {
    return baseUrl ? new URL(rawValue, baseUrl).toString() : new URL(rawValue).toString()
  } catch {
    return null
  }
}

function pickFirstSrcsetUrl(srcset) {
  const first = String(srcset).split(',')[0]?.trim().split(/\s+/)[0]
  return first || null
}

export function extractInlineImages(html, baseUrl = null) {
  if (!html) return { html: '', images: [] }
  const images = []
  const seen = new Set()
  const $ = cheerio.load(`<div id="__root__">${html}</div>`)

  // Pre-pass: promote lazy-load attrs to src so the next pass picks them up.
  $('#__root__ *').each((_, element) => {
    if (!element.attribs) return
    for (const attr of LAZY_SRC_ATTRS) {
      const value = element.attribs[attr]
      if (!value) continue
      if (attr === 'data-srcset') {
        const first = pickFirstSrcsetUrl(value)
        if (first && !element.attribs.src) $(element).attr('src', first)
      } else if (!element.attribs.src) {
        $(element).attr('src', value)
      }
      $(element).removeAttr(attr)
    }
  })

  const recordImage = (image) => {
    if (seen.has(image.filename)) return
    seen.add(image.filename)
    images.push(image)
  }

  $('#__root__ *').each((_, element) => {
    if (!element.attribs) return

    // srcset on <img>/<source>: take first candidate, drop the rest so the
    // browser doesn't try to fetch unresolved external candidates.
    const srcsetValue = element.attribs.srcset
    if (srcsetValue && (element.tagName === 'img' || element.tagName === 'source')) {
      const first = pickFirstSrcsetUrl(srcsetValue)
      if (first) {
        const dataMatch = DATA_URI_PATTERN.exec(first)
        if (!dataMatch) {
          const resolved = resolveUrl(first, baseUrl)
          const ext = resolved ? extFromUrl(resolved) : null
          if (resolved && ext) {
            const url = new URL(resolved)
            if (url.protocol === 'http:' || url.protocol === 'https:') {
              const hash = createHash('sha1').update(`url:${ext}:${resolved}`).digest('hex')
              const filename = `${hash}.${ext}`
              recordImage({ filename, sourceUrl: resolved })
              if (!element.attribs.src) $(element).attr('src', `__IMG__/${filename}`)
            }
          }
        }
      }
      $(element).removeAttr('srcset')
    }

    for (const [attr, rawValue] of Object.entries(element.attribs)) {
      if (!rawValue) continue

      const dataMatch = DATA_URI_PATTERN.exec(rawValue)
      if (dataMatch) {
        const [, mime, data] = dataMatch
        const cleanedData = data.replace(/\s+/g, '')
        const ext = MIME_EXT[mime.toLowerCase()] ?? 'bin'
        const hash = createHash('sha1').update(`${ext}:${cleanedData}`).digest('hex')
        const filename = `${hash}.${ext}`
        recordImage({ filename, base64: cleanedData })
        $(element).attr(attr, `__IMG__/${filename}`)
        continue
      }

      if (!REMOTE_IMAGE_ATTRS.has(attr)) continue
      if (SKIP_SCHEME_PATTERN.test(rawValue)) continue
      if (rawValue.startsWith('#')) continue
      // Already rewritten by an earlier pass (idempotent).
      if (rawValue.startsWith('__IMG__/')) continue

      const resolved = resolveUrl(rawValue, baseUrl)
      if (!resolved) continue
      const url = new URL(resolved)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      const ext = extFromUrl(resolved)
      if (!ext) continue

      const hash = createHash('sha1').update(`url:${ext}:${resolved}`).digest('hex')
      const filename = `${hash}.${ext}`
      recordImage({ filename, sourceUrl: resolved })
      $(element).attr(attr, `__IMG__/${filename}`)
    }
  })

  return { html: $('#__root__').html() ?? '', images }
}

export function normalizeLevel(value) {
  const upper = (value ?? '').toString().toUpperCase()
  return upper === 'AHL' ? 'HL' : upper
}

export function normalizePaper(value) {
  if (value === undefined || value === null) return null
  const trimmed = String(value).trim().toUpperCase()
  if (!trimmed) return null
  const m = trimmed.match(/(?:PAPER\s*|P)?(1A|1B|1|2|3)\b/)
  return m ? m[1] : null
}

export function extractMetadataFromReferenceCode(referenceCode) {
  const match = String(referenceCode ?? '').match(/\.((?:1A|1B|1|2|3))\.(AHL|HL|SL)\./i)

  if (!match) {
    if (referenceCode) {
      console.warn(`[parsers] paper/level regex miss on referenceCode="${referenceCode}"`)
    }
    return { paper: null, level: null }
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

function collectAllHtml($, selector) {
  const parts = []
  $(selector).each((_, el) => {
    const html = $(el).html()?.trim()
    if (html) parts.push(html)
  })
  return parts
}

function joinParts(parts, partClass) {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return parts
    .map((html, index) => `<div class="${partClass}" data-part="${index}">${html}</div>`)
    .join('\n')
}

function smartTitleSlice(text, maxLength = 180) {
  if (text.length <= maxLength) return text
  // Avoid cutting inside a $...$ LaTeX expression: walk back to a space.
  let cut = text.slice(0, maxLength)
  const dollarCount = (cut.match(/\$/g) ?? []).length
  if (dollarCount % 2 === 1) {
    const lastDollar = cut.lastIndexOf('$')
    if (lastDollar > 0) cut = cut.slice(0, lastDollar).trimEnd()
  }
  const lastSpace = cut.lastIndexOf(' ')
  if (lastSpace > maxLength - 40) cut = cut.slice(0, lastSpace)
  return `${cut.trimEnd()}…`
}

export function parseQuestionPage(html, pageUrl, subjectId) {
  const $ = cheerio.load(html)
  const metadata = {}

  $('table.meta_info tr').each((_, row) => {
    const cells = $(row).find('td').toArray()

    for (let index = 0; index + 1 < cells.length; index += 2) {
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

  // A2: collect EVERY .qc_body, not just the first — multi-part questions
  // (e.g. Math AA a/b/c) live in sibling .qc_body divs.
  let leafBodyParts = collectAllHtml($, '.t_qn_question_content .qc_body')
  if (leafBodyParts.length === 0) {
    leafBodyParts = collectAllHtml($, '.qc_body')
  }
  const leafBodyHtml = joinParts(leafBodyParts, 'qb-leaf-part')
  const rawQuestionHtml = parentStems.length
    ? `${parentStems.join('\n')}\n<div class="qb-leaf-prompt">${leafBodyHtml}</div>`
    : leafBodyHtml

  // A2: same for mark scheme — collect every .card-body inside .qc_markscheme.
  const msParts = collectAllHtml($, '.qc_markscheme .card-body')
  const rawMarkschemeHtml = joinParts(msParts, 'qb-ms-part')

  const q = extractInlineImages(rawQuestionHtml, pageUrl)
  const m = extractInlineImages(rawMarkschemeHtml, pageUrl)
  const images = [...q.images, ...m.images]
  const questionHtml = q.html
  const markschemeHtml = m.html

  // A3+A4: prefer table value, then reference-code regex, then 'unknown'.
  // Never silently default to '2'.
  const paperFromTable = normalizePaper(metadata.Paper)
  const resolvedPaper = paperFromTable ?? fallback.paper ?? 'unknown'
  const resolvedLevel = normalizeLevel(metadata.Level || fallback.level || '') || 'HL'

  return {
    images,
    meta: {
      questionId,
      referenceCode,
      subjectId,
      title: smartTitleSlice(textContent($('.qc_body').text()), 180),
      paper: resolvedPaper,
      level: resolvedLevel,
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
