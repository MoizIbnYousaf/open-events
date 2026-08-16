import type {
  CapturedMessage,
  CfpForm,
  FormVersion,
  FormVersionContent,
  SubmissionContributor,
  SubmitterToken,
  Contact,
} from '../../../src/domain'
import { evaluateFormSubmitGate } from '../../../src/domain'
import { MAX_CO_SPEAKERS } from '../../../src/domain'
import type {
  FormBuilderUnitOfWork,
  PublishResult,
  RedeemSubmitterTokenResult,
  RotateSessionResult,
  SaveDraftResult,
  SubmitBatchInput,
  SubmitBatchResult,
  SubmitUnitOfWork,
} from '../../../src/application'
import {
  InMemoryCapturedMessageRepository,
  InMemoryConfirmationRepository,
  InMemoryContactRepository,
  InMemoryDraftRepository,
  InMemoryFormContentRepository,
  InMemoryFormRepository,
  InMemoryFormVersionRepository,
  InMemorySessionRepository,
  InMemorySubmissionRepository,
  InMemoryTokenRepository,
} from './in-memory-repositories'

/**
 * Adapter-faithful in-memory submit unit of work: re-reads the form, applies
 * the version-bound gate with fresh counts, upserts co-speaker contacts
 * (dedupe by normalized email) and performs the whole write batch atomically.
 * Rejections cause zero contact writes.
 */
export class InMemorySubmitUnitOfWork implements SubmitUnitOfWork {
  readonly #forms: InMemoryFormRepository
  readonly #submissions: InMemorySubmissionRepository
  readonly #contacts: InMemoryContactRepository
  readonly #messages: InMemoryCapturedMessageRepository
  readonly #confirmations: InMemoryConfirmationRepository
  readonly #drafts: InMemoryDraftRepository

  constructor(deps: {
    readonly forms: InMemoryFormRepository
    readonly versions: InMemoryFormVersionRepository
    readonly submissions: InMemorySubmissionRepository
    readonly contacts: InMemoryContactRepository
    readonly messages: InMemoryCapturedMessageRepository
    readonly confirmations: InMemoryConfirmationRepository
    readonly drafts: InMemoryDraftRepository
  }) {
    this.#forms = deps.forms
    this.#submissions = deps.submissions
    this.#contacts = deps.contacts
    this.#messages = deps.messages
    this.#confirmations = deps.confirmations
    this.#drafts = deps.drafts
  }

  async recoverHandoff(): Promise<{ readonly outcome: 'handoff-invalid' }> {
    return { outcome: 'handoff-invalid' }
  }

  async execute(input: SubmitBatchInput): Promise<SubmitBatchResult> {
    if (input.coSpeakers.length > MAX_CO_SPEAKERS) {
      throw new Error(`A submission may include at most ${MAX_CO_SPEAKERS} co-speakers`)
    }
    const form = await this.#forms.findById(input.formId)
    if (form === null) return { outcome: 'closed' }
    const [totalCount, identityCount] = await Promise.all([
      this.#submissions.countByForm(input.eventId, input.formId),
      this.#submissions.countByFormAndContact(input.eventId, input.formId, input.ownerContactId),
    ])
    const gate = evaluateFormSubmitGate(
      form,
      input.submission.formVersionId,
      input.submittedAt,
      totalCount,
      identityCount,
    )
    if (!gate.allowed) {
      if (gate.reason === 'total_cap_reached') return { outcome: 'capped' }
      if (gate.reason === 'identity_limit_reached') return { outcome: 'identity-limited' }
      return { outcome: 'closed' }
    }

    const existing = await this.#submissions.findByOriginDraftId(input.originDraftId)
    if (existing !== null) return { outcome: 'existing-idempotent', submission: existing }

    const contributors: SubmissionContributor[] = [
      {
        submissionId: input.submission.id,
        eventId: input.eventId,
        contactId: input.ownerContactId,
        role: 'primary',
        position: 0,
      },
    ]
    for (const [index, intent] of input.coSpeakers.entries()) {
      let contact = await this.#contacts.findByEmail(intent.email)
      if (contact === null) {
        contact = {
          id: crypto.randomUUID(),
          email: intent.email,
          name: intent.name,
          createdAt: input.submittedAt,
        }
        await this.#contacts.save(contact)
      }
      contributors.push({
        submissionId: input.submission.id,
        eventId: input.eventId,
        contactId: contact.id,
        role: 'co-speaker',
        position: index + 1,
      })
    }

    await this.#submissions.save(input.submission)
    await this.#submissions.saveContributors(input.eventId, input.submission.id, contributors)
    await this.#messages.save(input.message)
    await this.#confirmations.save(input.confirmation)
    await this.#drafts.deleteById(input.eventId, input.originDraftId)
    return { outcome: 'inserted', submission: input.submission }
  }
}

/** Adapter-faithful in-memory form-builder unit of work with optimistic stamps. */
export class InMemoryFormBuilderUnitOfWork implements FormBuilderUnitOfWork {
  readonly #versions: InMemoryFormVersionRepository
  readonly #content: InMemoryFormContentRepository
  readonly #forms: InMemoryFormRepository

  constructor(deps: {
    readonly versions: InMemoryFormVersionRepository
    readonly content: InMemoryFormContentRepository
    readonly forms: InMemoryFormRepository
  }) {
    this.#versions = deps.versions
    this.#content = deps.content
    this.#forms = deps.forms
  }

  async saveDraft(input: {
    readonly expected: FormVersion | null
    readonly version: FormVersion
    readonly content: FormVersionContent
  }): Promise<SaveDraftResult> {
    const existing = await this.#versions.findById(input.version.id)
    if (input.expected === null) {
      if (existing !== null) return { outcome: 'conflict' }
    } else if (
      existing === null ||
      existing.status !== 'draft' ||
      existing.updatedAt !== input.expected.updatedAt
    ) {
      return { outcome: 'conflict' }
    }
    await this.#versions.save(input.version)
    await this.#content.saveForVersion(input.version.eventId, input.version.id, input.content)
    return { outcome: 'saved' }
  }

  async publish(input: {
    readonly expected: FormVersion
    readonly publishedVersion: FormVersion
    readonly expectedForm: CfpForm
    readonly form: CfpForm
  }): Promise<PublishResult> {
    const version = await this.#versions.findById(input.expected.id)
    const form = await this.#forms.findById(input.expectedForm.id)
    if (
      version === null ||
      version.status !== 'draft' ||
      version.updatedAt !== input.expected.updatedAt ||
      form === null ||
      form.publishedVersionId !== input.expectedForm.publishedVersionId
    ) {
      return { outcome: 'conflict' }
    }
    await this.#versions.save(input.publishedVersion)
    await this.#forms.save(input.form)
    return { outcome: 'published' }
  }
}

/** Adapter-faithful in-memory session unit of work with contact upsert dedupe. */
export class InMemorySessionUnitOfWork {
  readonly #tokens: InMemoryTokenRepository
  readonly #sessions: InMemorySessionRepository
  readonly #messages: InMemoryCapturedMessageRepository
  readonly #contacts: InMemoryContactRepository
  issueStartResult: import('../../../src/application').IssueStartResult = { outcome: 'issued' }

  constructor(deps: {
    readonly tokens: InMemoryTokenRepository
    readonly sessions: InMemorySessionRepository
    readonly messages: InMemoryCapturedMessageRepository
    readonly contacts: InMemoryContactRepository
  }) {
    this.#tokens = deps.tokens
    this.#sessions = deps.sessions
    this.#messages = deps.messages
    this.#contacts = deps.contacts
  }

  async issueStart(input: {
    readonly contact: Contact
    readonly token: SubmitterToken
    readonly message: CapturedMessage
    readonly budget: import('../../../src/application').StartMailBudgetReservation
  }): Promise<import('../../../src/application').IssueStartResult> {
    if (this.issueStartResult.outcome === 'limited') return this.issueStartResult
    const existing = await this.#contacts.findByEmail(input.contact.email)
    if (existing === null) await this.#contacts.save(input.contact)
    // Email-keyed subquery: the token's contact reference always resolves to
    // the actually persisted contact row, even under a concurrent insert.
    const persisted = await this.#contacts.findByEmail(input.contact.email)
    const token = { ...input.token, contactId: persisted?.id ?? input.contact.id }
    await this.#tokens.save(token)
    await this.#messages.save(input.message)
    return this.issueStartResult
  }

  async issueRoleAccess(input: {
    readonly token: SubmitterToken
    readonly message: CapturedMessage
  }): Promise<{ readonly outcome: 'issued' }> {
    await this.#tokens.save(input.token)
    await this.#messages.save(input.message)
    return { outcome: 'issued' }
  }

  async redeemSubmitterToken(input: {
    readonly tokenId: string
    readonly consumedAt: string
    readonly session: import('../../../src/domain').Session
  }): Promise<RedeemSubmitterTokenResult> {
    const record = this.#tokens.list().find((token) => token.id === input.tokenId) ?? null
    if (record === null || record.consumedAt !== null) return { outcome: 'conflict' }
    await this.#tokens.markConsumed(input.tokenId, input.consumedAt)
    await this.#sessions.save(input.session)
    return { outcome: 'redeemed' }
  }

  async rotateSession(input: {
    readonly sessionId: string
    readonly consumedAt: string
    readonly rotated: import('../../../src/domain').Session
  }): Promise<RotateSessionResult> {
    const record = this.#sessions.list().find((session) => session.id === input.sessionId) ?? null
    if (record === null || record.consumedAt !== null) return { outcome: 'conflict' }
    await this.#sessions.markConsumed(input.sessionId, input.consumedAt)
    await this.#sessions.save(input.rotated)
    return { outcome: 'rotated' }
  }
}
