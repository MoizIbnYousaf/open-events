import {
  PROGRAMME_TIMELINE_FILTERS,
  type ProgrammeTimelineFilter,
} from '../../../application/dtos/programme-timeline.dto'
import { APP_SEARCH_PARAM_KEYS } from '../../lib/search-param-keys'

export interface ProgrammeTimelineSearch {
  readonly category: ProgrammeTimelineFilter
  readonly tour?: '1'
}

export type ProgrammeTimelineSearchInput = Partial<ProgrammeTimelineSearch>

export function parseProgrammeTimelineSearch(value: unknown): ProgrammeTimelineSearch {
  const record =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const candidate = record[APP_SEARCH_PARAM_KEYS.timeline.category]
  const category =
    typeof candidate === 'string' &&
    PROGRAMME_TIMELINE_FILTERS.includes(candidate as ProgrammeTimelineFilter)
      ? (candidate as ProgrammeTimelineFilter)
      : 'all'
  const rawTour = record[APP_SEARCH_PARAM_KEYS.global.tour]
  return {
    category,
    ...(rawTour === '1' || rawTour === 1 || rawTour === true ? { tour: '1' as const } : {}),
  }
}

export const programmeTimelineSearchSchema = {
  types: {
    input: undefined as unknown as ProgrammeTimelineSearchInput,
    output: undefined as unknown as ProgrammeTimelineSearch,
  },
  parse: parseProgrammeTimelineSearch,
}

export function compactProgrammeTimelineSearch(
  search: ProgrammeTimelineSearch,
): ProgrammeTimelineSearchInput {
  return {
    ...(search.category === 'all' ? {} : { category: search.category }),
    ...(search.tour === undefined ? {} : { tour: search.tour }),
  }
}
