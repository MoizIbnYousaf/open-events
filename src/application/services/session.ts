import type { OrganizerSession, Session, SubmitterSession, SubmitterToken } from '../../domain/auth'
import type { ContactId } from '../../domain/contact'
import type { EventId, UtcInstant } from '../../domain/event'
import { isValidEmailAddress, normalizeEmail } from '../../domain/invariants/email'
import type {
  OrganizerSessionDto,
  RedeemResult,
  RotatedSessionDto,
  StartInput,
  StartResponseDto,
} from '../dtos/session.dto'
import { ApplicationError, ValidationFailedError } from '../errors'
import { publicCfpPath } from '../public-path'
import type { Clock } from '../ports/clock'
import type { ContactRepository } from '../ports/contact-repository'
import type { EventRepository } from '../ports/event-repository'
import type { FormRepository } from '../ports/form-repository'
import type { SessionRepository } from '../ports/session-repository'
import type { SessionUnitOfWork } from '../ports/session-unit-of-work'
import type { TokenGenerator, TokenHasher } from '../ports/token-ports'
import type { TokenRepository } from '../ports/token-repository'
import {
  assertValidTtl,
  isSessionValid,
  isTokenRedeemable,
  MAX_ORGANIZER_SESSION_TTL_MS,
  MAX_SUBMITTER_SESSION_TTL_MS,
  MAX_SUBMITTER_TOKEN_TTL_MS,
} from '../security/token-policy'
import { constantTimeSecretEqual } from '../security/webcrypto'
import { addMillis } from '../time'

export class SessionService {
  readonly #tokens: TokenRepository
  readonly #sessions: SessionRepository
  readonly #contacts: ContactRepository
  readonly #events: EventRepository
  readonly #forms: FormRepository
  readonly #hasher: TokenHasher
  readonly #tokenGenerator: TokenGenerator
  readonly #unitOfWork: SessionUnitOfWork
  readonly #clock: Clock

  constructor(
    tokens: TokenRepository,
    sessions: SessionRepository,
    contacts: ContactRepository,
    events: EventRepository,
    forms: FormRepository,
    hasher: TokenHasher,
    tokenGenerator: TokenGenerator,
    unitOfWork: SessionUnitOfWork,
    clock: Clock,
  ) {
    this.#tokens = tokens
    this.#sessions = sessions
    this.#contacts = contacts
    this.#events = events
    this.#forms = forms
    this.#hasher = hasher
    this.#tokenGenerator = tokenGenerator
    this.#unitOfWork = unitOfWork
    this.#clock = clock
  }

  async organizerLogin(
    secret: string,
    expectedSecret: string,
    ttlMs: number,
  ): Promise<OrganizerSessionDto> {
    if (!(await constantTimeSecretEqual(secret, expectedSecret))) {
      throw new ApplicationError('unauthorized', 'Invalid organizer secret')
    }
    return this.issueOrganizerSession(ttlMs)
  }

  /**
   * Issues an organizer session after an identity check that already happened
   * elsewhere (local secret, or a verified Clerk JWT). Callers must not skip
   * that check.
   */
  async issueOrganizerSession(ttlMs: number): Promise<OrganizerSessionDto> {
    const issued = await this.#buildOrganizerSession(this.#clock.now(), ttlMs)
    await this.#sessions.save(issued.session)
    return { token: issued.token, expiresAt: issued.expiresAt }
  }

  /**
   * Start flow: normalize/dedupe the contact, issue a single-use expiring token
   * (hash stored), and persist the token together with its captured message
   * atomically through the `SessionUnitOfWork`, so a delivered link never loses
   * its delivery record. Returns a generic response; the link never leaves the
   * captured message.
   */
  async startSubmitter(
    input: StartInput,
    ttlMs: number,
    linkBuilder: (token: string, path: string) => string,
  ): Promise<StartResponseDto> {
    assertValidTtl(ttlMs, MAX_SUBMITTER_TOKEN_TTL_MS)
    const now = this.#clock.now()
    const normalized = normalizeEmail(input.email)
    if (!isValidEmailAddress(normalized)) {
      throw new ValidationFailedError('Invalid email address', [])
    }
    const event = await this.#events.findBySlug(input.eventSlug)
    if (event === null) {
      throw new ApplicationError('not_found', `Event '${input.eventSlug}' not found`)
    }
    const form = await this.#forms.findByEventAndSlug(event.id, input.formSlug)
    if (form === null || form.publishedVersionId === null) {
      throw new ApplicationError(
        'not_found',
        `Form '${input.formSlug}' is not published for event '${input.eventSlug}'`,
      )
    }
    const eventId = event.id
    const existingContact = await this.#contacts.findByEmail(normalized)
    const contactId = existingContact?.id ?? crypto.randomUUID()
    const token = await this.#tokenGenerator.generate()
    const expiresAt = addMillis(now, ttlMs)
    const tokenRecord: SubmitterToken = {
      id: crypto.randomUUID(),
      eventId,
      contactId,
      formId: form.id,
      tokenHash: await this.#hasher.hash(token),
      expiresAt,
      consumedAt: null,
      createdAt: now,
    }
    const message = {
      id: crypto.randomUUID(),
      eventId,
      toEmail: normalized,
      subject: 'Your Open Events CFP link',
      body: `Open your CFP session: ${linkBuilder(token, publicCfpPath(input.eventSlug, input.formSlug))}`,
      createdAt: now,
      kind: 'confirmation' as const,
    }
    await this.#unitOfWork.issueStart({
      contact: { id: contactId, email: normalized, name: normalized, createdAt: now },
      token: tokenRecord,
      message,
    })
    return { status: 'accepted' }
  }

  /**
   * Redeems a start token: consumes it and issues a rotated submitter session
   * bound to the token's contact. The consume + issue happens atomically
   * through the `SessionUnitOfWork` (single-use under concurrency). The
   * trusted redirect path is derived from the event/form rows BEFORE the
   * consume, so any resolution failure leaves the token unconsumed.
   */
  async redeemSubmitterToken(token: string, ttlMs: number): Promise<RedeemResult> {
    const now = this.#clock.now()
    const tokenHash = await this.#hasher.hash(token)
    const record = await this.#tokens.findByHash(tokenHash)
    if (record === null || !isTokenRedeemable(record, now)) {
      throw new ApplicationError('forbidden', 'Token is invalid, expired, or already used')
    }
    const event = await this.#events.findById(record.eventId)
    if (event === null) {
      throw new ApplicationError('not_found', `Event for token '${record.id}' not found`)
    }
    const form = await this.#forms.findById(record.formId)
    if (form === null) {
      throw new ApplicationError('not_found', `Form for token '${record.id}' not found`)
    }
    if (form.eventId !== record.eventId) {
      throw new ApplicationError('not_found', `Form for token '${record.id}' not found`)
    }
    if (form.publishedVersionId === null) {
      throw new ApplicationError('not_found', `Form for token '${record.id}' is not published`)
    }
    const redirectPath = publicCfpPath(event.slug, form.slug)
    const issued = await this.#buildSubmitterSession(record.contactId, record.eventId, now, ttlMs)
    const result = await this.#unitOfWork.redeemSubmitterToken({
      tokenId: record.id,
      consumedAt: now,
      session: issued.session,
    })
    if (result.outcome === 'conflict') {
      throw new ApplicationError('forbidden', 'Token was already redeemed')
    }
    return {
      token: issued.token,
      expiresAt: issued.expiresAt,
      contactId: record.contactId,
      eventId: record.eventId,
      redirectPath,
    }
  }

  /** Validates a session cookie token (hash lookup, expiry, consumption). */
  async validateSession(token: string): Promise<Session | null> {
    const now = this.#clock.now()
    const session = await this.#sessions.findByHash(await this.#hasher.hash(token))
    if (session === null || !isSessionValid(session, now)) return null
    return session
  }

  /** Idempotently revokes the session represented by a raw cookie token. */
  async revokeSession(token: string): Promise<void> {
    await this.#sessions.consumeByHash(await this.#hasher.hash(token), this.#clock.now())
  }

  /** Rotation seam: consume the current session and issue a fresh one, preserving identity. */
  async rotateSession(token: string, ttlMs: number): Promise<RotatedSessionDto> {
    const now = this.#clock.now()
    const current = await this.validateSession(token)
    if (current === null) {
      throw new ApplicationError('forbidden', 'Session is invalid or expired')
    }
    const issued =
      current.kind === 'submitter'
        ? await this.#buildSubmitterSession(current.contactId, current.eventId, now, ttlMs)
        : await this.#buildOrganizerSession(now, ttlMs)
    const result = await this.#unitOfWork.rotateSession({
      sessionId: current.id,
      consumedAt: now,
      rotated: issued.session,
    })
    if (result.outcome === 'conflict') {
      throw new ApplicationError('forbidden', 'Session was already consumed')
    }
    return { token: issued.token, expiresAt: issued.expiresAt, kind: current.kind }
  }

  async #buildOrganizerSession(
    now: UtcInstant,
    ttlMs: number,
  ): Promise<{
    readonly token: string
    readonly expiresAt: UtcInstant
    readonly session: OrganizerSession
  }> {
    assertValidTtl(ttlMs, MAX_ORGANIZER_SESSION_TTL_MS)
    const token = await this.#tokenGenerator.generate()
    const expiresAt = addMillis(now, ttlMs)
    const session: OrganizerSession = {
      id: crypto.randomUUID(),
      kind: 'organizer',
      tokenHash: await this.#hasher.hash(token),
      expiresAt,
      consumedAt: null,
      createdAt: now,
    }
    return { token, expiresAt, session }
  }

  async #buildSubmitterSession(
    contactId: ContactId,
    eventId: EventId,
    now: UtcInstant,
    ttlMs: number,
  ): Promise<{
    readonly token: string
    readonly expiresAt: UtcInstant
    readonly session: SubmitterSession
  }> {
    assertValidTtl(ttlMs, MAX_SUBMITTER_SESSION_TTL_MS)
    const token = await this.#tokenGenerator.generate()
    const expiresAt = addMillis(now, ttlMs)
    const session: SubmitterSession = {
      id: crypto.randomUUID(),
      kind: 'submitter',
      contactId,
      eventId,
      tokenHash: await this.#hasher.hash(token),
      expiresAt,
      consumedAt: null,
      createdAt: now,
    }
    return { token, expiresAt, session }
  }
}
