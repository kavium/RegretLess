import { z } from 'zod'

export const SubjectIdSchema = z.string().regex(/^[\w-]+$/, 'invalid subjectId')

export const PaperCodeSchema = z.enum(['1A', '1B', '1', '2', '3'])
export const LevelCodeSchema = z.enum(['SL', 'HL'])

export const SubjectManifestEntrySchema = z.object({
  id: SubjectIdSchema,
  name: z.string(),
  bundleUrl: z.string(),
  bundleHash: z.string(),
  questionCount: z.number().int().nonnegative(),
  nodeCount: z.number().int().nonnegative(),
  paperCoverage: z.array(PaperCodeSchema).optional(),
})

export const SubjectManifestSchema = z.object({
  version: z.string(),
  generatedAt: z.string(),
  subjects: z.array(SubjectManifestEntrySchema),
})

export const SyllabusNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  depth: z.number().int().nonnegative(),
  kind: z.enum(['umbrella', 'subunit']),
  parentId: z.string().nullable(),
  childIds: z.array(z.string()),
  canonicalOrder: z.number().int().nonnegative(),
})

export const QuestionRecordSchema = z.object({
  questionId: z.string(),
  referenceCode: z.string(),
  subjectId: z.string(),
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
  memberSectionIds: z.array(z.string()),
  sectionOrders: z.record(z.string(), z.number()),
})

export const SubjectBundleSchema = z.object({
  subject: z.object({ id: SubjectIdSchema, name: z.string() }),
  syllabus: z.array(SyllabusNodeSchema),
  sectionQuestionOrder: z.record(z.string(), z.array(z.string())),
  questions: z.array(QuestionRecordSchema),
})

export const QuestionDetailSchema = z.object({
  questionId: z.string(),
  questionHtml: z.string(),
  markschemeHtml: z.string(),
})
