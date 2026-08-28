import type {
  ProgrammeTimelineSearch,
  ProgrammeTimelineSearchInput,
} from '../features/admin/programme-timeline-search'

/** Eager route metadata carries raw search; the lazy page normalizes it. */
export const programmeTimelineSearchValidator = {
  types: {
    input: undefined as unknown as ProgrammeTimelineSearchInput,
    output: undefined as unknown as ProgrammeTimelineSearch,
  },
  parse: (value: unknown) => value as ProgrammeTimelineSearch,
}
