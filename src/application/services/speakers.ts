import { assertActorCanMutate, type OrganizerActor } from '../actors'
import type { EventId } from '../../domain/event'
import type { ContactId } from '../../domain/contact'
import { isSpeakerWorkflowStatus } from '../../domain/embed'
import { isValidEmailAddress, normalizeEmail } from '../../domain/invariants/email'
import { ApplicationError, ValidationFailedError } from '../errors'
import type { Clock } from '../ports/clock'
import type { ContactRepository } from '../ports/contact-repository'

/**
 * One person on the programme, as the organizer's roster shows them.
 *
 * `outstandingTaskCount` is derived here rather than left to the screen: "how
 * many do they still owe me" is the question the roster exists to answer, and a
 * surface that subtracts two numbers itself is a surface that can subtract them
 * differently from the next one.
 */
export interface SpeakerRosterEntryDto {
  readonly contactId: ContactId
  readonly email: string
  readonly name: string
  readonly bio: string | null
  readonly proposalCount: number
  readonly sessionCount: number
  readonly taskCount: number
  readonly taskCompletedCount: number
  readonly outstandingTaskCount: number
  readonly hasHeadshot: boolean
  /** True once they have written a bio AND uploaded a headshot. */
  readonly profileComplete: boolean
  readonly jobTitle: string
  readonly company: string
  readonly travelNotes: string
  readonly workflowStatus: string
}

/**
 * The organizer's view of the people on their programme.
 *
 * Every speaker-side surface — the portal, onboarding tasks, the profile
 * editor, headshot and document upload — existed before this did, and an
 * organizer had no screen that listed a single speaker. So the work speakers
 * were doing arrived nowhere: an organizer could not see who had written a bio,
 * who still owed a headshot, or even who was on the programme at all, without
 * reading the submissions list and assembling the people from it by eye.
 *
 * Being on a proposal is what makes someone a speaker of the event. That is
 * already the definition the submissions list and the agenda use, so the roster
 * cannot disagree with them about who exists.
 */
export class SpeakerService {
  readonly #contacts: ContactRepository
  readonly #clock: Clock

  constructor(contacts: ContactRepository, clock: Clock) {
    this.#contacts = contacts
    this.#clock = clock
  }

  async listRoster(
    _actor: OrganizerActor,
    eventId: EventId,
  ): Promise<readonly SpeakerRosterEntryDto[]> {
    const rows = await this.#contacts.listSpeakersByEvent(eventId)
    return rows.map((row) => this.#toEntry(row))
  }

  async addSpeaker(
    actor: OrganizerActor,
    eventId: EventId,
    input: {
      readonly name: string
      readonly email: string
      readonly bio?: string
      readonly jobTitle?: string
      readonly company?: string
      readonly travelNotes?: string
    },
  ): Promise<SpeakerRosterEntryDto> {
    assertActorCanMutate(actor)
    const email = normalizeEmail(input.email)
    if (!isValidEmailAddress(email)) {
      throw new ValidationFailedError('A valid email is required', [])
    }
    const name = input.name.trim()
    if (name.length === 0) {
      throw new ValidationFailedError('A name is required', [])
    }
    const now = this.#clock.now()
    const contact = await this.#contacts.ensureByEmail({
      id: crypto.randomUUID(),
      email,
      name,
      createdAt: now,
    })
    if (input.bio !== undefined || name !== contact.name) {
      await this.#contacts.updateProfile(contact.id, {
        name,
        bio: input.bio === undefined ? (contact.bio ?? null) : input.bio.trim() || null,
      })
    }
    await this.#contacts.upsertSpeakerProfile({
      eventId,
      contactId: contact.id,
      jobTitle: input.jobTitle?.trim() ?? '',
      company: input.company?.trim() ?? '',
      travelNotes: input.travelNotes?.trim() ?? '',
      workflowStatus: 'invited',
      createdAt: now,
      updatedAt: now,
    })
    const roster = await this.#contacts.listSpeakersByEvent(eventId)
    const row = roster.find((person) => person.contactId === contact.id)
    if (row === undefined) {
      throw new ApplicationError('internal', 'Added speaker did not appear on the roster')
    }
    return this.#toEntry(row)
  }

  async importCsv(
    actor: OrganizerActor,
    eventId: EventId,
    csv: string,
  ): Promise<{ readonly imported: number; readonly roster: readonly SpeakerRosterEntryDto[] }> {
    assertActorCanMutate(actor)
    const rows = parseSpeakerCsv(csv)
    for (const row of rows) {
      await this.addSpeaker(actor, eventId, row)
    }
    return { imported: rows.length, roster: await this.listRoster(actor, eventId) }
  }

  async setStatus(
    actor: OrganizerActor,
    eventId: EventId,
    contactId: ContactId,
    status: string,
  ): Promise<SpeakerRosterEntryDto> {
    assertActorCanMutate(actor)
    if (!isSpeakerWorkflowStatus(status)) {
      throw new ValidationFailedError('Unknown speaker status', [])
    }
    const now = this.#clock.now()
    const existing = (await this.#contacts.listSpeakersByEvent(eventId)).find(
      (row) => row.contactId === contactId,
    )
    if (existing === undefined) {
      throw new ApplicationError('not_found', `Speaker '${contactId}' not found`)
    }
    await this.#contacts.upsertSpeakerProfile({
      eventId,
      contactId,
      jobTitle: existing.jobTitle,
      company: existing.company,
      travelNotes: existing.travelNotes,
      workflowStatus: status,
      createdAt: now,
      updatedAt: now,
    })
    const roster = await this.#contacts.listSpeakersByEvent(eventId)
    const row = roster.find((person) => person.contactId === contactId)
    if (row === undefined) {
      throw new ApplicationError('not_found', `Speaker '${contactId}' not found`)
    }
    return this.#toEntry(row)
  }

  async updateOrganizerProfile(
    actor: OrganizerActor,
    eventId: EventId,
    contactId: ContactId,
    input: {
      readonly name?: string
      readonly bio?: string | null
      readonly jobTitle?: string
      readonly company?: string
      readonly travelNotes?: string
    },
  ): Promise<SpeakerRosterEntryDto> {
    assertActorCanMutate(actor)
    const existing = (await this.#contacts.listSpeakersByEvent(eventId)).find(
      (row) => row.contactId === contactId,
    )
    if (existing === undefined) {
      throw new ApplicationError('not_found', `Speaker '${contactId}' not found`)
    }
    const now = this.#clock.now()
    await this.#contacts.updateProfile(contactId, {
      name: input.name?.trim() || existing.name,
      bio: input.bio === undefined ? existing.bio : input.bio,
    })
    await this.#contacts.upsertSpeakerProfile({
      eventId,
      contactId,
      jobTitle: input.jobTitle ?? existing.jobTitle,
      company: input.company ?? existing.company,
      travelNotes: input.travelNotes ?? existing.travelNotes,
      workflowStatus: existing.workflowStatus,
      createdAt: now,
      updatedAt: now,
    })
    const roster = await this.#contacts.listSpeakersByEvent(eventId)
    const row = roster.find((person) => person.contactId === contactId)
    if (row === undefined) {
      throw new ApplicationError('not_found', `Speaker '${contactId}' not found`)
    }
    return this.#toEntry(row)
  }

  #toEntry(row: Awaited<ReturnType<ContactRepository['listSpeakersByEvent']>>[number]) {
    return {
      contactId: row.contactId,
      email: row.email,
      name: row.name,
      bio: row.bio,
      proposalCount: row.proposalCount,
      sessionCount: row.sessionCount,
      taskCount: row.taskCount,
      taskCompletedCount: row.taskCompletedCount,
      outstandingTaskCount: Math.max(0, row.taskCount - row.taskCompletedCount),
      hasHeadshot: row.hasHeadshot,
      profileComplete: row.hasHeadshot && (row.bio ?? '').trim().length > 0,
      jobTitle: row.jobTitle,
      company: row.company,
      travelNotes: row.travelNotes,
      workflowStatus: row.workflowStatus,
    }
  }
}

export function parseSpeakerCsv(
  csv: string,
): readonly { name: string; email: string; bio?: string; jobTitle?: string; company?: string }[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return []
  const header = splitCsvLine(lines[0]!).map((cell) => cell.trim().toLowerCase())
  const indexOf = (aliases: readonly string[]): number =>
    header.findIndex((cell) => aliases.includes(cell))
  const nameIdx = indexOf(['name', 'full name', 'speaker'])
  const emailIdx = indexOf(['email', 'e-mail'])
  const bioIdx = indexOf(['bio', 'biography'])
  const titleIdx = indexOf(['title', 'job title', 'job_title'])
  const companyIdx = indexOf(['company', 'organization', 'org'])
  if (emailIdx < 0) return []
  const rows: { name: string; email: string; bio?: string; jobTitle?: string; company?: string }[] =
    []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const email = cells[emailIdx]?.trim() ?? ''
    if (email.length === 0) continue
    const name =
      nameIdx >= 0
        ? (cells[nameIdx]?.trim() ?? '')
        : email.slice(0, email.indexOf('@') || email.length)
    rows.push({
      name: name.length === 0 ? email : name,
      email,
      bio: bioIdx >= 0 ? cells[bioIdx] : undefined,
      jobTitle: titleIdx >= 0 ? cells[titleIdx] : undefined,
      company: companyIdx >= 0 ? cells[companyIdx] : undefined,
    })
  }
  return rows
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (char === ',' && !quoted) {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  return cells
}
