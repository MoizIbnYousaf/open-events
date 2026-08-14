import type { Event, EventSlug, SubmissionId, TaxonomyItem } from '../../domain'
import { isValidUtcInstant } from '../../domain/invariants/time.ts'
import {
  buildAgendaAggregates,
  buildAgendaGrid,
  proposeAgendaPlacements,
  deriveReq014Views,
  findAgendaConflicts,
  isAgendaDay,
  isPlaceableSlot,
  latestAgendaEnd,
  placeSessions,
  transitionAgendaStatus,
  transitionSessionAssignment,
  type AgendaPlacement,
  type AgendaSessionInput,
} from '../../domain/agenda'
import type { OrganizerActor } from '../actors'
import type {
  AgendaBoardDto,
  AgendaAutoPlaceResultDto,
  AgendaPublishResultDto,
  AgendaSessionDto,
  PlaceAgendaSessionInput,
} from '../dtos/agenda.dto'
import { toAgendaOptionDto } from '../dtos/agenda.dto'
import { ApplicationError } from '../errors'
import type { AgendaRepository, AgendaSessionRecord } from '../ports/agenda-repository'
import type { Clock } from '../ports/clock'
import type { EventRepository } from '../ports/event-repository'
import type { SpeakerTaskRepository } from '../ports/speaker-task-repository'
import type { SubmissionRepository } from '../ports/submission-repository'
import type { TaxonomyRepository } from '../ports/taxonomy-repository'

function byPosition(left: TaxonomyItem, right: TaxonomyItem): number {
  return left.position - right.position || left.id.localeCompare(right.id)
}

/** Stored session as the domain's placement input; absent ids become empty. */
function toSessionInput(session: AgendaSessionRecord): AgendaSessionInput {
  return {
    submissionId: session.submissionId,
    eventId: session.eventId,
    trackId: session.trackId,
    roomId: session.roomId,
    day: session.day,
    start: session.start,
    end: session.end,
    status: session.status,
    speakerIds: session.speakerIds,
  }
}

/**
 * Organizer agenda: reads the placeable board, places one accepted submission,
 * moves the scheduled sessions to published so the public programme can render
 * them, and takes a single session back off that programme.
 *
 * The organizer actor carries no event id, so every operation derives the event
 * from the slug and then checks that predicate explicitly: the submission must
 * belong to THAT event and must carry an acceptance record. A submission from
 * another event — or one that was never accepted — is a safe not-found, never a
 * response that confirms the id exists somewhere else.
 */
export class AgendaService {
  readonly #events: EventRepository
  readonly #agenda: AgendaRepository
  readonly #submissions: SubmissionRepository
  readonly #taxonomies: TaxonomyRepository
  readonly #tasks: SpeakerTaskRepository
  readonly #clock: Clock

  constructor(
    events: EventRepository,
    agenda: AgendaRepository,
    submissions: SubmissionRepository,
    taxonomies: TaxonomyRepository,
    tasks: SpeakerTaskRepository,
    clock: Clock,
  ) {
    this.#events = events
    this.#agenda = agenda
    this.#submissions = submissions
    this.#taxonomies = taxonomies
    this.#tasks = tasks
    this.#clock = clock
  }

  /** The whole board for one event, or null when the slug names no event. */
  async getBoardBySlug(_actor: OrganizerActor, slug: EventSlug): Promise<AgendaBoardDto | null> {
    const event = await this.#events.findBySlug(slug)
    return event === null ? null : await this.#board(event)
  }

  /**
   * Places one accepted submission into a room and slot of its own event. The
   * position is the lowest free index inside that room+slot, so a repeated
   * placement is stable and two sessions sharing a slot never collide in
   * storage — they surface as a room conflict instead.
   */
  async place(
    _actor: OrganizerActor,
    slug: EventSlug,
    submissionId: SubmissionId,
    input: PlaceAgendaSessionInput,
  ): Promise<AgendaBoardDto> {
    const event = await this.#eventOrNotFound(slug)
    const [session, items] = await Promise.all([
      this.#placeableSession(event, submissionId),
      this.#taxonomies.listByEvent(event.id),
    ])
    const room = items.find((item) => item.id === input.roomId && item.kind === 'room')
    if (room === undefined) {
      throw new ApplicationError('validation_failed', 'The room is not a room of this event')
    }
    if (
      input.trackId !== null &&
      !items.some((item) => item.id === input.trackId && item.kind === 'track')
    ) {
      throw new ApplicationError('validation_failed', 'The track is not a track of this event')
    }
    if (
      !isValidUtcInstant(input.start) ||
      !isValidUtcInstant(input.end) ||
      input.end <= input.start
    ) {
      throw new ApplicationError('validation_failed', 'The slot needs a start before its end')
    }
    if (!isAgendaDay(input.day) || input.day !== input.start.slice(0, 10)) {
      throw new ApplicationError('validation_failed', 'The day must be the day the session starts')
    }
    // The end is bounded as well as the start: an unbounded end would hold its
    // room for years of days the organizer never placed it on, and would be
    // served verbatim on the public programme.
    if (input.end > latestAgendaEnd(input.day)) {
      throw new ApplicationError('validation_failed', 'The session must end on the day it starts')
    }
    // The one rule the grid is built from, enforced here as well. A day of the
    // event window is not the same thing as an hour of it: checking the
    // calendar date alone left the grid as the only thing keeping a placement
    // inside the window, so every writer that did not go through the grid —
    // the drag board, a direct API call — could put a session in hours the
    // event does not run.
    if (!isPlaceableSlot(event.dates, { day: input.day, start: input.start, end: input.end })) {
      throw new ApplicationError('validation_failed', 'The slot is outside the event window')
    }

    const siblings = await this.#agenda.listByEvent(event.id)
    const assignment =
      session.assignment === 'unassigned'
        ? transitionSessionAssignment('unassigned', 'scheduled')
        : session.assignment
    await this.#agenda.saveSession({
      ...session,
      trackId: input.trackId,
      roomId: room.id,
      day: input.day,
      start: input.start,
      end: input.end,
      position: nextFreePosition(siblings, session.submissionId, room.id, input),
      assignment,
      updatedAt: this.#clock.now(),
    })
    return await this.#board(event)
  }

  /**
   * Takes one session back off the schedule: it loses its room and position,
   * returns to the unplaced pool, and drops back to draft so the public
   * programme stops serving it. This is the way out of a publish — a speaker
   * who cancels after the programme went live is removed from it rather than
   * living on it forever. Retracting an already unplaced draft session changes
   * nothing, so the action is idempotent.
   */
  async unplace(
    _actor: OrganizerActor,
    slug: EventSlug,
    submissionId: SubmissionId,
  ): Promise<AgendaBoardDto> {
    const event = await this.#eventOrNotFound(slug)
    // `#existingSession`, not `#placeableSession`: taking a talk OFF the
    // programme is exactly what an organizer needs to do after rejecting it.
    const session = await this.#existingSession(event, submissionId)
    if (session.assignment === 'scheduled' || session.status === 'published') {
      await this.#agenda.saveSession({
        ...session,
        roomId: null,
        position: null,
        status:
          session.status === 'published'
            ? transitionAgendaStatus('published', 'draft')
            : session.status,
        assignment:
          session.assignment === 'scheduled'
            ? transitionSessionAssignment('scheduled', 'unassigned')
            : session.assignment,
        updatedAt: this.#clock.now(),
      })
    }
    return await this.#board(event)
  }

  /**
   * Moves every scheduled draft session of the event to published. Unplaced
   * sessions stay draft — a session with no room cannot appear on a programme —
   * and a repeated publish moves nothing, so the action is idempotent.
   */
  async publish(_actor: OrganizerActor, slug: EventSlug): Promise<AgendaPublishResultDto> {
    const event = await this.#eventOrNotFound(slug)
    const now = this.#clock.now()
    const [sessions, decisions] = await Promise.all([
      this.#agenda.listByEvent(event.id),
      this.#submissions.listDecisionsByEvent(event.id),
    ])
    // Publishing is the moment a session becomes public, so the rejection check
    // is repeated here rather than trusted from the board read: a talk rejected
    // between loading the board and pressing publish must not go out.
    const rejected = new Set(
      decisions
        .filter((decision) => decision.outcome === 'rejected')
        .map((decision) => decision.submissionId),
    )
    const publishable = sessions.filter(
      (session) =>
        session.assignment === 'scheduled' &&
        session.status === 'draft' &&
        !rejected.has(session.submissionId),
    )
    await Promise.all(
      publishable.map((session) =>
        this.#agenda.saveSession({
          ...session,
          status: transitionAgendaStatus('draft', 'published'),
          updatedAt: now,
        }),
      ),
    )
    return { publishedCount: publishable.length, board: await this.#board(event) }
  }

  /**
   * Places every unscheduled session the grid has room for, in one action.
   *
   * Assisted, not automatic, and the difference is the point: it proposes only
   * placements the organizer could have made by hand, refuses to create a
   * conflict, and leaves anything with nowhere legal to go unplaced and
   * counted. A fuller board carrying a double-booked speaker is worse than an
   * emptier one, because the schedule then has to be audited before it can be
   * trusted. Everything it does is an ordinary placement afterwards — movable,
   * removable, and indistinguishable from one an organizer dragged.
   */
  async autoPlace(_actor: OrganizerActor, slug: EventSlug): Promise<AgendaAutoPlaceResultDto> {
    const event = await this.#eventOrNotFound(slug)
    const [sessions, items, decisions] = await Promise.all([
      this.#agenda.listByEvent(event.id),
      this.#taxonomies.listByEvent(event.id),
      this.#submissions.listDecisionsByEvent(event.id),
    ])
    // A rejected talk is not scheduling work waiting to be done. Re-read here
    // rather than trusted from a board load, exactly as publish does.
    const rejected = new Set(
      decisions
        .filter((decision) => decision.outcome === 'rejected')
        .map((decision) => decision.submissionId),
    )
    const rooms = items.filter((item) => item.kind === 'room').map((item) => item.id)
    const placed = sessions
      .filter((session) => session.roomId !== null && !rejected.has(session.submissionId))
      .map((session) => ({
        submissionId: session.submissionId,
        eventId: event.id,
        trackId: session.trackId ?? '',
        roomId: session.roomId ?? '',
        day: session.day,
        start: session.start,
        end: session.end,
        position: session.position ?? 0,
        speakerIds: session.speakerIds,
      }))
    const unplaced = sessions
      .filter((session) => session.roomId === null && !rejected.has(session.submissionId))
      .map((session) => ({
        submissionId: session.submissionId,
        trackId: session.trackId,
        speakerIds: session.speakerIds,
      }))

    let roomIds = rooms
    if (roomIds.length === 0) {
      const nextPosition = items.reduce((max, item) => Math.max(max, item.position), -1) + 1
      const fallback: TaxonomyItem = {
        id: crypto.randomUUID(),
        eventId: event.id,
        kind: 'room',
        key: 'main-room',
        label: 'Main room',
        position: nextPosition,
      }
      await this.#taxonomies.replaceForEvent(event.id, [...items, fallback])
      roomIds = [fallback.id]
    }
    const proposals = [
      ...proposeAgendaPlacements(buildAgendaGrid(event.dates), event.id, roomIds, placed, unplaced),
    ]
    const proposedIds = new Set(proposals.map((proposal) => proposal.submissionId))
    const leftover = unplaced.filter((session) => !proposedIds.has(session.submissionId))
    const byId = new Map(sessions.map((session) => [session.submissionId, session]))
    const taken: AgendaPlacement[] = [...placed]
    for (const proposal of proposals) {
      taken.push({
        submissionId: proposal.submissionId,
        eventId: event.id,
        trackId: byId.get(proposal.submissionId)?.trackId ?? '',
        roomId: proposal.roomId,
        day: proposal.day,
        start: proposal.start,
        end: proposal.end,
        position: 0,
        speakerIds: byId.get(proposal.submissionId)?.speakerIds ?? [],
      })
    }
    for (const waiting of leftover) {
      const session = byId.get(waiting.submissionId)
      if (session === undefined) continue
      for (const roomId of roomIds) {
        const candidate: AgendaPlacement = {
          submissionId: session.submissionId,
          eventId: event.id,
          trackId: session.trackId ?? '',
          roomId,
          day: session.day,
          start: session.start,
          end: session.end,
          position: session.position ?? 0,
          speakerIds: session.speakerIds,
        }
        if (findAgendaConflicts([...taken, candidate]).length > 0) continue
        taken.push(candidate)
        proposals.push({
          submissionId: session.submissionId,
          day: session.day,
          start: session.start,
          end: session.end,
          roomId,
        })
        break
      }
    }
    const now = this.#clock.now()
    for (const proposal of proposals) {
      const session = byId.get(proposal.submissionId)
      if (session === undefined) continue
      await this.#agenda.saveSession({
        ...session,
        roomId: proposal.roomId,
        day: proposal.day,
        start: proposal.start,
        end: proposal.end,
        position: 0,
        assignment:
          session.assignment === 'unassigned'
            ? transitionSessionAssignment('unassigned', 'scheduled')
            : session.assignment,
        updatedAt: now,
      })
    }

    return {
      placedCount: proposals.length,
      // Named rather than left to subtraction: an organizer whose grid ran out
      // of room needs to be told some sessions are still waiting.
      remainingCount: unplaced.length - proposals.length,
      board: await this.#board(event),
    }
  }

  async #eventOrNotFound(slug: EventSlug): Promise<Event> {
    const event = await this.#events.findBySlug(slug)
    if (event === null) throw new ApplicationError('not_found', `Event '${slug}' not found`)
    return event
  }

  /**
   * The agenda row an organizer may touch at all: the submission has to belong
   * to this event, carry an acceptance record, and already have its session
   * materialised. Every miss is the same not-found.
   *
   * Deliberately says nothing about the verdict, because REMOVING something
   * from the programme must never depend on it. See `#placeableSession`.
   */
  async #existingSession(event: Event, submissionId: SubmissionId): Promise<AgendaSessionRecord> {
    const notFound = new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    const submission = await this.#submissions.findById(submissionId)
    if (submission === null || submission.eventId !== event.id) throw notFound
    if ((await this.#tasks.findAcceptance(event.id, submissionId)) === null) throw notFound
    const session = await this.#agenda.findBySubmission(event.id, submissionId)
    if (session === null) throw notFound
    return session
  }

  /**
   * The agenda row a PLACEMENT may touch: everything above, and not standing
   * rejected.
   *
   * The rejection check is separate from the acceptance check because the two
   * are separate facts: the acceptance row survives a later rejection on
   * purpose (speaker_tasks and this very session hang their foreign keys off
   * it), so 'has an acceptance record' does not mean 'is still in the
   * programme'. Without this an organizer could place a rejected talk into a
   * room and publish it to the PUBLIC schedule.
   *
   * It guards the way IN only. Retraction shares the row lookup but not this
   * check: when unplace also refused a rejected session, rejecting a published
   * talk made it permanently unretractable — the row stayed 'published' and
   * would have returned to the public schedule the moment the rejection was
   * reversed. A guard that blocks the remedy for the very state it describes is
   * pointed the wrong way.
   */
  async #placeableSession(event: Event, submissionId: SubmissionId): Promise<AgendaSessionRecord> {
    const session = await this.#existingSession(event, submissionId)
    const decision = await this.#submissions.findDecision(event.id, submissionId)
    if (decision !== null && decision.outcome === 'rejected') {
      throw new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    }
    return session
  }

  async #board(event: Event): Promise<AgendaBoardDto> {
    const [stored, acceptances, submissions, items, decisions] = await Promise.all([
      this.#agenda.listByEvent(event.id),
      this.#tasks.listAcceptancesByEvent(event.id),
      this.#submissions.listByEvent(event.id),
      this.#taxonomies.listByEvent(event.id),
      this.#submissions.listDecisionsByEvent(event.id),
    ])
    // An acceptance record is not a verdict: it outlives a rejection because
    // the checklist and this board's own rows point at it. A talk the organizer
    // has since rejected must leave the board — everything downstream, up to
    // and including the public programme, is built from this list.
    const rejected = new Set(
      decisions
        .filter((decision) => decision.outcome === 'rejected')
        .map((decision) => decision.submissionId),
    )
    const accepted = new Set(
      acceptances
        .map((acceptance) => acceptance.submissionId)
        .filter((submissionId) => !rejected.has(submissionId)),
    )
    const titles = new Map(submissions.map((submission) => [submission.id, submission.title]))
    const labels = new Map(items.map((item) => [item.id, item.label]))
    const sessions = stored.filter((session) => accepted.has(session.submissionId))

    // Conflicts and views cover the placed schedule: an unassigned session has
    // no room and sits on the placeholder slot acceptance gave it, so it is not
    // yet part of the programme the five views describe.
    const placements: readonly AgendaPlacement[] = placeSessions({
      sessions: sessions.reduce<AgendaSessionInput[]>((scheduled, session) => {
        if (session.assignment === 'scheduled' && session.roomId !== null) {
          scheduled.push(toSessionInput(session))
        }
        return scheduled
      }, []),
      rooms: [],
      tracks: [],
    })
    const grid = buildAgendaGrid(event.dates)

    return {
      eventId: event.id,
      slug: event.slug,
      timezone: event.timezone,
      days: grid.days,
      windowDays: grid.windowDays,
      rooms: items
        .filter((item) => item.kind === 'room')
        .sort(byPosition)
        .map(toAgendaOptionDto),
      tracks: items
        .filter((item) => item.kind === 'track')
        .sort(byPosition)
        .map(toAgendaOptionDto),
      sessions: sessions.map((session): AgendaSessionDto => ({
        submissionId: session.submissionId,
        title: titles.get(session.submissionId) ?? '',
        day: session.day,
        start: session.start,
        end: session.end,
        roomId: session.roomId,
        roomLabel: session.roomId === null ? null : (labels.get(session.roomId) ?? null),
        trackId: session.trackId,
        trackLabel: session.trackId === null ? null : (labels.get(session.trackId) ?? null),
        position: session.position,
        status: session.status,
        assignment: session.assignment,
      })),
      conflicts: findAgendaConflicts(placements),
      views: deriveReq014Views(buildAgendaAggregates(placements)),
    }
  }
}

/**
 * The lowest position not already taken inside one room+slot, ignoring the
 * session being placed. Re-placing a session into the slot it already occupies
 * keeps its position, and a slot with a gap reuses the gap instead of colliding
 * with the highest index.
 */
function nextFreePosition(
  siblings: readonly AgendaSessionRecord[],
  submissionId: SubmissionId,
  roomId: string,
  slot: { readonly day: string; readonly start: string; readonly end: string },
): number {
  const taken = new Set<number>()
  for (const sibling of siblings) {
    if (sibling.submissionId === submissionId) continue
    if (sibling.roomId !== roomId) continue
    if (sibling.day !== slot.day || sibling.start !== slot.start || sibling.end !== slot.end) {
      continue
    }
    if (sibling.position !== null) taken.add(sibling.position)
  }
  let position = 0
  while (taken.has(position)) position += 1
  return position
}
