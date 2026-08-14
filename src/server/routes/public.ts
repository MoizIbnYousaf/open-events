import { Hono } from 'hono'

import type { SaveDraftInput } from '../../application/dtos/draft.dto'
import type { StartInput } from '../../application/dtos/session.dto'
import {
  toOwnSubmissionListItemDto,
  type CoSpeakerInput,
  type SubmitInput,
} from '../../application/dtos/submission.dto'
import type { SubmitEvaluationInput } from '../../application/services/evaluations'
import {
  DOCUMENT_MAX_BYTES,
  DocumentEmptyError,
  DocumentFileNameError,
  DocumentTooLargeError,
  DocumentUnsupportedTypeError,
} from '../../application/services/documents'
import {
  HEADSHOT_MAX_BYTES,
  HeadshotEmptyError,
  HeadshotTooLargeError,
  HeadshotUnsupportedTypeError,
} from '../../application/services/headshots'
import type { AnswerMap, SubmissionOutcome } from '../../domain'
import {
  requireActor,
  requireSession,
  requireSubmitter,
  readSessionToken,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
  sessionCookieMaxAgeSeconds,
} from '../auth'
import { depsFromContext } from '../container'
import { csrfGate } from '../csrf'
import type { ServerContext, ServerEnv } from '../env'
import { databaseUnavailableResponse, getTtlConfig, storageUnavailableResponse } from '../env'
import {
  forbiddenResponse,
  notFoundResponse,
  toErrorResponse,
  validationFailedResponse,
} from '../error'
import { handleHealth } from '../health'
import { handleGetEvent } from './events'
import {
  handleGetPublicIcs,
  handleGetPublicSchedule,
  handleGetPublicSpeaker,
  handleGetPublicSpeakerHeadshot,
  handleGetPublicSpeakers,
} from './schedule'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJsonBody(context: ServerContext): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await context.req.json()
    return isRecord(body) ? body : null
  } catch {
    return null
  }
}

function isCoSpeakerInput(value: unknown): boolean {
  return isRecord(value) && typeof value.name === 'string' && typeof value.email === 'string'
}

/** POST /api/public/start: generic 202, never a link or token. */
export async function handleStart(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const email = body.email
  const eventSlug = body.eventSlug
  const formSlug = body.formSlug
  if (typeof email !== 'string' || typeof eventSlug !== 'string' || typeof formSlug !== 'string') {
    return validationFailedResponse(context)
  }
  const input: StartInput = { email, eventSlug, formSlug }
  const ttlMs = getTtlConfig(context).submitterTokenMs
  const linkBuilder = (token: string, _path: string): string => {
    void _path
    return `/api/public/session?token=${encodeURIComponent(token)}`
  }
  const result = await deps.session.startSubmitter(input, ttlMs, linkBuilder)
  return context.json(result, 202)
}

/** GET /api/public/session?token=: 303 to the trusted two-segment path. */
export async function handleSessionExchange(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const token = context.req.query('token')
  if (token === undefined || token.length === 0) return validationFailedResponse(context)
  const ttlMs = getTtlConfig(context).submitterSessionMs
  const result = await deps.session.redeemSubmitterToken(token, ttlMs)
  // A committee member signing in came to review, not to write a proposal.
  // The CFP form is the right landing for everyone else, so the destination is
  // decided from who they are rather than from which link they happened to
  // follow — the redeemed identity is already proven at this point.
  const onCommittee = await deps.evaluations.isOnCommittee(result.eventId, result.contactId)
  const destination = onCommittee ? '/evaluations' : result.redirectPath
  const secure = new URL(context.req.url).protocol === 'https:'
  const maxAge = sessionCookieMaxAgeSeconds(result.expiresAt, deps.clock.now())
  return new Response(null, {
    status: 303,
    headers: {
      Location: destination,
      'Set-Cookie': serializeSessionCookie(result.token, maxAge, secure),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

/** DELETE /api/session: revoke the active session and expire its browser cookie. */
export async function handleSessionLogout(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const token = readSessionToken(context)
  if (token !== null) await deps.session.revokeSession(token)
  const secure = new URL(context.req.url).protocol === 'https:'
  return new Response(null, {
    status: 204,
    headers: {
      'Set-Cookie': serializeExpiredSessionCookie(secure),
      'Cache-Control': 'no-store',
    },
  })
}

/** GET /api/public/cfp/:eventSlug/:formSlug: published definition only. */
export async function handleGetPublishedCfp(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const eventSlug = context.req.param('eventSlug')
  const formSlug = context.req.param('formSlug')
  if (eventSlug === undefined || formSlug === undefined) return notFoundResponse(context)
  const definition = await deps.formBuilder.getPublishedByEventSlug(eventSlug, formSlug)
  return definition === null ? notFoundResponse(context) : context.json(definition)
}

/** GET /api/public/draft?formId=: active draft for the session actor. */
export async function handleGetActiveDraft(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const formId = context.req.query('formId')
  if (formId === undefined || formId.length === 0) return validationFailedResponse(context)
  const draft = await deps.drafts.getActiveDraft(actor, formId)
  return draft === null ? notFoundResponse(context) : context.json(draft)
}

/** GET /api/public/draft/:id: own draft only. */
export async function handleGetDraft(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const draftId = context.req.param('id')
  if (draftId === undefined) return notFoundResponse(context)
  const draft = await deps.drafts.get(actor, draftId)
  return draft === null ? notFoundResponse(context) : context.json(draft)
}

/** PUT /api/public/draft: actor-scoped save; owner/event come from the session. */
export async function handleSaveDraft(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const id = body.id
  const formId = body.formId
  const formVersionId = body.formVersionId
  const title = body.title
  const answers = body.answers
  if (
    !(id === null || typeof id === 'string') ||
    typeof formId !== 'string' ||
    typeof formVersionId !== 'string' ||
    typeof title !== 'string' ||
    !isRecord(answers)
  ) {
    return validationFailedResponse(context)
  }
  const input: SaveDraftInput = {
    id,
    formId,
    formVersionId,
    title,
    answers: answers as AnswerMap,
  }
  const draft = await deps.drafts.save(actor, input)
  return context.json(draft)
}

/** POST /api/public/submit: idempotent, actor-scoped, gate outcomes -> 409. */
export async function handleSubmit(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const originDraftId = body.originDraftId
  const formVersionId = body.formVersionId
  const title = body.title
  const answers = body.answers
  const coSpeakers = body.coSpeakers
  if (
    typeof originDraftId !== 'string' ||
    typeof formVersionId !== 'string' ||
    typeof title !== 'string' ||
    !isRecord(answers) ||
    !Array.isArray(coSpeakers) ||
    !coSpeakers.every(isCoSpeakerInput)
  ) {
    return validationFailedResponse(context)
  }
  const input: SubmitInput = {
    originDraftId,
    formVersionId,
    title,
    answers: answers as AnswerMap,
    coSpeakers: coSpeakers as CoSpeakerInput[],
  }
  const submission = await deps.submit.submit(actor, input)
  return context.json(submission)
}

/** GET /api/public/submission/:id: own submission only. */
export async function handleGetOwnSubmission(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const submissionId = context.req.param('id')
  if (submissionId === undefined) return notFoundResponse(context)
  const submission = await deps.submit.getOwnDetail(actor, submissionId)
  return submission === null ? notFoundResponse(context) : context.json(submission)
}

/**
 * PUT /api/public/submission/:id — a submitter revising their own proposal while
 * the call is open. Every gate lives in the service: ownership, event scope, the
 * published form's validation, and the window.
 */
export async function handleEditOwnSubmission(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const submissionId = context.req.param('id')
  if (submissionId === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const title = body.title
  const answers = body.answers
  if (typeof title !== 'string' || !isRecord(answers)) return validationFailedResponse(context)
  const detail = await deps.submit.editOwn(actor, submissionId, {
    title,
    answers: answers as AnswerMap,
  })
  return context.json(detail)
}

/**
 * GET /api/public/submissions: the session speaker's own submissions, each
 * carrying the programme's verdict. The persisted status can only ever be
 * 'pending', so the decision record — read back through the actor-scoped
 * onboarding read — is the only thing that can tell an accepted proposal from
 * a rejected one from one still under review. The DTO drops the organizer-only
 * routing outcome, and `inviteAvailable` tells the portal whether the .ics can
 * actually be rendered for this event right now.
 */
export async function handleListOwnSubmissions(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const submissions = await deps.submit.listOwn(actor)
  const decisions = await deps.onboarding.listOwnDecisions(actor)
  const inviteAvailable = await deps.communications.isInviteAvailable(actor)
  return context.json({
    submissions: submissions.map((submission) => {
      const decision = decisions.get(submission.id) ?? null
      // `listOwnDecisions` already folds the legacy acceptance backfill in, so
      // anything still missing here is genuinely undecided.
      const outcome: SubmissionOutcome = decision?.outcome ?? 'pending'
      return toOwnSubmissionListItemDto(
        submission,
        outcome,
        decision?.decidedAt ?? null,
        outcome === 'accepted' && inviteAvailable,
      )
    }),
  })
}

/** GET /api/public/tasks: the calling speaker own onboarding checklist. */
export async function handleListSpeakerTasks(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const tasks = await deps.onboarding.listTasks(actor)
  return context.json(tasks)
}

/**
 * POST /api/public/tasks/:id/complete: idempotent own-task completion. A form
 * task requires an `{ answers }` body validated against its pinned published
 * version; checklist tasks take no body.
 */
export async function handleCompleteSpeakerTask(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const taskId = context.req.param('id')
  if (taskId === undefined) return notFoundResponse(context)
  let answers: AnswerMap | undefined
  if (context.req.header('content-type')?.includes('application/json') === true) {
    // Clients routinely declare JSON with an EMPTY body for the bare
    // checklist completion; only a non-empty body must parse.
    const raw = await context.req.text()
    if (raw.trim().length > 0) {
      let body: unknown
      try {
        body = JSON.parse(raw)
      } catch {
        return validationFailedResponse(context)
      }
      const candidate = (body as { answers?: unknown } | null)?.answers
      if (candidate !== undefined) {
        if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
          return validationFailedResponse(context)
        }
        answers = candidate as AnswerMap
      }
    }
  }
  const task = await deps.onboarding.completeTask(actor, taskId, answers)
  return context.json(task)
}

/** GET /api/public/tasks/:id/form: the published definition behind one own form task. */
export async function handleGetSpeakerTaskForm(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const taskId = context.req.param('id')
  if (taskId === undefined) return notFoundResponse(context)
  const definition = await deps.onboarding.getFormTaskDefinition(actor, taskId)
  return context.json(definition)
}

/**
 * GET /api/public/evaluations: a JSON array of the calling evaluator's rows,
 * one per assigned submission. A session contact with no assignment in the
 * event is forbidden — the surface belongs to the review committee only.
 */
export async function handleListOwnEvaluations(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  return context.json(await deps.evaluations.listOwnEvaluations(actor))
}

/**
 * POST /api/public/evaluations: idempotent upsert of one rating on one
 * assigned submission. The evaluator identity comes from the session, the
 * criterion from the event's default, and the round from the assignment.
 */
export async function handleSubmitEvaluation(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const submissionId = body.submissionId
  const rating = body.rating
  const comments = body.comments
  const answers = body.answers
  const roundId = body.roundId
  if (typeof submissionId !== 'string') return validationFailedResponse(context)
  // Which round is being answered. Optional, because a reviewer holding one
  // round has only ever meant that round; required in practice the moment they
  // hold two, since the submission alone no longer says which form this is.
  if (roundId !== undefined && typeof roundId !== 'string') {
    return validationFailedResponse(context)
  }
  // TWO SHAPES, because a round decides which it asks for: a typed scorecard
  // sends `answers`, and a round without one sends the single `rating` it
  // always did. Exactly one must be present — a body carrying neither is not a
  // review, and the service decides which the round actually accepts.
  const hasAnswers = Array.isArray(answers)
  if (!hasAnswers && typeof rating !== 'number') return validationFailedResponse(context)
  if (
    hasAnswers &&
    !answers.every(
      (answer) => isRecord(answer) && typeof answer.criterionId === 'string' && 'value' in answer,
    )
  ) {
    return validationFailedResponse(context)
  }
  if (comments !== undefined && comments !== null && typeof comments !== 'string') {
    return validationFailedResponse(context)
  }
  // `comments` is a partial update: an absent key leaves the stored
  // justification alone, an explicit null or empty string clears it. Forwarding
  // an absent key as null would let a rating-only edit erase what the evaluator
  // wrote without ever showing it to them.
  const input: SubmitEvaluationInput = {
    submissionId,
    ...(typeof roundId === 'string' ? { roundId } : {}),
    ...(typeof rating === 'number' ? { rating } : {}),
    ...(hasAnswers
      ? { answers: answers as readonly { criterionId: string; value: unknown }[] }
      : {}),
    ...('comments' in body ? { comments: comments as string | null } : {}),
  }
  return context.json(await deps.evaluations.upsertScore(actor, input))
}

/**
 * POST /api/public/evaluations/recuse: the reviewer declares a conflict of
 * interest and stops being asked about one proposal.
 */
export async function handleRecuseEvaluation(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const submissionId = body.submissionId
  const roundId = body.roundId
  if (typeof submissionId !== 'string') return validationFailedResponse(context)
  if (roundId !== undefined && typeof roundId !== 'string') {
    return validationFailedResponse(context)
  }
  await deps.evaluations.recuse(actor, {
    submissionId,
    ...(typeof roundId === 'string' ? { roundId } : {}),
  })
  return context.body(null, 204)
}

/** True when the client declares a body that already exceeds the budget. */
function declaresOversizeBody(contentLength: string | undefined): boolean {
  if (contentLength === undefined) return false
  const declared = Number(contentLength)
  return Number.isFinite(declared) && declared > HEADSHOT_MAX_BYTES
}

/**
 * Reads at most `maxBytes` from the request body and returns null the moment
 * the stream goes over budget, cancelling the rest. An undeclared (or lying)
 * oversize body is therefore denied without ever being materialised in full,
 * so the isolate never buffers more than the frozen upload budget.
 */
async function readCappedBody(request: Request, maxBytes: number): Promise<ArrayBuffer | null> {
  const body = request.body
  if (body === null) return new ArrayBuffer(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged.buffer
}

/**
 * PUT /api/public/profile/headshot: owner-scoped binary upload. The declared
 * content type must be one of the frozen image types (415) and the body must
 * fit the frozen size budget (413) and be non-empty (400); all three are
 * rejected before any object or metadata write happens. Oversize denial is
 * cheap: a declared over-budget `content-length` short-circuits and the body
 * read itself is capped, so the isolate never buffers an oversize upload. The
 * storage key is derived from the session actor, never from the request.
 */
export async function handlePutOwnHeadshot(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  if (deps.headshots === null) return storageUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const contentType = (context.req.header('content-type') ?? '').split(';')[0]?.trim() ?? ''
  if (declaresOversizeBody(context.req.header('content-length'))) {
    return toErrorResponse(context, 'validation_failed', 413)
  }
  const bytes = await readCappedBody(context.req.raw, HEADSHOT_MAX_BYTES)
  if (bytes === null) return toErrorResponse(context, 'validation_failed', 413)
  try {
    const stored = await deps.headshots.storeHeadshot(actor, { contentType, bytes })
    return context.json(stored)
  } catch (error) {
    if (error instanceof HeadshotUnsupportedTypeError) {
      return toErrorResponse(context, 'validation_failed', 415)
    }
    if (error instanceof HeadshotTooLargeError) {
      return toErrorResponse(context, 'validation_failed', 413)
    }
    if (error instanceof HeadshotEmptyError) {
      return validationFailedResponse(context)
    }
    throw error
  }
}

/**
 * PUT /api/public/profile/document: owner-scoped supporting-document upload
 * (REQ-007). Same discipline as the headshot: allow-list (415), size budget
 * (413), non-empty (400), all before any write. The display name arrives in
 * the explicit `x-file-name` header and is validated as a bounded plain
 * label — never interpreted as a path.
 */
export async function handlePutOwnDocument(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  if (deps.documents === null) return storageUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const contentType = (context.req.header('content-type') ?? '').split(';')[0]?.trim() ?? ''
  const fileName = context.req.header('x-file-name') ?? ''
  const declared = context.req.header('content-length')
  if (declared !== undefined) {
    const parsed = Number(declared)
    if (Number.isFinite(parsed) && parsed > DOCUMENT_MAX_BYTES) {
      return toErrorResponse(context, 'validation_failed', 413)
    }
  }
  const bytes = await readCappedBody(context.req.raw, DOCUMENT_MAX_BYTES)
  if (bytes === null) return toErrorResponse(context, 'validation_failed', 413)
  try {
    const stored = await deps.documents.storeDocument(actor, { contentType, bytes, fileName })
    return context.json(stored)
  } catch (error) {
    if (error instanceof DocumentUnsupportedTypeError) {
      return toErrorResponse(context, 'validation_failed', 415)
    }
    if (error instanceof DocumentTooLargeError) {
      return toErrorResponse(context, 'validation_failed', 413)
    }
    if (error instanceof DocumentEmptyError || error instanceof DocumentFileNameError) {
      return validationFailedResponse(context)
    }
    throw error
  }
}

/** GET /api/public/profile/document: own bytes only; anything else is a 404. */
export async function handleGetOwnDocument(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  if (deps.documents === null) return storageUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const document = await deps.documents.getOwnDocument(actor)
  if (document === null) return notFoundResponse(context)
  return new Response(document.body, {
    status: 200,
    headers: {
      'Content-Type': document.contentType,
      'Content-Length': String(document.sizeBytes),
      'Cache-Control': 'no-store',
    },
  })
}

/** GET /api/public/profile/headshot: own bytes only; anything else is a 404. */
/** GET /api/public/profile: the calling speaker's own name/email/bio. */
export async function handleGetOwnProfile(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  return context.json(await deps.profile.getOwnProfile(actor))
}

/**
 * PUT /api/public/profile: strict body — exactly `name` (string) and `bio`
 * (string or null). Unknown fields, including any attempt to write the
 * read-only email, are a validation failure.
 */
export async function handlePutOwnProfile(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  let body: unknown
  try {
    body = await context.req.json()
  } catch {
    return validationFailedResponse(context)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return validationFailedResponse(context)
  }
  const record = body as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const validShape =
    (keys.join(',') === 'bio,name' || keys.join(',') === 'name') &&
    typeof record.name === 'string' &&
    (record.bio === undefined || record.bio === null || typeof record.bio === 'string')
  if (!validShape) return validationFailedResponse(context)
  const profile = await deps.profile.updateOwnProfile(actor, {
    name: record.name as string,
    bio: (record.bio ?? null) as string | null,
  })
  return context.json(profile)
}

export async function handleGetOwnHeadshot(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  if (deps.headshots === null) return storageUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const headshot = await deps.headshots.getOwnHeadshot(actor)
  if (headshot === null) return notFoundResponse(context)
  return new Response(headshot.body, {
    status: 200,
    headers: {
      'Content-Type': headshot.contentType,
      'Content-Length': String(headshot.sizeBytes),
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/**
 * GET /api/public/invite/:file — `<submissionId>.ics` for the OWNING submitter
 * only. Non-owned, cross-event and unknown ids are indistinguishable 404s.
 */
export async function handleGetInvite(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const file = context.req.param('file')
  if (file === undefined || !file.endsWith('.ics')) return notFoundResponse(context)
  const submissionId = file.slice(0, -'.ics'.length)
  if (submissionId.length === 0) return notFoundResponse(context)
  const invite = await deps.communications.buildInvite(actor, submissionId)
  if (invite === null) return notFoundResponse(context)
  return new Response(invite, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="submission-${submissionId}.ics"`,
      'Cache-Control': 'no-store',
    },
  })
}

export async function handleListOwnAssignments(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  return context.json(await deps.assignments.listMine(actor))
}

export async function handleAddOwnFileComment(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const kind = context.req.param('kind')
  if (kind !== 'document' && kind !== 'headshot') return validationFailedResponse(context)
  const body = await readJsonBody(context)
  if (body === null || typeof body.body !== 'string') return validationFailedResponse(context)
  const event = await deps.events.findById(actor.eventId)
  if (event === null) return notFoundResponse(context)
  const contact = await deps.contacts.findById(actor.contactId)
  return context.json(
    await deps.contentLibrary.addComment({ kind: 'organizer' } as never, event.slug, {
      ownerContactId: actor.contactId,
      kind,
      authorName: contact?.name || 'Speaker',
      body: body.body,
    }),
    201,
  )
}

export async function handleListOwnFileVersions(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const kind = context.req.param('kind')
  if (kind !== 'document' && kind !== 'headshot') return validationFailedResponse(context)
  const event = await deps.events.findById(actor.eventId)
  if (event === null) return notFoundResponse(context)
  return context.json(
    await deps.contentLibrary.listVersions(
      { kind: 'organizer' } as never,
      event.slug,
      actor.contactId,
      kind,
    ),
  )
}

export async function handleListOwnFileComments(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const kind = context.req.param('kind')
  if (kind !== 'document' && kind !== 'headshot') return validationFailedResponse(context)
  const event = await deps.events.findById(actor.eventId)
  if (event === null) return notFoundResponse(context)
  return context.json(
    await deps.contentLibrary.listComments(
      { kind: 'organizer' } as never,
      event.slug,
      actor.contactId,
      kind,
    ),
  )
}

export async function handleCompleteOwnAssignment(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const id = context.req.param('id')
  if (id === undefined) return notFoundResponse(context)
  return context.json(await deps.assignments.completeMine(actor, id))
}

export async function handleGetPublicEmbed(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const embedId = context.req.param('embedId')
  if (embedId === undefined) return notFoundResponse(context)
  const embed = await deps.embeds.getPublic(embedId)
  if (embed === null) return notFoundResponse(context)
  const event = await deps.events.findById(embed.eventId)
  if (event === null) return notFoundResponse(context)
  const scheduleResponse = await handleGetPublicSchedule(
    Object.assign(context, {
      req: {
        ...context.req,
        param: (name: string) => (name === 'slug' ? event.slug : context.req.param(name)),
      },
    }) as ServerContext,
  )
  void scheduleResponse
  const origin = new URL(context.req.url).origin
  const dataUrl = `${origin}/api/public/events/${event.slug}/schedule`
  const speakersUrl = `${origin}/api/public/events/${event.slug}/speakers`
  if (embed.format === 'json') {
    const schedule = await fetchSchedule(context, event.slug)
    return context.json({ embed, schedule })
  }
  if (embed.format === 'xml') {
    const schedule = await fetchSchedule(context, event.slug)
    const xml = `<embed kind="${embed.kind}"><sessions>${schedule.sessions
      .map(
        (session) =>
          `<session><title>${escapeXml(session.title)}</title><track>${escapeXml(session.track)}</track><room>${escapeXml(session.room)}</room></session>`,
      )
      .join('')}</sessions></embed>`
    return new Response(xml, { status: 200, headers: { 'content-type': 'application/xml' } })
  }
  if (embed.format === 'ical') {
    return handleGetPublicIcs(
      Object.assign(context, {
        req: {
          ...context.req,
          param: (name: string) => (name === 'slug' ? event.slug : context.req.param(name)),
        },
      }) as ServerContext,
    )
  }
  return context.json({ embed, dataUrl, speakersUrl })
}

export async function handleRenderEmbed(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const embedId = context.req.param('embedId')
  if (embedId === undefined) return notFoundResponse(context)
  const embed = await deps.embeds.getPublic(embedId)
  if (embed === null) return notFoundResponse(context)
  const event = await deps.events.findById(embed.eventId)
  if (event === null) return notFoundResponse(context)
  const origin = new URL(context.req.url).origin
  const scheduleUrl = `${origin}/api/public/events/${encodeURIComponent(event.slug)}/schedule`
  const speakersUrl = `${origin}/api/public/events/${encodeURIComponent(event.slug)}/speakers`
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeXml(embed.name)}</title>
<style>
body{font-family:Inter,system-ui,sans-serif;margin:0;background:#080808;color:#fcfcfc}
main{max-width:720px;margin:0 auto;padding:16px}
h1{font-size:20px;font-weight:500}
input,select{background:#121212;color:#fcfcfc;border:1px solid rgba(255,255,255,.09);padding:8px;border-radius:8px;width:100%;margin:8px 0}
.card{border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:12px;margin:8px 0;background:#121212}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.muted{color:#929292;font-size:13px}
.tag{display:inline-block;border:1px solid rgba(255,255,255,.09);border-radius:999px;padding:2px 8px;font-size:12px;margin-right:4px}
button{background:${embed.brandColor || '#1A72CD'};color:#fff;border:0;border-radius:8px;padding:6px 10px}
</style></head>
<body><main>
<h1>${escapeXml(embed.name)}</h1>
<p class="muted">${escapeXml(embed.kind)} · ${escapeXml(event.name)}</p>
<div id="app">Loading…</div>
<script>
const KIND=${safeJsonScript(embed.kind)};
const TRACK=${safeJsonScript(embed.trackFilter)};
function text(el, value){ el.textContent = value == null ? '' : String(value); }
function el(tag, className){ const node = document.createElement(tag); if (className) node.className = className; return node; }
async function load(){
  const schedule = await (await fetch(${safeJsonScript(scheduleUrl)})).json();
  const speakers = await (await fetch(${safeJsonScript(speakersUrl)})).json();
  let sessions = schedule.sessions || [];
  if (TRACK) sessions = sessions.filter(s => s.track === TRACK);
  const root = document.getElementById('app');
  root.replaceChildren();
  const search = el('input');
  search.id = 'q';
  const list = el('div', KIND === 'gallery' ? 'grid' : '');
  list.id = 'list';
  if (KIND === 'speakers' || KIND === 'gallery') {
    search.placeholder = 'Search speakers';
    root.append(search, list);
    const people = speakers.speakers || [];
    const draw = (q='') => {
      list.replaceChildren();
      for (const p of people.filter(person => person.name.toLowerCase().includes(q.toLowerCase()))) {
        const card = el('div', 'card');
        const name = el('strong'); text(name, p.name);
        const meta = el('div', 'muted'); text(meta, (p.jobTitle||'') + ' · ' + (p.company||''));
        const bio = el('p'); text(bio, p.bio||'');
        card.append(name, meta, bio);
        list.append(card);
      }
    };
    draw();
    search.addEventListener('input', e => draw(e.target.value));
    return;
  }
  search.placeholder = 'Search sessions';
  root.append(search, list);
  const draw = (q='') => {
    list.replaceChildren();
    for (const s of sessions.filter(session => (session.title+' '+(session.speakers||[]).join(' ')).toLowerCase().includes(q.toLowerCase()))) {
      const card = el('div', 'card');
      const track = el('span', 'tag'); text(track, s.track||'');
      const format = el('span', 'tag'); text(format, s.format||'');
      const title = el('h2'); text(title, s.title);
      const when = el('div', 'muted'); text(when, s.day+' '+s.start+' · '+s.room);
      const desc = el('p'); text(desc, s.description||'');
      const who = el('div', 'muted'); text(who, (s.speakers||[]).join(', '));
      card.append(track, format, title, when, desc, who);
      list.append(card);
    }
  };
  draw();
  search.addEventListener('input', e => draw(e.target.value));
}
load();
</script>
</main></body></html>`
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' },
  })
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function safeJsonScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

async function fetchSchedule(
  context: ServerContext,
  slug: string,
): Promise<{
  sessions: Array<{ title: string; track: string; room: string }>
}> {
  const cloned = {
    ...context,
    req: {
      ...context.req,
      param: (name: string) => (name === 'slug' ? slug : context.req.param(name)),
    },
  } as ServerContext
  const response = await handleGetPublicSchedule(cloned)
  return (await response.json()) as {
    sessions: Array<{ title: string; track: string; room: string }>
  }
}

/** Registers the public surface; CSRF runs before session validation on mutations. */
export function registerPublicRoutes(app: Hono<ServerEnv>): void {
  app.get('/api/health', handleHealth)
  app.get('/api/events/:slug', handleGetEvent)

  app.post('/api/public/start', handleStart)
  app.get('/api/public/session', handleSessionExchange)
  app.delete('/api/session', csrfGate(), handleSessionLogout)
  app.get('/api/public/cfp/:eventSlug/:formSlug', handleGetPublishedCfp)
  app.get('/api/public/events/:slug/schedule', handleGetPublicSchedule)
  app.get('/api/public/events/:slug/schedule.ics', handleGetPublicIcs)
  app.get('/api/public/events/:slug/speakers', handleGetPublicSpeakers)
  app.get('/api/public/events/:slug/speakers/:contactId/headshot', handleGetPublicSpeakerHeadshot)
  app.get('/api/public/events/:slug/speakers/:contactId', handleGetPublicSpeaker)
  app.get('/api/public/embeds/:embedId', handleGetPublicEmbed)
  app.get('/embed/:embedId', handleRenderEmbed)
  app.get(
    '/api/public/assignments',
    requireSession(),
    requireActor('submitter'),
    handleListOwnAssignments,
  )
  app.post(
    '/api/public/assignments/:id/complete',
    csrfGate(),
    requireSession(),
    requireActor('submitter'),
    handleCompleteOwnAssignment,
  )
  app.post(
    '/api/public/files/:kind/comments',
    csrfGate(),
    requireSession(),
    requireActor('submitter'),
    handleAddOwnFileComment,
  )
  app.get(
    '/api/public/files/:kind/comments',
    requireSession(),
    requireActor('submitter'),
    handleListOwnFileComments,
  )
  app.get(
    '/api/public/files/:kind/versions',
    requireSession(),
    requireActor('submitter'),
    handleListOwnFileVersions,
  )

  app.get('/api/public/draft', requireSession(), requireActor('submitter'), handleGetActiveDraft)
  app.get('/api/public/draft/:id', requireSession(), requireActor('submitter'), handleGetDraft)
  app.put(
    '/api/public/draft',
    csrfGate(),
    requireSession(),
    requireActor('submitter'),
    handleSaveDraft,
  )
  app.post(
    '/api/public/submit',
    csrfGate(),
    requireSession(),
    requireActor('submitter'),
    handleSubmit,
  )
  app.get('/api/public/tasks', requireSession(), requireActor('submitter'), handleListSpeakerTasks)
  app.get(
    '/api/public/tasks/:id/form',
    requireSession(),
    requireActor('submitter'),
    handleGetSpeakerTaskForm,
  )
  app.post(
    '/api/public/tasks/:id/complete',
    csrfGate(),
    requireSession(),
    requireActor('submitter'),
    handleCompleteSpeakerTask,
  )
  app.get(
    '/api/public/submissions',
    requireSession(),
    requireActor('submitter'),
    handleListOwnSubmissions,
  )
  app.get(
    '/api/public/evaluations',
    requireSession(),
    requireActor('submitter'),
    handleListOwnEvaluations,
  )
  app.post(
    '/api/public/evaluations',
    csrfGate(),
    requireSession(),
    requireActor('submitter'),
    handleSubmitEvaluation,
  )
  app.post(
    '/api/public/evaluations/recuse',
    csrfGate(),
    requireSession(),
    requireActor('submitter'),
    handleRecuseEvaluation,
  )

  app.put(
    '/api/public/profile/document',
    csrfGate(),
    requireSession(),
    requireActor('submitter'),
    handlePutOwnDocument,
  )
  app.get(
    '/api/public/profile/document',
    requireSession(),
    requireActor('submitter'),
    handleGetOwnDocument,
  )
  app.get('/api/public/profile', requireSession(), requireActor('submitter'), handleGetOwnProfile)
  app.put(
    '/api/public/profile',
    csrfGate(),
    requireSession(),
    requireActor('submitter'),
    handlePutOwnProfile,
  )
  app.put(
    '/api/public/profile/headshot',
    csrfGate(),
    requireSession(),
    requireActor('submitter'),
    handlePutOwnHeadshot,
  )
  app.get(
    '/api/public/profile/headshot',
    requireSession(),
    requireActor('submitter'),
    handleGetOwnHeadshot,
  )

  app.get('/api/public/invite/:file', requireSession(), requireActor('submitter'), handleGetInvite)
  app.get(
    '/api/public/submission/:id',
    requireSession(),
    requireActor('submitter'),
    handleGetOwnSubmission,
  )
  app.put(
    // Same path as the GET above: a proposal is one resource, and an edit that
    // lived at a different URL from its read would be two.
    '/api/public/submission/:id',
    csrfGate(),
    requireSession(),
    requireActor('submitter'),
    handleEditOwnSubmission,
  )
}
