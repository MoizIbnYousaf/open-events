import { z } from 'zod'

import {
  SUBMISSION_DECISION_FILTERS,
  SUBMISSION_SORTS,
  MAX_SUBMISSION_FACETS,
  MAX_SUBMISSION_FACET_TOKEN_LENGTH,
  MAX_SUBMISSION_FACET_VALUES,
  MAX_SUBMISSION_QUERY_LENGTH,
  MAX_SUBMISSION_SELECTED_VALUES,
} from './submission-desk.dto'

export const submissionFacetValuesSchema = z
  .array(z.string().trim().min(1).max(MAX_SUBMISSION_FACET_TOKEN_LENGTH))
  .max(MAX_SUBMISSION_FACET_VALUES)
  .transform((values) =>
    [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en')),
  )

export const submissionFacetSelectionSchema = z.object({
  elementId: z.string().trim().min(1).max(MAX_SUBMISSION_FACET_TOKEN_LENGTH),
  values: submissionFacetValuesSchema,
})

export const submissionFacetSelectionsSchema = z
  .array(submissionFacetSelectionSchema)
  .max(MAX_SUBMISSION_FACETS)
  .refine(
    (selections) =>
      selections.reduce((total, selection) => total + selection.values.length, 0) <=
      MAX_SUBMISSION_SELECTED_VALUES,
    'Too many answer values are selected',
  )
  .transform((selections) => {
    const byElement = new Map<string, string[]>()
    for (const selection of selections) {
      const values = byElement.get(selection.elementId) ?? []
      byElement.set(selection.elementId, [...new Set([...values, ...selection.values])].sort())
    }
    return [...byElement.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([elementId, values]) => ({ elementId, values }))
  })

/** Strict application/server boundary. Missing fields default; malformed fields are rejected. */
export const submissionDeskQuerySchema = z.object({
  q: z.string().trim().max(MAX_SUBMISSION_QUERY_LENGTH).default(''),
  decision: z.enum(SUBMISSION_DECISION_FILTERS).default('all'),
  routing: z
    .string()
    .trim()
    .max(MAX_SUBMISSION_QUERY_LENGTH)
    .default('all')
    .transform((value) => (value === '' ? 'all' : value)),
  sort: z.enum(SUBMISSION_SORTS).default('submitted-desc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  facets: submissionFacetSelectionsSchema.default([]),
})
