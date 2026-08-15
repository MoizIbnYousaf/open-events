import {
  companyFromAnswers,
  jobTitleFromAnswers,
  looksLikeEmail,
  publicSessionFacets,
  surnameSortKey,
  type FormVersionContent,
  type ProposalSubmission,
} from '../../domain'
import type { AgendaSessionRecord } from '../ports/agenda-repository'
import type { ContactRepository } from '../ports/contact-repository'
import type { FormContentRepository } from '../ports/form-content-repository'
import type { ProgrammeRepository } from '../ports/programme-repository'
import { publicSessionCopy } from '../../domain/session-content'

export interface PublicSpeakerCard {
  readonly name: string
  readonly jobTitle: string
  readonly company: string
}

export interface PublicSessionView {
  readonly submissionId: string
  readonly title: string
  readonly speakers: readonly string[]
  readonly speakerCards: readonly PublicSpeakerCard[]
  readonly track: string
  readonly room: string
  readonly day: string
  readonly start: string
  readonly end: string
  readonly position: number | null
  readonly format: string
  readonly description: string
}

export interface PublicSpeakerView {
  readonly id: string
  readonly name: string
  readonly jobTitle: string
  readonly company: string
  readonly bio: string
  readonly hasHeadshot: boolean
  readonly photoUrl: string | null
  readonly sessions: readonly {
    readonly submissionId: string
    readonly title: string
    readonly day: string
    readonly start: string
    readonly end: string
    readonly room: string
  }[]
}

export function isPubliclyVisible(
  session: AgendaSessionRecord,
  rejected: ReadonlySet<string>,
  contentStatus: ReadonlyMap<string, string>,
  approvedSnapshots: ReadonlySet<string> = new Set(),
): boolean {
  if (session.status !== 'published') return false
  if (rejected.has(session.submissionId)) return false
  const status = contentStatus.get(session.submissionId) ?? 'approved'
  return publicSessionCopy({
    contentStatus: status,
    liveTitle: '',
    liveAbstract: '',
    lastApproved: approvedSnapshots.has(session.submissionId) ? { title: '', abstract: '' } : null,
  }).visible
}

export async function loadContentByVersion(
  content: FormContentRepository,
  submissions: readonly ProposalSubmission[],
): Promise<Map<string, FormVersionContent>> {
  const ids = [...new Set(submissions.map((submission) => submission.formVersionId))]
  const loaded = await Promise.all(
    ids.map(async (versionId) => {
      const eventId = submissions.find(
        (submission) => submission.formVersionId === versionId,
      )?.eventId
      if (eventId === undefined) return null
      return [versionId, await content.loadByVersion(eventId, versionId)] as const
    }),
  )
  const map = new Map<string, FormVersionContent>()
  for (const entry of loaded) {
    if (entry !== null) map.set(entry[0], entry[1])
  }
  return map
}

export async function toPublicSessions(input: {
  readonly sessions: readonly AgendaSessionRecord[]
  readonly submissions: readonly ProposalSubmission[]
  readonly rejected: ReadonlySet<string>
  readonly contentStatus: ReadonlyMap<string, string>
  readonly approvedSnapshots?: ReadonlySet<string>
  readonly approvedCopy?: ReadonlyMap<string, { readonly title: string; readonly abstract: string }>
  readonly labelByTaxonomyId: ReadonlyMap<string, string>
  readonly contacts: ContactRepository
  readonly formContent: FormContentRepository
  readonly profiles: ProgrammeRepository
}): Promise<readonly PublicSessionView[]> {
  const snapshots = input.approvedSnapshots ?? new Set<string>()
  const visible = input.sessions.filter((session) =>
    isPubliclyVisible(session, input.rejected, input.contentStatus, snapshots),
  )
  const submissionById = new Map(input.submissions.map((submission) => [submission.id, submission]))
  const definitions = await loadContentByVersion(
    input.formContent,
    visible.flatMap((session) => {
      const submission = submissionById.get(session.submissionId)
      return submission === undefined ? [] : [submission]
    }),
  )
  const speakerIds = new Set<string>()
  for (const session of visible) {
    for (const speakerId of session.speakerIds) speakerIds.add(speakerId)
  }
  const cardById = new Map<string, PublicSpeakerCard>()
  for (const speakerId of speakerIds) {
    const contact = await input.contacts.findById(speakerId)
    const name = contact?.name.trim() ?? ''
    if (name === '' || looksLikeEmail(name)) continue
    const eventId = visible[0]?.eventId
    const profile =
      eventId === undefined ? null : await input.profiles.findSpeakerProfile(eventId, speakerId)
    const own = input.submissions.find((submission) => submission.ownerContactId === speakerId)
    cardById.set(speakerId, {
      name,
      jobTitle: profile?.jobTitle || (own === undefined ? '' : jobTitleFromAnswers(own.answers)),
      company: profile?.company || (own === undefined ? '' : companyFromAnswers(own.answers)),
    })
  }
  return visible.map((session) => {
    const submission = submissionById.get(session.submissionId)
    const facets =
      submission === undefined
        ? { format: '', description: '' }
        : publicSessionFacets(
            definitions.get(submission.formVersionId) ?? {
              pages: [],
              elements: [],
              conditionRules: [],
              routingRules: [],
            },
            submission.answers,
          )
    const speakerCards = session.speakerIds.flatMap((speakerId) => {
      const card = cardById.get(speakerId)
      return card === undefined ? [] : [card]
    })
    const status = input.contentStatus.get(session.submissionId) ?? 'approved'
    const copy = publicSessionCopy({
      contentStatus: status,
      liveTitle: submission?.title ?? '',
      liveAbstract: facets.description,
      lastApproved: input.approvedCopy?.get(session.submissionId) ?? null,
    })
    return {
      submissionId: session.submissionId,
      title: copy.title,
      speakers: speakerCards.map((card) => card.name),
      speakerCards,
      track: session.trackId === null ? '' : (input.labelByTaxonomyId.get(session.trackId) ?? ''),
      room: session.roomId === null ? '' : (input.labelByTaxonomyId.get(session.roomId) ?? ''),
      day: session.day,
      start: session.start,
      end: session.end,
      position: session.position,
      format: facets.format,
      description: copy.abstract,
    }
  })
}

export function applySessionCardsToPeople<
  T extends { readonly name: string; readonly jobTitle: string; readonly company: string },
>(people: readonly T[], sessions: readonly PublicSessionView[]): readonly T[] {
  const cardByName = new Map<string, PublicSpeakerCard>()
  for (const session of sessions) {
    for (const card of session.speakerCards) {
      cardByName.set(card.name, card)
    }
  }
  return people.map((person) => {
    const card = cardByName.get(person.name)
    if (card === undefined) return person
    return {
      ...person,
      jobTitle: person.jobTitle || card.jobTitle,
      company: person.company || card.company,
    }
  })
}

export function toPublicSpeakers(
  sessions: readonly PublicSessionView[],
  people: readonly {
    readonly id: string
    readonly name: string
    readonly bio: string
    readonly hasHeadshot: boolean
    readonly jobTitle: string
    readonly company: string
  }[],
  eventSlug: string,
): readonly PublicSpeakerView[] {
  const visibleNames = new Set(sessions.flatMap((session) => session.speakers))
  const listed = people.filter(
    (person) => person.name !== '' && !looksLikeEmail(person.name) && visibleNames.has(person.name),
  )
  const sorted = listed.toSorted((left, right) => {
    const key = surnameSortKey(left.name).localeCompare(surnameSortKey(right.name), 'en')
    return key !== 0 ? key : left.name.localeCompare(right.name, 'en')
  })
  return sorted.map((person) => {
    const personSessions = []
    for (const session of sessions) {
      if (!session.speakers.includes(person.name)) continue
      personSessions.push({
        submissionId: session.submissionId,
        title: session.title,
        day: session.day,
        start: session.start,
        end: session.end,
        room: session.room,
      })
    }
    return {
      id: person.id,
      name: person.name,
      jobTitle: person.jobTitle,
      company: person.company,
      bio: person.bio,
      hasHeadshot: person.hasHeadshot,
      photoUrl: person.hasHeadshot
        ? `/api/public/events/${eventSlug}/speakers/${person.id}/headshot`
        : null,
      sessions: personSessions,
    }
  })
}
