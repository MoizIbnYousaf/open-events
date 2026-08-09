import type {
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
  SubmitterToken,
  TaxonomyItem,
  TokenHash,
  VersionId,
} from '../../../src/domain'
import type {
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
  TaxonomyRepository,
  TokenRepository,
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
  readonly #versions: FormVersionRepository

  constructor(versions: FormVersionRepository, submissions: readonly ProposalSubmission[] = []) {
    this.#versions = versions
    for (const submission of submissions) this.#submissions.set(submission.id, submission)
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

  constructor(contacts: readonly Contact[] = []) {
    for (const contact of contacts) this.#contacts.set(contact.id, contact)
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
  readonly #messages: CapturedMessage[] = []

  async save(message: CapturedMessage): Promise<void> {
    this.#messages.push(message)
  }

  async listByEmail(email: string): Promise<readonly CapturedMessage[]> {
    return this.#messages.filter((message) => message.toEmail === email)
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

  async markConsumed(id: string, consumedAt: string): Promise<void> {
    for (const session of this.#sessions.values()) {
      if (session.id === id) this.#sessions.set(session.tokenHash, { ...session, consumedAt })
    }
  }

  list(): readonly Session[] {
    return [...this.#sessions.values()]
  }
}

function key(eventId: string, versionId: VersionId): string {
  return `${eventId}:${versionId}`
}

function emptyContent(): FormVersionContent {
  return { pages: [], elements: [], conditionRules: [], routingRules: [] }
}
