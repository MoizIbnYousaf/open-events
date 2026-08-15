import type { SpeakerRosterRow } from '../../../src/application/ports/contact-repository'
import type {
  AnswerMap,
  CapturedMessage,
  CfpForm,
  ConfirmationRecord,
  Contact,
  Event,
  FormId,
  FormVersion,
  FormVersionContent,
  ProposalDraft,
  ProposalSubmission,
  Session,
  SubmissionContributor,
  SubmissionDecision,
  SubmissionDecisionOutcome,
  SubmitterToken,
  TaxonomyItem,
  TokenHash,
  SessionContentStatus,
  VersionId,
} from '../../../src/domain'
import type {
  AgendaRepository,
  AgendaSessionRecord,
  CapturedMessageRepository,
  ConfirmationRepository,
  ContactRepository,
  DraftRepository,
  EventConfigRepository,
  FormContentRepository,
  FormRepository,
  FormVersionRepository,
  SessionRepository,
  SubmissionRepository,
  ObjectStoragePort,
  ProgrammeRepository,
  StoredObject,
  TaxonomyRepository,
  TokenRepository,
  UploadedFileKind,
  UploadedFileRecord,
  UploadedFileRepository,
} from '../../../src/application'

export class InMemoryEventRepository implements EventConfigRepository {
  readonly #events = new Map<string, Event>()

  constructor(events: readonly Event[] = []) {
    for (const event of events) this.#events.set(event.id, event)
  }

  async findById(id: string): Promise<Event | null> {
    return this.#events.get(id) ?? null
  }

  async findBySlug(slug: string): Promise<Event | null> {
    for (const event of this.#events.values()) {
      if (event.slug === slug) return event
    }
    return null
  }

  async list(): Promise<readonly Event[]> {
    return [...this.#events.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  async save(event: Event): Promise<void> {
    this.#events.set(event.id, event)
  }
}

export class InMemoryFormRepository implements FormRepository {
  readonly #forms = new Map<FormId, CfpForm>()

  constructor(forms: readonly CfpForm[] = []) {
    for (const form of forms) this.#forms.set(form.id, form)
  }

  async findById(id: FormId): Promise<CfpForm | null> {
    return this.#forms.get(id) ?? null
  }

  async findByEventAndSlug(eventId: string, slug: string): Promise<CfpForm | null> {
    for (const form of this.#forms.values()) {
      if (form.eventId === eventId && form.slug === slug) return form
    }
    return null
  }

  async listByEvent(eventId: string): Promise<readonly CfpForm[]> {
    return [...this.#forms.values()].filter((form) => form.eventId === eventId)
  }

  /** Mirrors the adapter: scoped by BOTH event and form id, never by id alone. */
  async updateWindow(input: {
    readonly eventId: string
    readonly formId: FormId
    readonly opensAt: string | null
    readonly closesAt: string | null
  }): Promise<'updated' | 'not-found'> {
    const form = this.#forms.get(input.formId)
    if (form === undefined || form.eventId !== input.eventId) return 'not-found'
    this.#forms.set(input.formId, {
      ...form,
      limits: { ...form.limits, opensAt: input.opensAt, closesAt: input.closesAt },
    })
    return 'updated'
  }

  async save(form: CfpForm): Promise<void> {
    this.#forms.set(form.id, form)
  }

  list(): readonly CfpForm[] {
    return [...this.#forms.values()]
  }
}

export class InMemoryFormVersionRepository implements FormVersionRepository {
  readonly #versions = new Map<VersionId, FormVersion>()

  constructor(versions: readonly FormVersion[] = []) {
    for (const version of versions) this.#versions.set(version.id, version)
  }

  async findById(id: VersionId): Promise<FormVersion | null> {
    return this.#versions.get(id) ?? null
  }

  async listByForm(formId: FormId): Promise<readonly FormVersion[]> {
    return [...this.#versions.values()]
      .filter((version) => version.formId === formId)
      .sort((a, b) => a.version - b.version)
  }

  async findLatestDraftByForm(formId: FormId): Promise<FormVersion | null> {
    const drafts = (await this.listByForm(formId)).filter((version) => version.status === 'draft')
    return drafts.at(-1) ?? null
  }

  async findLatestPublishedByForm(formId: FormId): Promise<FormVersion | null> {
    const published = (await this.listByForm(formId)).filter(
      (version) => version.status === 'published',
    )
    return published.at(-1) ?? null
  }

  async findByFormAndVersion(formId: FormId, version: number): Promise<FormVersion | null> {
    for (const candidate of await this.listByForm(formId)) {
      if (candidate.version === version) return candidate
    }
    return null
  }

  async save(version: FormVersion): Promise<void> {
    this.#versions.set(version.id, version)
  }

  list(): readonly FormVersion[] {
    return [...this.#versions.values()]
  }
}

export class InMemoryFormContentRepository implements FormContentRepository {
  readonly #content = new Map<string, FormVersionContent>()

  constructor(entries: ReadonlyArray<readonly [string, string, FormVersionContent]> = []) {
    for (const [eventId, versionId, content] of entries) {
      this.#content.set(key(eventId, versionId), content)
    }
  }

  async loadByVersion(eventId: string, versionId: VersionId): Promise<FormVersionContent> {
    return this.#content.get(key(eventId, versionId)) ?? emptyContent()
  }

  async saveForVersion(
    eventId: string,
    versionId: VersionId,
    content: FormVersionContent,
  ): Promise<void> {
    this.#content.set(key(eventId, versionId), content)
  }
}

export class InMemoryTaxonomyRepository implements TaxonomyRepository {
  readonly #items = new Map<string, TaxonomyItem[]>()

  constructor(itemsByEvent: ReadonlyArray<readonly [string, readonly TaxonomyItem[]]> = []) {
    for (const [eventId, items] of itemsByEvent) this.#items.set(eventId, [...items])
  }

  async listByEvent(eventId: string): Promise<readonly TaxonomyItem[]> {
    return this.#items.get(eventId) ?? []
  }

  async replaceForEvent(eventId: string, items: readonly TaxonomyItem[]): Promise<void> {
    this.#items.set(eventId, [...items])
  }
}

/**
 * In-memory twin of the D1 agenda adapter. It reproduces the two rules the
 * migration enforces — one session per submission, and one session per
 * (event, room, day, start, end, position) once a room and position exist —
 * plus the adapter's deterministic read order, so the agenda service contract
 * is adapter-independent.
 */
export class InMemoryAgendaRepository implements AgendaRepository {
  readonly #sessions = new Map<string, AgendaSessionRecord>()

  constructor(sessions: readonly AgendaSessionRecord[] = []) {
    for (const session of sessions) this.#sessions.set(session.submissionId, session)
  }

  async listByEvent(eventId: string): Promise<readonly AgendaSessionRecord[]> {
    return [...this.#sessions.values()]
      .filter((session) => session.eventId === eventId)
      .sort(
        (left, right) =>
          left.day.localeCompare(right.day) ||
          left.start.localeCompare(right.start) ||
          nullsFirst(left.position, right.position) ||
          nullsFirst(left.roomId, right.roomId) ||
          left.submissionId.localeCompare(right.submissionId),
      )
  }

  async findBySubmission(
    eventId: string,
    submissionId: string,
  ): Promise<AgendaSessionRecord | null> {
    const session = this.#sessions.get(submissionId)
    return session !== undefined && session.eventId === eventId ? session : null
  }

  async saveSession(session: AgendaSessionRecord): Promise<void> {
    if (session.roomId !== null && session.position !== null) {
      for (const stored of this.#sessions.values()) {
        if (stored.submissionId === session.submissionId) continue
        if (
          stored.eventId === session.eventId &&
          stored.roomId === session.roomId &&
          stored.day === session.day &&
          stored.start === session.start &&
          stored.end === session.end &&
          stored.position === session.position
        ) {
          throw new Error('agenda_sessions room/slot/position uniqueness violated')
        }
      }
    }
    this.#sessions.set(session.submissionId, { ...session, speakerIds: [...session.speakerIds] })
  }

  list(): readonly AgendaSessionRecord[] {
    return [...this.#sessions.values()]
  }
}

export class InMemoryDraftRepository implements DraftRepository {
  readonly #drafts = new Map<string, ProposalDraft>()

  constructor(drafts: readonly ProposalDraft[] = []) {
    for (const draft of drafts) this.#drafts.set(draft.id, draft)
  }

  async findById(id: string): Promise<ProposalDraft | null> {
    return this.#drafts.get(id) ?? null
  }

  async listByOwner(eventId: string, ownerContactId: string): Promise<readonly ProposalDraft[]> {
    return [...this.#drafts.values()].filter(
      (draft) => draft.eventId === eventId && draft.ownerContactId === ownerContactId,
    )
  }

  async save(draft: ProposalDraft, expectedUpdatedAt: string | null): Promise<boolean> {
    const existing = this.#drafts.get(draft.id)
    if (expectedUpdatedAt === null) {
      if (existing !== undefined) return false
      this.#drafts.set(draft.id, draft)
      return true
    }
    if (existing === undefined || existing.updatedAt !== expectedUpdatedAt) return false
    this.#drafts.set(draft.id, draft)
    return true
  }

  async deleteById(eventId: string, id: string): Promise<void> {
    const existing = this.#drafts.get(id)
    if (existing?.eventId === eventId) this.#drafts.delete(id)
  }

  list(): readonly ProposalDraft[] {
    return [...this.#drafts.values()]
  }
}

export class InMemorySubmissionRepository implements SubmissionRepository {
  readonly #submissions = new Map<string, ProposalSubmission>()
  readonly #contributors: SubmissionContributor[] = []
  readonly #decisions: SubmissionDecision[] = []
  readonly #versions: FormVersionRepository

  /**
   * `decisions` seeds the append-only trail directly, because a decision is now
   * a precondition of several reads and building one through `recordDecision`
   * would make every harness async for a fixture. Pass them in trail order.
   */
  constructor(
    versions: FormVersionRepository,
    submissions: readonly ProposalSubmission[] = [],
    decisions: readonly SubmissionDecision[] = [],
  ) {
    this.#versions = versions
    for (const submission of submissions) this.#submissions.set(submission.id, submission)
    this.#decisions.push(...decisions)
  }

  async findById(id: string): Promise<ProposalSubmission | null> {
    return this.#submissions.get(id) ?? null
  }

  async findByOriginDraftId(originDraftId: string): Promise<ProposalSubmission | null> {
    for (const submission of this.#submissions.values()) {
      if (submission.originDraftId === originDraftId) return submission
    }
    return null
  }

  async listByEvent(eventId: string): Promise<readonly ProposalSubmission[]> {
    return [...this.#submissions.values()].filter((submission) => submission.eventId === eventId)
  }

  async listByOwner(
    eventId: string,
    ownerContactId: string,
  ): Promise<readonly ProposalSubmission[]> {
    return [...this.#submissions.values()]
      .filter(
        (submission) =>
          submission.eventId === eventId && submission.ownerContactId === ownerContactId,
      )
      .sort((left, right) =>
        left.submittedAt === right.submittedAt
          ? left.id.localeCompare(right.id)
          : right.submittedAt.localeCompare(left.submittedAt),
      )
  }

  /** Mirrors the adapter: event + id + owner all decide the match. */
  async updateOwnContent(input: {
    readonly eventId: string
    readonly submissionId: string
    readonly ownerContactId: string
    readonly title: string
    readonly answers: AnswerMap
  }): Promise<'updated' | 'not-found'> {
    const submission = this.#submissions.get(input.submissionId)
    if (
      submission === undefined ||
      submission.eventId !== input.eventId ||
      submission.ownerContactId !== input.ownerContactId
    ) {
      return 'not-found'
    }
    this.#submissions.set(input.submissionId, {
      ...submission,
      title: input.title,
      answers: input.answers,
    })
    return 'updated'
  }

  async updateContent(input: {
    readonly eventId: string
    readonly submissionId: string
    readonly title: string
    readonly answers: AnswerMap
  }): Promise<'updated' | 'not-found'> {
    const submission = this.#submissions.get(input.submissionId)
    if (submission === undefined || submission.eventId !== input.eventId) return 'not-found'
    this.#submissions.set(input.submissionId, {
      ...submission,
      title: input.title,
      answers: input.answers,
    })
    return 'updated'
  }

  /** Mirrors the adapter: the STANDING verdict is the highest sequence. */
  async findDecision(eventId: string, submissionId: string): Promise<SubmissionDecision | null> {
    const trail = await this.listDecisionHistory(eventId, submissionId)
    return trail.at(-1) ?? null
  }

  async listDecisionHistory(
    eventId: string,
    submissionId: string,
  ): Promise<readonly SubmissionDecision[]> {
    return this.#decisions
      .filter((decision) => decision.eventId === eventId && decision.submissionId === submissionId)
      .sort((left, right) => left.sequence - right.sequence)
  }

  async listDecisionsByOwner(
    eventId: string,
    ownerContactId: string,
  ): Promise<readonly SubmissionDecision[]> {
    const standing = await this.listDecisionsByEvent(eventId)
    return standing.filter(
      (decision) => this.#submissions.get(decision.submissionId)?.ownerContactId === ownerContactId,
    )
  }

  async listDecisionsByEvent(eventId: string): Promise<readonly SubmissionDecision[]> {
    const latest = new Map<string, SubmissionDecision>()
    for (const decision of this.#decisions) {
      if (decision.eventId !== eventId) continue
      const standing = latest.get(decision.submissionId)
      if (standing === undefined || decision.sequence > standing.sequence) {
        latest.set(decision.submissionId, decision)
      }
    }
    return [...latest.values()]
  }

  /**
   * Mirrors the adapter: the event scope decides whether anything is written,
   * and a verdict is APPENDED with the next sequence rather than replacing the
   * one before it.
   */
  async recordDecision(input: {
    readonly id: string
    readonly eventId: string
    readonly submissionId: string
    readonly outcome: SubmissionDecisionOutcome
    readonly decidedBy: string
    readonly decidedAt: string
  }): Promise<'recorded' | 'not-found'> {
    const submission = this.#submissions.get(input.submissionId)
    if (submission === undefined || submission.eventId !== input.eventId) return 'not-found'
    const trail = await this.listDecisionHistory(input.eventId, input.submissionId)
    this.#decisions.push({ ...input, sequence: (trail.at(-1)?.sequence ?? 0) + 1 })
    return 'recorded'
  }

  async countByForm(eventId: string, formId: FormId): Promise<number> {
    let count = 0
    for (const submission of this.#submissions.values()) {
      if (submission.eventId !== eventId) continue
      const version = await this.#versions.findById(submission.formVersionId)
      if (version?.formId === formId) count++
    }
    return count
  }

  async countByFormAndContact(eventId: string, formId: FormId, contactId: string): Promise<number> {
    let count = 0
    for (const submission of this.#submissions.values()) {
      if (submission.eventId !== eventId || submission.ownerContactId !== contactId) continue
      const version = await this.#versions.findById(submission.formVersionId)
      if (version?.formId === formId) count++
    }
    return count
  }

  async save(submission: ProposalSubmission): Promise<void> {
    this.#submissions.set(submission.id, submission)
  }

  async saveContributors(
    eventId: string,
    submissionId: string,
    contributors: readonly SubmissionContributor[],
  ): Promise<void> {
    for (const contributor of contributors) {
      if (contributor.eventId === eventId && contributor.submissionId === submissionId) {
        this.#contributors.push(contributor)
      }
    }
  }

  async listContributorsBySubmission(
    eventId: string,
    submissionId: string,
  ): Promise<readonly SubmissionContributor[]> {
    return this.#contributors.filter(
      (contributor) => contributor.eventId === eventId && contributor.submissionId === submissionId,
    )
  }

  list(): readonly ProposalSubmission[] {
    return [...this.#submissions.values()]
  }
}

export class InMemoryContactRepository implements ContactRepository {
  readonly #contacts = new Map<string, Contact>()
  readonly #profiles = new Map<
    string,
    {
      readonly eventId: string
      readonly contactId: string
      readonly jobTitle: string
      readonly company: string
      readonly travelNotes: string
      readonly workflowStatus: string
    }
  >()

  constructor(contacts: readonly Contact[] = []) {
    for (const contact of contacts) this.#contacts.set(contact.id, contact)
  }

  async listSpeakersByEvent(eventId: string): Promise<readonly SpeakerRosterRow[]> {
    const rows: SpeakerRosterRow[] = []
    for (const profile of this.#profiles.values()) {
      if (profile.eventId !== eventId) continue
      const contact = this.#contacts.get(profile.contactId)
      if (contact === undefined) continue
      rows.push({
        contactId: contact.id,
        email: contact.email,
        name: contact.name,
        bio: contact.bio,
        proposalCount: 0,
        sessionCount: 0,
        taskCount: 0,
        taskCompletedCount: 0,
        hasHeadshot: false,
        jobTitle: profile.jobTitle,
        company: profile.company,
        travelNotes: profile.travelNotes,
        workflowStatus: profile.workflowStatus,
      })
    }
    return rows
  }

  async findById(id: string): Promise<Contact | null> {
    return this.#contacts.get(id) ?? null
  }

  async findByEmail(email: string): Promise<Contact | null> {
    for (const contact of this.#contacts.values()) {
      if (contact.email === email) return contact
    }
    return null
  }

  async updateProfile(
    id: string,
    fields: { readonly name: string; readonly bio: string | null },
  ): Promise<void> {
    const existing = this.#contacts.get(id)
    if (existing !== undefined) {
      this.#contacts.set(id, { ...existing, name: fields.name, bio: fields.bio })
    }
  }

  async upsertSpeakerProfile(input: {
    readonly eventId: string
    readonly contactId: string
    readonly jobTitle: string
    readonly company: string
    readonly travelNotes: string
    readonly workflowStatus: string
    readonly createdAt: string
    readonly updatedAt: string
  }): Promise<void> {
    this.#profiles.set(`${input.eventId}:${input.contactId}`, {
      eventId: input.eventId,
      contactId: input.contactId,
      jobTitle: input.jobTitle,
      company: input.company,
      travelNotes: input.travelNotes,
      workflowStatus: input.workflowStatus,
    })
  }

  /** Insert-if-absent on the email key; an existing row is never rewritten. */
  async ensureByEmail(input: {
    readonly id: string
    readonly email: string
    readonly name: string
    readonly createdAt: string
  }): Promise<Contact> {
    const existing = await this.findByEmail(input.email)
    if (existing !== null) return existing
    const contact: Contact = {
      id: input.id,
      email: input.email,
      name: input.name,
      createdAt: input.createdAt,
    }
    this.#contacts.set(contact.id, contact)
    return contact
  }

  async save(contact: Contact): Promise<void> {
    for (const existing of this.#contacts.values()) {
      if (existing.email === contact.email) return
    }
    this.#contacts.set(contact.id, contact)
  }

  list(): readonly Contact[] {
    return [...this.#contacts.values()]
  }
}

export class InMemoryConfirmationRepository implements ConfirmationRepository {
  readonly #records = new Map<string, ConfirmationRecord>()

  async save(record: ConfirmationRecord): Promise<void> {
    this.#records.set(record.submissionId, record)
  }

  async findBySubmissionId(submissionId: string): Promise<ConfirmationRecord | null> {
    return this.#records.get(submissionId) ?? null
  }

  list(): readonly ConfirmationRecord[] {
    return [...this.#records.values()]
  }
}

export class InMemoryCapturedMessageRepository implements CapturedMessageRepository {
  async listByEvent(eventId: string, limit: number): Promise<readonly CapturedMessage[]> {
    return [...this.#messages]
      .filter((message) => message.eventId === eventId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
  }

  readonly #messages: CapturedMessage[] = []

  /** Mirrors 0012: one row per (submission, kind, recipient). */
  async save(message: CapturedMessage): Promise<void> {
    const submissionId = message.submissionId ?? null
    if (
      submissionId !== null &&
      this.#messages.some(
        (stored) =>
          (stored.submissionId ?? null) === submissionId &&
          stored.kind === message.kind &&
          stored.toEmail === message.toEmail,
      )
    ) {
      throw new Error(
        `captured ${message.kind} for submission '${submissionId}' to '${message.toEmail}' already exists`,
      )
    }
    this.#messages.push(message)
  }

  async listByEmail(email: string): Promise<readonly CapturedMessage[]> {
    return this.#messages.filter((message) => message.toEmail === email)
  }

  async findBySubmissionKindEmail(
    submissionId: string,
    kind: CapturedMessage['kind'],
    toEmail: string,
  ): Promise<CapturedMessage | null> {
    return (
      this.#messages.find(
        (message) =>
          message.submissionId === submissionId &&
          message.kind === kind &&
          message.toEmail === toEmail,
      ) ?? null
    )
  }

  async listBySubmissionId(submissionId: string): Promise<readonly CapturedMessage[]> {
    return this.#messages.filter((message) => message.submissionId === submissionId)
  }

  list(): readonly CapturedMessage[] {
    return [...this.#messages]
  }
}

export class InMemoryTokenRepository implements TokenRepository {
  readonly #tokens = new Map<TokenHash, SubmitterToken>()

  async save(token: SubmitterToken): Promise<void> {
    this.#tokens.set(token.tokenHash, token)
  }

  async findByHash(tokenHash: TokenHash): Promise<SubmitterToken | null> {
    return this.#tokens.get(tokenHash) ?? null
  }

  async markConsumed(id: string, consumedAt: string): Promise<void> {
    for (const token of this.#tokens.values()) {
      if (token.id === id) this.#tokens.set(token.tokenHash, { ...token, consumedAt })
    }
  }

  list(): readonly SubmitterToken[] {
    return [...this.#tokens.values()]
  }
}

export class InMemorySessionRepository implements SessionRepository {
  readonly #sessions = new Map<TokenHash, Session>()

  async save(session: Session): Promise<void> {
    this.#sessions.set(session.tokenHash, session)
  }

  async findByHash(tokenHash: TokenHash): Promise<Session | null> {
    return this.#sessions.get(tokenHash) ?? null
  }

  async consumeByHash(tokenHash: TokenHash, consumedAt: string): Promise<void> {
    const session = this.#sessions.get(tokenHash)
    if (session !== undefined && session.consumedAt === null) {
      this.#sessions.set(tokenHash, { ...session, consumedAt })
    }
  }

  async markConsumed(id: string, consumedAt: string): Promise<void> {
    for (const session of this.#sessions.values()) {
      if (session.id === id) this.#sessions.set(session.tokenHash, { ...session, consumedAt })
    }
  }

  list(): readonly Session[] {
    return [...this.#sessions.values()]
  }
}

/** In-memory mirror of the D1 `uploaded_files` adapter (one row per owner+kind). */
export class InMemoryUploadedFileRepository implements UploadedFileRepository {
  readonly #rows = new Map<string, UploadedFileRecord>()
  #failNextUpsert = false

  /** Arms a single upsert failure so the compensation path can be pinned. */
  failNextUpsert(): void {
    this.#failNextUpsert = true
  }

  async findOwn(
    eventId: string,
    ownerContactId: string,
    kind: UploadedFileKind,
  ): Promise<UploadedFileRecord | null> {
    return this.#rows.get(ownerKey(eventId, ownerContactId, kind)) ?? null
  }

  async upsert(record: UploadedFileRecord): Promise<UploadedFileRecord | null> {
    if (this.#failNextUpsert) {
      this.#failNextUpsert = false
      throw new Error('uploaded_files write failed')
    }
    const slot = ownerKey(record.eventId, record.ownerContactId, record.kind)
    const previous = this.#rows.get(slot) ?? null
    this.#rows.set(slot, record)
    return previous
  }

  async listByEvent(eventId: string): Promise<readonly UploadedFileRecord[]> {
    return [...this.#rows.values()].filter((row) => row.eventId === eventId)
  }

  async listVersions() {
    return []
  }

  async recordVersion(): Promise<void> {
    return
  }

  async listComments() {
    return []
  }

  async addComment(): Promise<void> {
    return
  }

  list(): readonly UploadedFileRecord[] {
    return [...this.#rows.values()]
  }
}

/** In-memory mirror of the R2 object-storage adapter. */
export class InMemoryObjectStorage implements ObjectStoragePort {
  readonly objects = new Map<string, { readonly body: ArrayBuffer; readonly contentType: string }>()
  puts = 0
  readonly deletes: string[] = []

  async put(storageKey: string, body: ArrayBuffer, contentType: string): Promise<void> {
    this.puts += 1
    this.objects.set(storageKey, { body, contentType })
  }

  async get(storageKey: string): Promise<StoredObject | null> {
    const object = this.objects.get(storageKey)
    return object === undefined ? null : { body: object.body, contentType: object.contentType }
  }

  async delete(storageKey: string): Promise<void> {
    this.deletes.push(storageKey)
    this.objects.delete(storageKey)
  }
}

export class InMemoryProgrammeRepository implements ProgrammeRepository {
  readonly revisions: {
    id: string
    eventId: string
    submissionId: string
    editorName: string
    title: string
    abstract: string
    createdAt: string
  }[] = []
  readonly status = new Map<string, SessionContentStatus>()

  async listEmbeds() {
    return []
  }
  async findEmbed() {
    return null
  }
  async saveEmbed() {}

  async listRevisions(eventId: string, submissionId: string) {
    return this.revisions.filter(
      (row) => row.eventId === eventId && row.submissionId === submissionId,
    )
  }
  async addRevision(record: (typeof this.revisions)[number]) {
    this.revisions.push(record)
  }
  async findRevision(id: string) {
    return this.revisions.find((row) => row.id === id) ?? null
  }

  async getContentStatus(eventId: string, submissionId: string) {
    return this.status.get(`${eventId}:${submissionId}`) ?? 'approved'
  }
  async setContentStatus(eventId: string, submissionId: string, status: SessionContentStatus) {
    this.status.set(`${eventId}:${submissionId}`, status)
  }
  async listContentStatuses(eventId: string) {
    return [...this.status.entries()]
      .filter(([key]) => key.startsWith(`${eventId}:`))
      .map(([key, status]) => ({ submissionId: key.slice(eventId.length + 1), status }))
  }

  async saveAssignment() {}
  async listAssignments() {
    return []
  }
  async findAssignment() {
    return null
  }
  async setAssignees() {}
  async listAssignees() {
    return []
  }
  async listAssigneesForContact() {
    return []
  }
  async completeAssignee() {
    return 'not-found' as const
  }
  async findSpeakerProfile() {
    return null
  }
}

/** SQLite orders NULL before every value; the twin's reads do the same. */
function nullsFirst(left: string | number | null, right: string | number | null): number {
  if (left === right) return 0
  if (left === null) return -1
  if (right === null) return 1
  return left < right ? -1 : 1
}

function ownerKey(eventId: string, ownerContactId: string, kind: UploadedFileKind): string {
  return `${eventId}:${ownerContactId}:${kind}`
}

function key(eventId: string, versionId: VersionId): string {
  return `${eventId}:${versionId}`
}

function emptyContent(): FormVersionContent {
  return { pages: [], elements: [], conditionRules: [], routingRules: [] }
}
