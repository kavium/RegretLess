import { z } from 'zod'

const RESERVED_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/

function isSafePathId(value: string) {
  return SAFE_ID_PATTERN.test(value) && !RESERVED_PATH_KEYS.has(value)
}

const SafePathIdSchema = z.string().refine(isSafePathId, 'invalid id')
const IsoDatetimeSchema = z.iso.datetime()

export const SubjectIdSchema = SafePathIdSchema
export const QuestionIdSchema = SafePathIdSchema

export const PaperCodeSchema = z.enum(['1A', '1B', '1', '2', '3', 'unknown'])
export const LevelCodeSchema = z.enum(['SL', 'HL'])

export const SubjectManifestEntrySchema = z.object({
  id: SubjectIdSchema,
  name: z.string(),
  bundleUrl: z.string().regex(/^\/data\/subjects\/[A-Za-z0-9_-]+\/index-[a-f0-9]+\.json$/, 'invalid bundleUrl'),
  bundleHash: z.string().regex(/^[a-f0-9]{40}$/, 'invalid bundleHash'),
  questionCount: z.number().int().nonnegative(),
  nodeCount: z.number().int().nonnegative(),
  paperCoverage: z.array(PaperCodeSchema).optional(),
}).refine((entry) => entry.bundleUrl.startsWith(`/data/subjects/${entry.id}/`), 'bundleUrl must match subject id')

export const SubjectManifestSchema = z.object({
  version: IsoDatetimeSchema,
  generatedAt: IsoDatetimeSchema,
  subjects: z.array(SubjectManifestEntrySchema),
})

export const SyllabusNodeSchema = z.object({
  id: SafePathIdSchema,
  label: z.string(),
  depth: z.number().int().nonnegative(),
  kind: z.enum(['umbrella', 'subunit']),
  parentId: SafePathIdSchema.nullable(),
  childIds: z.array(SafePathIdSchema),
  canonicalOrder: z.number().int().nonnegative(),
})

export const QuestionRecordSchema = z.object({
  questionId: QuestionIdSchema,
  referenceCode: z.string(),
  subjectId: SubjectIdSchema,
  title: z.string(),
  paper: PaperCodeSchema,
  level: z.union([LevelCodeSchema, z.literal('AHL'), z.literal('ahl'), z.literal('sl'), z.literal('hl')])
    .transform((v): 'SL' | 'HL' => {
      const upper = v.toUpperCase()
      return upper === 'AHL' ? 'HL' : (upper as 'SL' | 'HL')
    }),
  questionNumber: z.string(),
  marksAvailable: z.string(),
  breadcrumbLabels: z.array(z.string()),
  memberSectionIds: z.array(SafePathIdSchema),
  sectionOrders: z.record(SafePathIdSchema, z.number().int().nonnegative()),
})

export const SubjectBundleSchema = z.object({
  subject: z.object({ id: SubjectIdSchema, name: z.string() }),
  syllabus: z.array(SyllabusNodeSchema),
  sectionQuestionOrder: z.record(SafePathIdSchema, z.array(QuestionIdSchema)),
  questions: z.array(QuestionRecordSchema),
})

export const QuestionDetailSchema = z.object({
  questionId: QuestionIdSchema,
  questionHtml: z.string(),
  markschemeHtml: z.string(),
})
