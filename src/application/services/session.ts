import type {
  OrganizerSession,
  SessionCapability,
  SessionProvenance,
  SubmitterAccessPurpose,
  SubmitterSession,
  SubmitterToken,
} from '../../domain/auth'
import type { ContactId } from '../../domain/contact'
import type { EventId, UtcInstant } from '../../domain/event'
import { isValidEmailAddress, normalizeEmail } from '../../domain/invariants/email'
import type {
  OrganizerSessionDto,
  CfpSubmitAuthorization,
  RedeemResult,
  RotatedSessionDto,
  StartInput,
} from '../dtos/session.dto'
import type { SubmitInput } from '../dtos/submission.dto'
import { OrganizerActor, toSubmitterActor } from '../actors'
import { markValidatedLegacySession, type ValidatedSession } from '../actors'
import { ApplicationError, ValidationFailedError } from '../errors'
import { publicCfpPath } from '../public-path'
import type { Clock } from '../ports/clock'
import type { ContactRepository } from '../ports/contact-repository'
import type { EventRepository } from '../ports/event-repository'
import type { FormRepository } from '../ports/form-repository'
import type { SessionRepository } from '../ports/session-repository'
import type { SessionUnitOfWork, StartMailBudgetReservation } from '../ports/session-unit-of-work'
import type { TokenGenerator, TokenHasher } from '../ports/token-ports'
import type { TokenRepository } from '../ports/token-repository'
import type {
  RoleAccessIssueInput,
  RoleAccessIssueResult,
  RoleAccessIssuer,
} from '../ports/role-access-issuer'
import {
  assertValidTtl,
  canUseLegacyCapabilityRow,
  isSessionValid,
  isTokenRedeemable,
  MAX_ORGANIZER_SESSION_TTL_MS,
  MAX_SUBMITTER_SESSION_TTL_MS,
  MAX_SUBMITTER_TOKEN_TTL_MS,
} from '../security/token-policy'
import { constantTimeSecretEqual } from '../security/webcrypto'
import { addMillis } from '../time'

export type StartSubmitterResult =
  | {
      readonly outcome: 'issued'
      readonly message: import('../../domain').CapturedMessage
      readonly accessUrl: string
    }
  | { readonly outcome: 'limited' }

export type SubmitterAccessRecoveryKind = 'invalid' | 'legacy' | SubmitterAccessPurpose

export interface SubmitterCapabilityRollout {
  readonly writerMode: 'legacy' | 'purpose'
  readonly legacyReaderMode: 'rollout' | 'bounded'
}

/**
 * A browser-followable failure for a raw access link. The route maps this to
 * a trusted relative 303 target and never exposes the token or request host.
 */
export class SubmitterAccessRecoveryError extends ApplicationError {
  readonly recoveryKind: SubmitterAccessRecoveryKind

  constructor(recoveryKind: SubmitterAccessRecoveryKind) {
    super('forbidden', 'Access link needs recovery')
    this.name = 'SubmitterAccessRecoveryError'
    this.recoveryKind = recoveryKind
  }
}

export class SessionService implements RoleAccessIssuer {
  readonly #tokens: TokenRepository
  readonly #sessions: SessionRepository
  readonly #contacts: ContactRepository
  readonly #events: EventRepository
  readonly #forms: FormRepository
  readonly #hasher: TokenHasher
  readonly #tokenGenerator: TokenGenerator
  readonly #unitOfWork: SessionUnitOfWork
  readonly #clock: Clock
  readonly #lastLegacyWriterCutoff: UtcInstant | null
  readonly #roleAccessOrigin: string | null
  readonly #roleAccessTtlMs: number
  readonly #capabilityRollout: SubmitterCapabilityRollout

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
    lastLegacyWriterCutoff: UtcInstant | null = null,
    roleAccessConfig: { readonly publicAppOrigin: string; readonly ttlMs: number } | null = null,
    capabilityRollout: SubmitterCapabilityRollout = {
      writerMode: 'purpose',
      legacyReaderMode: 'bounded',
    },
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
    this.#lastLegacyWriterCutoff = lastLegacyWriterCutoff
    this.#roleAccessOrigin = roleAccessConfig?.publicAppOrigin ?? null
    this.#roleAccessTtlMs = roleAccessConfig?.ttlMs ?? MAX_SUBMITTER_TOKEN_TTL_MS
    this.#capabilityRollout = capabilityRollout
  }

  async issueRoleAccess(
    actor: OrganizerActor,
    input: RoleAccessIssueInput,
  ): Promise<RoleAccessIssueResult> {
    if (!(actor instanceof OrganizerActor)) {
      throw new ApplicationError('forbidden', 'Organizer authority is required')
    }
    if (this.#capabilityRollout.writerMode !== 'purpose') {
      throw new ApplicationError('forbidden', 'Purpose-bound role access is not active')
    }
    if (
      (input.purpose === 'portal' && input.proof.kind !== 'speaker-member') ||
      (input.purpose === 'evaluation' && input.proof.kind !== 'committee-member')
    ) {
      throw new ApplicationError('forbidden', 'Role access proof does not match its purpose')
    }
    if (this.#roleAccessOrigin === null) {
      throw new ApplicationError('internal', 'Role access issuer is not configured')
    }
    assertValidTtl(this.#roleAccessTtlMs, MAX_SUBMITTER_TOKEN_TTL_MS)
    const now = this.#clock.now()
    const email = normalizeEmail(input.email)
    if (!isValidEmailAddress(email)) {
      throw new ValidationFailedError('Invalid email address', [])
    }
    const rawToken = await this.#tokenGenerator.generate()
    const accessUrl = new URL('/api/public/session', this.#roleAccessOrigin)
    accessUrl.searchParams.set('token', rawToken)
    const token: SubmitterToken = {
      id: crypto.randomUUID(),
      eventId: input.eventId,
      contactId: input.contactId,
      formId: null,
      purpose: input.purpose,
      tokenHash: await this.#hasher.hash(rawToken),
      expiresAt: addMillis(now, this.#roleAccessTtlMs),
      consumedAt: null,
      createdAt: now,
    }
    const message = {
      id: crypto.randomUUID(),
      eventId: input.eventId,
      toEmail: email,
      subject: input.subject,
      body: input.renderBody(accessUrl.toString()),
      createdAt: now,
      kind: input.kind,
      submissionId: input.submissionId ?? null,
    }
    const result = await this.#unitOfWork.issueRoleAccess({
      token,
      message,
      proof: input.proof,
      ...(input.budget === undefined ? {} : { budget: input.budget }),
    })
    if (result.outcome === 'limited') return result
    if (result.outcome === 'conflict') {
      throw new ApplicationError('conflict', 'A role access message already exists')
    }
    return { outcome: 'issued', accessUrl: accessUrl.toString(), message }
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
  async issueOrganizerSession(
    ttlMs: number,
    provenance: SessionProvenance = 'ordinary',
  ): Promise<OrganizerSessionDto> {
    const issued = await this.#buildOrganizerSession(this.#clock.now(), ttlMs, provenance)
    await this.#sessions.save(issued.session)
    return { token: issued.token, expiresAt: issued.expiresAt }
  }

  /**
   * Start flow: normalize/dedupe the contact, issue a single-use expiring token
   * (hash stored), and persist the token together with its captured message
   * atomically through the `SessionUnitOfWork`, so a delivered link never loses
   * its delivery record. Returns a generic response; the link never leaves the
   * captured message. The internal outcome lets trusted callers distinguish a
   * newly issued invite from a limited attempt; the public route always maps
   * either outcome to the same generic DTO.
   */
  async startSubmitter(
    input: StartInput,
    ttlMs: number,
    publicAppOrigin: string,
    budget: StartMailBudgetReservation,
  ): Promise<StartSubmitterResult> {
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
    const accessUrl = new URL('/api/public/session', publicAppOrigin)
    accessUrl.searchParams.set('token', token)
    const expiresAt = addMillis(now, ttlMs)
    const tokenRecord: SubmitterToken = {
      id: crypto.randomUUID(),
      eventId,
      contactId,
      formId: form.id,
      purpose: this.#capabilityRollout.writerMode === 'purpose' ? 'cfp' : null,
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
      body: `Open your CFP session: ${accessUrl.toString()}`,
      createdAt: now,
      kind: 'confirmation' as const,
    }
    const result = await this.#unitOfWork.issueStart({
      contact: { id: contactId, email: normalized, name: normalized, createdAt: now },
      token: tokenRecord,
      message,
      budget,
    })
    return result.outcome === 'issued'
      ? { outcome: 'issued', message, accessUrl: accessUrl.toString() }
      : result
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
    if (record === null) throw new SubmitterAccessRecoveryError('invalid')
    if (!isTokenRedeemable(record, now)) {
      throw new SubmitterAccessRecoveryError(record.purpose ?? 'legacy')
    }
    if (record.purpose === null) {
      const inCompatibilityWindow = this.#canUseLegacyRow(record, now, MAX_SUBMITTER_TOKEN_TTL_MS)
      if (!inCompatibilityWindow) throw new SubmitterAccessRecoveryError('invalid')
    }
    const event = await this.#events.findById(record.eventId)
    if (event === null) {
      throw new ApplicationError('not_found', `Event for token '${record.id}' not found`)
    }
    let redirectPath: string
    if (record.purpose === 'cfp' || record.purpose === null) {
      if (record.formId === null) {
        throw new ApplicationError('not_found', `Form for token '${record.id}' not found`)
      }
      const form = await this.#forms.findPublicById(record.formId)
      if (form === null || form.eventId !== record.eventId) {
        throw new ApplicationError('not_found', `Form for token '${record.id}' not found`)
      }
      if (form.publishedVersionId === null) {
        throw new ApplicationError('not_found', `Form for token '${record.id}' is not published`)
      }
      redirectPath = publicCfpPath(event.slug, form.slug)
    } else {
      redirectPath = record.purpose === 'portal' ? '/portal' : '/evaluations'
    }
    const legacyHorizon =
      record.purpose === null && this.#lastLegacyWriterCutoff !== null
        ? addMillis(this.#lastLegacyWriterCutoff, MAX_SUBMITTER_SESSION_TTL_MS)
        : undefined
    const issued = await this.#buildSubmitterSession(
      record.contactId,
      record.eventId,
      record.purpose,
      now,
      ttlMs,
      record.purpose === null
        ? { createdAt: record.createdAt, absoluteExpiresAt: legacyHorizon }
        : undefined,
    )
    const result = await this.#unitOfWork.redeemSubmitterToken({
      tokenId: record.id,
      consumedAt: now,
      session: issued.session,
    })
    if (result.outcome === 'conflict') {
      throw new SubmitterAccessRecoveryError(record.purpose ?? 'legacy')
    }
    return {
      token: issued.token,
      expiresAt: issued.expiresAt,
      contactId: record.contactId,
      eventId: record.eventId,
      capability: record.purpose,
      redirectPath,
    }
  }

  /** Validates a session cookie token (hash lookup, expiry, consumption). */
  async validateSession(token: string): Promise<ValidatedSession | null> {
    const now = this.#clock.now()
    const session = await this.#sessions.findByHash(await this.#hasher.hash(token))
    if (session === null || !isSessionValid(session, now)) return null
    if (session.kind === 'submitter' && session.capability === null) {
      if (!this.#canUseLegacyRow(session, now, MAX_SUBMITTER_SESSION_TTL_MS)) {
        return null
      }
      return markValidatedLegacySession(session as SubmitterSession & { readonly capability: null })
    }
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
        ? await this.#buildSubmitterSession(
            current.contactId,
            current.eventId,
            current.capability,
            now,
            ttlMs,
            current.capability === null && this.#lastLegacyWriterCutoff !== null
              ? {
                  createdAt: current.createdAt,
                  absoluteExpiresAt: addMillis(
                    this.#lastLegacyWriterCutoff,
                    MAX_SUBMITTER_SESSION_TTL_MS,
                  ),
                }
              : undefined,
            current.provenance,
          )
        : await this.#buildOrganizerSession(now, ttlMs, current.provenance)
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

  /**
   * Prepares a deterministic, request-scoped portal handoff. This method does
   * not persist or elevate anything: only SubmitUnitOfWork may atomically bind
   * the handoff to authoritative owned submission evidence. A consumed CFP
   * secret is represented only as an exact-retry candidate and cannot validate
   * through the normal session boundary.
   */
  async authorizeCfpSubmit(
    token: string,
    input: SubmitInput,
    ttlMs: number,
  ): Promise<CfpSubmitAuthorization> {
    assertValidTtl(ttlMs, MAX_SUBMITTER_SESSION_TTL_MS)
    const now = this.#clock.now()
    const current = await this.#sessions.findByHash(await this.#hasher.hash(token))
    const nowMs = Date.parse(now)
    const isLegacy = current?.kind === 'submitter' && current.capability === null
    const source = isLegacy
      ? this.#legacySubmitSource(current as SubmitterSession & { readonly capability: null }, now)
      : current?.kind === 'submitter' && current.capability === 'cfp'
        ? ({ kind: 'cfp' } as const)
        : null
    if (
      current === null ||
      current.kind !== 'submitter' ||
      source === null ||
      !Number.isFinite(nowMs) ||
      Date.parse(current.createdAt) > nowMs ||
      Date.parse(current.expiresAt) <= nowMs
    ) {
      throw new ApplicationError('forbidden', 'Only a CFP session can enter the speaker portal')
    }
    const validatedCurrent =
      current.capability === null
        ? markValidatedLegacySession(current as SubmitterSession & { readonly capability: null })
        : current
    const actor = toSubmitterActor(validatedCurrent)
    if (actor === null) {
      throw new ApplicationError('forbidden', 'Only a CFP session can enter the speaker portal')
    }
    const requestHash = await this.#hasher.hash(JSON.stringify(input))
    const portalToken = await this.#hasher.hash(
      `open-events:cfp-submit-handoff:v1:${token}:${input.originDraftId}:${requestHash}`,
    )
    const portalTokenHash = await this.#hasher.hash(portalToken)
    const portalSessionIdHash = await this.#hasher.hash(
      `open-events:cfp-submit-handoff-session:v1:${portalToken}`,
    )
    const expiresAt = addMillis(now, ttlMs)
    return {
      actor,
      mode: current.consumedAt === null ? 'initial' : 'retry',
      cfpSessionId: current.id,
      originDraftId: input.originDraftId,
      requestHash,
      portalToken,
      portalSession: {
        id: `submit-handoff-${portalSessionIdHash.slice(0, 48)}`,
        kind: 'submitter',
        contactId: current.contactId,
        eventId: current.eventId,
        capability: 'portal',
        tokenHash: portalTokenHash,
        expiresAt,
        consumedAt: null,
        createdAt: now,
        provenance: current.provenance,
      },
      source,
    }
  }

  #canUseLegacyRow(
    row: { readonly createdAt: UtcInstant },
    now: UtcInstant,
    maxLifetimeMs: number,
  ): boolean {
    const createdAtMs = Date.parse(row.createdAt)
    const nowMs = Date.parse(now)
    if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs) || createdAtMs > nowMs) {
      return false
    }
    if (this.#capabilityRollout.legacyReaderMode === 'rollout') return true
    return canUseLegacyCapabilityRow(row, now, this.#lastLegacyWriterCutoff, maxLifetimeMs)
  }

  #legacySubmitSource(
    session: SubmitterSession & { readonly capability: null },
    now: UtcInstant,
  ): CfpSubmitAuthorization['source'] | null {
    if (!this.#canUseLegacyRow(session, now, MAX_SUBMITTER_SESSION_TTL_MS)) return null
    if (this.#capabilityRollout.legacyReaderMode === 'rollout') {
      return { kind: 'legacy-rollout' }
    }
    if (this.#lastLegacyWriterCutoff === null) return null
    return {
      kind: 'legacy-bounded',
      lastLegacyWriterCutoff: this.#lastLegacyWriterCutoff,
      compatibilityEndsAt: addMillis(this.#lastLegacyWriterCutoff, MAX_SUBMITTER_SESSION_TTL_MS),
    }
  }

  async #buildOrganizerSession(
    now: UtcInstant,
    ttlMs: number,
    provenance: SessionProvenance = 'ordinary',
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
      provenance,
    }
    return { token, expiresAt, session }
  }

  async #buildSubmitterSession(
    contactId: ContactId,
    eventId: EventId,
    capability: SessionCapability | null,
    now: UtcInstant,
    ttlMs: number,
    legacy?: {
      readonly createdAt: UtcInstant
      readonly absoluteExpiresAt: UtcInstant | undefined
    },
    provenance: SessionProvenance = 'ordinary',
  ): Promise<{
    readonly token: string
    readonly expiresAt: UtcInstant
    readonly session: SubmitterSession
  }> {
    assertValidTtl(ttlMs, MAX_SUBMITTER_SESSION_TTL_MS)
    const token = await this.#tokenGenerator.generate()
    const requestedExpiresAt = addMillis(now, ttlMs)
    const expiresAt =
      legacy?.absoluteExpiresAt !== undefined &&
      Date.parse(legacy.absoluteExpiresAt) < Date.parse(requestedExpiresAt)
        ? legacy.absoluteExpiresAt
        : requestedExpiresAt
    const session: SubmitterSession = {
      id: crypto.randomUUID(),
      kind: 'submitter',
      contactId,
      eventId,
      capability,
      tokenHash: await this.#hasher.hash(token),
      expiresAt,
      consumedAt: null,
      createdAt: legacy?.createdAt ?? now,
      provenance,
    }
    return { token, expiresAt, session }
  }
}
