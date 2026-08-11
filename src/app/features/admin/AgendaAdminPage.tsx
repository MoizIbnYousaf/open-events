import { Suspense, lazy, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import type {
  AgendaBoardDto,
  AgendaOptionDto,
  AgendaPublishResultDto,
  AgendaSessionDto,
  PlaceAgendaSessionInput,
} from '../../../application'
import type { SubmissionId } from '../../../domain'
import { DEFAULT_SESSION_MINUTES, type AgendaConflictKind } from '../../../domain/agenda'
import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { getApiErrorCode } from '../../api/admin-events'
import { placeAgendaSession, publishAgenda, unplaceAgendaSession } from '../../api/admin-agenda'
import { adminAgendaQueryKeys, useAgendaBoard } from '../../queries/admin-agenda'
import { DeniedState, ForbiddenState } from './AdminStates'
import {
  isBeyondListedDays,
  isOffWindowDay,
  offeredOptionId,
  placeableDays,
  slotInstants,
  slotsForDay,
  timeOfDay,
  unlistedWindowDays,
  unmetAgendaPreconditions,
  type AgendaPlacementRequest,
  type AgendaPreconditionId,
} from './agenda-board'

// dnd-kit is reachable only from here, and only through this dynamic import, so
// it stays out of the shell chunk and out of the agenda route chunk.
const AgendaDndBoard = lazy(() => import('./AgendaDndBoard'))

const CONFLICT_LABELS: Readonly<Record<AgendaConflictKind, string>> = {
  room: 'Room',
  speaker: 'Speaker',
  track: 'Track',
}

const selectClass =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring'

const linkClass = 'w-fit text-sm font-medium text-primary underline-offset-4 hover:underline'

// The board-day select is a singleton of the page, exactly like its own
// `agenda-board-day` id, so the notice that describes it can be one too.
const WINDOW_REACH_NOTICE_ID = 'agenda-board-window-reach'

function optionLabel(options: readonly { id: string; label: string }[], id: string): string {
  return options.find((option) => option.id === id)?.label ?? id
}

interface PlaceAgendaSessionVariables {
  readonly submissionId: SubmissionId
  readonly placement: PlaceAgendaSessionInput
}

/**
 * The board as the organizer would see it the moment the placement lands, used
 * while the request is in flight. Conflicts and views are left to the server
 * answer that replaces this board: they are derived from the whole schedule,
 * and guessing them here would show the organizer something that is not true.
 */
function withPlacement(
  board: AgendaBoardDto,
  variables: PlaceAgendaSessionVariables,
): AgendaBoardDto {
  const room = board.rooms.find((option) => option.id === variables.placement.roomId)
  const track = board.tracks.find((option) => option.id === variables.placement.trackId)
  return {
    ...board,
    sessions: board.sessions.map((session) =>
      session.submissionId === variables.submissionId
        ? {
            ...session,
            day: variables.placement.day,
            start: variables.placement.start,
            end: variables.placement.end,
            roomId: variables.placement.roomId,
            roomLabel: room?.label ?? null,
            trackId: variables.placement.trackId,
            trackLabel: track?.label ?? null,
            assignment: 'scheduled' as const,
          }
        : session,
    ),
  }
}

/**
 * What each unmet prerequisite says and where it is fixed. The three are
 * genuinely different situations — an event with no window, a window with no
 * room in it for a session, a taxonomy with no room in it — and an organizer
 * sent to the event settings to set dates that are already set has been told
 * something false. So the page prints the ones that are actually unmet, each
 * with the surface that resolves it, and nothing else.
 */
const PRECONDITION_COPY: Readonly<
  Record<
    AgendaPreconditionId,
    {
      readonly message: string
      readonly linkLabel: string
      readonly destination: 'event-settings' | 'taxonomies'
    }
  >
> = {
  'event-dates': {
    message: 'This event has no dates yet, so the board has no day to place a session on.',
    linkLabel: 'Set the event dates in the event settings',
    destination: 'event-settings',
  },
  'schedulable-time': {
    message: `The event dates are set, but the window is too short to hold a ${DEFAULT_SESSION_MINUTES}-minute session on any of its days, so no day offers a slot.`,
    linkLabel: 'Widen the event window in the event settings',
    destination: 'event-settings',
  },
  rooms: {
    message: 'This event has no rooms yet, so a session has nowhere to be placed.',
    linkLabel: 'Add a room in the taxonomy editor',
    destination: 'taxonomies',
  },
}

/** The route that fixes one prerequisite, as a link the organizer can follow. */
function PreconditionLink({
  precondition,
  eventSlug,
}: {
  readonly precondition: AgendaPreconditionId
  readonly eventSlug: string
}) {
  const copy = PRECONDITION_COPY[precondition]
  if (copy.destination === 'taxonomies') {
    return (
      <Link to="/admin/events/$slug/taxonomies" params={{ slug: eventSlug }} className={linkClass}>
        {copy.linkLabel}
      </Link>
    )
  }
  return (
    <Link to="/admin/events/$slug" params={{ slug: eventSlug }} className={linkClass}>
      {copy.linkLabel}
    </Link>
  )
}

interface AgendaAdminPageProps {
  readonly eventSlug: string
}

/**
 * Where the session sits, as the board can name it. Whether it is placed at all
 * is `assignment` and nothing else: a scheduled session is on the schedule, and
 * on the public programme once it is published, whether or not the board can
 * still name the room it holds. Saving the taxonomy replaces every room and mints
 * a fresh id for each, so a placement made before that save keeps a room the
 * board can no longer label — and calling that "not placed yet" would deny a
 * session an audience will still be sent to.
 */
function placementSummary(session: AgendaSessionDto): string {
  if (session.assignment !== 'scheduled') return 'Not placed yet'
  const room = session.roomLabel ?? 'a room this event no longer has'
  const track = session.trackLabel === null ? '' : ` · ${session.trackLabel}`
  return `Placed in ${room} — ${session.day} ${timeOfDay(session.start)}–${timeOfDay(session.end)} UTC${track}`
}

/** What one placement form holds: the four controls plus its own complaint. */
interface PlacementDraft {
  readonly stored: string
  readonly day: string
  readonly roomId: string
  readonly startTime: string
  readonly trackId: string
  readonly issue: string | null
}

/** `preferred` when that day offers it, otherwise the day's first slot. */
function startTimeOn(board: AgendaBoardDto, day: string, preferred: string): string {
  const slots = slotsForDay(board, day)
  if (slots.some((slot) => slot.startTime === preferred)) return preferred
  return slots[0]?.startTime ?? preferred
}

/**
 * Whether the board can still express the placement the server holds. A window
 * the organizer has trimmed, or an event start of day they have moved, leaves a
 * scheduled session on a day the grid no longer lists or at a time that day no
 * longer opens. An unplaced session claims no placement, so its placeholder day
 * and start contradict nothing and are never reported.
 *
 * The END is as much a part of the placement as the start: a session stored
 * 09:00–10:30 on a board of hour-long slots begins at a time the board really
 * does offer, and comparing starts alone called that expressible — so an
 * unrelated edit wrote it back half an hour shorter without a word.
 */
function isOffGridPlacement(session: AgendaSessionDto, board: AgendaBoardDto): boolean {
  if (session.assignment !== 'scheduled') return false
  return !slotsForDay(board, session.day).some(
    (slot) =>
      slot.startTime === timeOfDay(session.start) && slot.endTime === timeOfDay(session.end),
  )
}

/**
 * Whether the session is placed in a room the board no longer offers. Only a
 * scheduled session claims a room at all — an unplaced one carries none, so it
 * contradicts nothing.
 */
function hasOrphanedRoom(session: AgendaSessionDto, board: AgendaBoardDto): boolean {
  if (session.assignment !== 'scheduled') return false
  return !board.rooms.some((room) => room.id === session.roomId)
}

/**
 * What the form says about a placement whose room the board has lost. The
 * summary above already reports that the session is placed; this says why no
 * room is named with it and what can be done about it, which differs by whether
 * the placement controls are rendered at all.
 */
function orphanedRoomNotice(placeable: boolean): string {
  const opening =
    'The room this session is placed in is no longer one of this event’s rooms, so the board cannot say where it is.'
  return placeable
    ? `${opening} Room below has nothing chosen: choose one and place the session again, or remove it from the schedule.`
    : `${opening} Nothing can be placed until the prerequisites above are met; removing it from the schedule takes it off instead.`
}

/**
 * The stored id when the board still offers it, and no selection when it does
 * not. Saving the taxonomy replaces every room and track and mints a fresh id
 * for each, so a placement made before that save names ids no option carries.
 * The select falls back to its empty option, and a draft that kept the stored id
 * would submit a room the organizer was never shown — a placement the server can
 * only reject. Held to what the board offers, the form sends what it displays.
 */
function offeredId(options: readonly AgendaOptionDto[], id: string | null): string {
  return offeredOptionId(options, id) ?? ''
}

/** Where the session is stored, as the summary and the notices name it. */
function storedAt(session: AgendaSessionDto): string {
  return `${session.day} ${timeOfDay(session.start)}–${timeOfDay(session.end)}`
}

/**
 * Why the controls cannot show the stored placement. Three different things can
 * be true, and only the first of them is about the event window at all:
 *
 *  - the window really has moved past the placement — the organizer trimmed the
 *    event past the day the session sits on, and the server refuses it now;
 *  - or the window still covers that day and this board stops short of drawing
 *    it, because a very long window is listed only as far as it can be read;
 *  - or the board draws that day and simply cannot express those hours. Each
 *    day is cut into whole `DEFAULT_SESSION_MINUTES` slots from the hour it
 *    opens, so moving the event's start of day re-anchors every slot of the
 *    first day, and a session longer than one slot lines up with none of them.
 *    The window still covers the placement and the server still accepts it.
 *
 * Only the first is a window that stopped offering an hour, and saying so of
 * the others tells the organizer the event configuration changed in a way it
 * did not — and pushes them to move a session that never needed moving. So each
 * says what is true of it, and the last says only what this board knows: which
 * hours it can draw, never which hours the event has.
 */
function offGridReason(session: AgendaSessionDto, board: AgendaBoardDto): string {
  if (isBeyondListedDays(session, board)) {
    const listed = board.days.length
    return `This session is placed at ${storedAt(session)}, past the first ${listed} ${listed === 1 ? 'day' : 'days'} the board shows of this ${board.windowDays}-day event window.`
  }
  if (isOffWindowDay(session, board)) {
    return `The event window no longer offers ${storedAt(session)}, where this session is placed.`
  }
  return `This session is placed at ${storedAt(session)}, which is not one of the ${DEFAULT_SESSION_MINUTES}-minute slots this board draws on that day.`
}

/**
 * What the form says when its controls cannot show the stored placement.
 *
 * Whatever the reason, the controls hold nothing, because the alternative is
 * worse: a Day and Start quietly showing some other slot turn an unrelated
 * edit, a track change say, into a move of the session the organizer never
 * asked for and is never told about. And whatever the reason, the session has
 * not moved — so the notice says that first, then what has to be chosen before
 * it can move at all.
 */
function offGridNotice(session: AgendaSessionDto, board: AgendaBoardDto): string {
  return `${offGridReason(session, board)} It stays there until you move it: Day and Start below have nothing chosen, so choose a day and a start time to move the session there, then place it. Removing it from the schedule takes it off instead.`
}

/** What the page says about a window it draws only part of. */
function windowReachNotice(board: AgendaBoardDto): string {
  const listed = board.days.length
  return `Showing the first ${listed} ${listed === 1 ? 'day' : 'days'} of this ${board.windowDays}-day event window. A session can still be placed on the days below, and one already placed on a later day keeps its place.`
}

/**
 * The placement the server currently holds, as one comparable value, together
 * with the four values the form is edited from. Every one of them is held to
 * something the board actually offers: a session placed in a room the taxonomy
 * has replaced leaves Room with nothing chosen, and one the board cannot
 * express at all leaves Day and Start with nothing chosen too — never some
 * other slot, which the form would then submit as though the organizer had
 * named it. `isOffGridPlacement` and `hasOrphanedRoom` are what say so.
 */
function storedPlacement(session: AgendaSessionDto, board: AgendaBoardDto): PlacementDraft {
  const offGrid = isOffGridPlacement(session, board)
  const days = placeableDays(board)
  const day = days.some((option) => option.day === session.day)
    ? session.day
    : (days[0]?.day ?? session.day)
  return {
    stored: [
      session.day,
      session.start,
      session.end,
      session.roomId ?? '',
      session.trackId ?? '',
    ].join('|'),
    day: offGrid ? '' : day,
    roomId: offeredId(board.rooms, session.roomId),
    startTime: offGrid ? '' : startTimeOn(board, day, timeOfDay(session.start)),
    trackId: offeredId(board.tracks, session.trackId),
    issue: null,
  }
}

function SessionPlacementForm({
  session,
  board,
  onPlace,
  onUnplace,
  onRegisterDayField,
  isSaving,
}: {
  readonly session: AgendaSessionDto
  readonly board: AgendaBoardDto
  readonly onPlace: (request: AgendaPlacementRequest) => void
  readonly onUnplace: (submissionId: string) => void
  readonly onRegisterDayField: (submissionId: string, element: HTMLSelectElement | null) => void
  readonly isSaving: boolean
}) {
  const [edited, setEdited] = useState<PlacementDraft | null>(null)
  const stored = storedPlacement(session, board)
  // The board takes writes from this form and from the drag board alike, and
  // both replace the whole board. So the controls follow the stored placement:
  // an edit lives only as long as the placement it was started from, and the
  // form can never submit — or show — a placement the server has moved past.
  const draft = edited !== null && edited.stored === stored.stored ? edited : stored
  const fieldId = (field: string) => `agenda-${field}-${session.submissionId}`
  // One id per rendered form, not per session id: every session on the board
  // renders this same form, and a fixed id would repeat down the page and point
  // every Day at the first row's notice.
  const noticeId = useId()
  const offGridNoticeId = `${noticeId}-off-grid`
  const orphanedRoomNoticeId = `${noticeId}-orphaned-room`
  // Until every prerequisite is met a placement cannot succeed at all: there
  // would be no day, no slot or no room to name. The form then offers the one
  // action that still works — taking a stored placement back off the schedule.
  const placeable = unmetAgendaPreconditions(board).length === 0
  const days = placeableDays(board)
  const daySlots = slotsForDay(board, draft.day)
  const orphanedRoom = hasOrphanedRoom(session, board)
  const offGrid = placeable && isOffGridPlacement(session, board)
  const isPending = isSaving

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const slot = daySlots.find((option) => option.startTime === draft.startTime)
    // A placement the board cannot show leaves Day and Start empty on purpose,
    // and this is the refusal that makes that safe: the session stays exactly
    // where it is until the organizer names where it should go instead.
    if (draft.day === '' || slot === undefined) {
      setEdited({
        ...draft,
        issue: `This session stays at ${storedAt(session)} until you choose a day and a start time to move it to.`,
      })
      return
    }
    if (draft.roomId === '') {
      setEdited({ ...draft, issue: 'Choose a room and a start time first.' })
      return
    }
    setEdited({ ...draft, issue: null })
    const { start, end } = slotInstants(draft.day, slot)
    onPlace({
      submissionId: session.submissionId,
      placement: {
        day: draft.day,
        roomId: draft.roomId,
        trackId: draft.trackId === '' ? null : draft.trackId,
        start,
        end,
      },
    })
  }

  return (
    <form
      aria-label={`Placement for ${session.title}`}
      onSubmit={submit}
      className="grid gap-2 rounded-lg border border-border p-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium">{session.title}</span>
        <Badge>{session.status === 'published' ? 'Published' : 'Draft'}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{placementSummary(session)}</p>
      {/* Worth saying in every state, unlike the notice below: a board short of
          its rooms is exactly where a placement it cannot name is most likely,
          and removal is then the only thing left to do about it.

          Both notices carry an id the control they contradict points at. A
          role=status that mounts already populated is generally not announced
          at all, and a screen-reader user moving through the form field by
          field never lands on it either — so the description association, not
          the live region, is what carries the explanation to the control. */}
      {orphanedRoom ? (
        <StatusLive aria-live="polite" id={orphanedRoomNoticeId}>
          {orphanedRoomNotice(placeable)}
        </StatusLive>
      ) : null}
      {/* Only worth saying where the controls that disagree are rendered: a
          board short of a prerequisite offers no Day or Start to contradict
          the summary. */}
      {offGrid ? (
        <StatusLive aria-live="polite" id={offGridNoticeId}>
          {offGridNotice(session, board)}
        </StatusLive>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        {placeable ? (
          <>
            <span className="grid gap-1">
              <label htmlFor={fieldId('day')} className="text-sm">
                Day
              </label>
              <select
                id={fieldId('day')}
                aria-label="Day"
                ref={(element) => onRegisterDayField(session.submissionId, element)}
                className={selectClass}
                required={true}
                aria-describedby={offGrid ? offGridNoticeId : undefined}
                value={draft.day}
                onInvalid={(event) => {
                  event.preventDefault()
                  setEdited({
                    ...draft,
                    issue: `This session stays at ${storedAt(session)} until you choose a day and a start time to move it to.`,
                  })
                }}
                onChange={(event) => {
                  // Each day is bounded by the event window on its own, so the
                  // start has to follow the day it belongs to — except while
                  // the start is still unchosen, which stays unchosen until the
                  // organizer names it.
                  const day = event.target.value
                  setEdited({
                    ...draft,
                    day,
                    startTime:
                      draft.startTime === '' ? '' : startTimeOn(board, day, draft.startTime),
                  })
                }}
              >
                {draft.day === '' ? <option value="">Choose a day</option> : null}
                {days.map((option) => (
                  <option key={option.day} value={option.day}>
                    {option.day}
                  </option>
                ))}
              </select>
            </span>
            <span className="grid gap-1">
              <label htmlFor={fieldId('room')} className="text-sm">
                Room
              </label>
              <select
                id={fieldId('room')}
                aria-label="Room"
                className={selectClass}
                required={true}
                aria-describedby={orphanedRoom ? orphanedRoomNoticeId : undefined}
                value={draft.roomId}
                onInvalid={(event) => {
                  event.preventDefault()
                  setEdited({ ...draft, issue: 'Choose a room and a start time first.' })
                }}
                onChange={(event) => setEdited({ ...draft, roomId: event.target.value })}
              >
                <option value="">Choose a room</option>
                {board.rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.label}
                  </option>
                ))}
              </select>
            </span>
            <span className="grid gap-1">
              <label htmlFor={fieldId('start')} className="text-sm">
                Start
              </label>
              <select
                id={fieldId('start')}
                aria-label="Start"
                className={selectClass}
                required={true}
                aria-describedby={offGrid ? offGridNoticeId : undefined}
                value={draft.startTime}
                onInvalid={(event) => {
                  event.preventDefault()
                  setEdited({
                    ...draft,
                    issue: `This session stays at ${storedAt(session)} until you choose a day and a start time to move it to.`,
                  })
                }}
                onChange={(event) => setEdited({ ...draft, startTime: event.target.value })}
              >
                {draft.startTime === '' ? <option value="">Choose a start time</option> : null}
                {daySlots.map((slot) => (
                  <option key={slot.startTime} value={slot.startTime}>
                    {slot.startTime}
                  </option>
                ))}
              </select>
            </span>
            <span className="grid gap-1">
              <label htmlFor={fieldId('track')} className="text-sm">
                Track
              </label>
              <select
                id={fieldId('track')}
                aria-label="Track"
                className={selectClass}
                value={draft.trackId}
                onChange={(event) => setEdited({ ...draft, trackId: event.target.value })}
              >
                <option value="">No track</option>
                {board.tracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.label}
                  </option>
                ))}
              </select>
            </span>
            <span aria-live="polite" aria-atomic="true">
              <Button type="submit" variant="outline" size="sm" disabled={isPending}>
                {isPending ? 'Placing…' : 'Place'}
              </Button>
            </span>
          </>
        ) : null}
        {session.assignment === 'scheduled' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Remove ${session.title} from the schedule`}
            onClick={() => onUnplace(session.submissionId)}
          >
            Remove from the schedule
          </Button>
        ) : null}
      </div>
      {draft.issue === null ? null : <AlertLive>{draft.issue}</AlertLive>}
    </form>
  )
}

/** What the conflict live region says, in both the empty and the non-empty state. */
function conflictSummary(count: number): string {
  if (count === 0) return 'No conflicts.'
  return count === 1 ? '1 conflict to resolve.' : `${count} conflicts to resolve.`
}

/** Where a placement that just landed put the session. */
function placedAnnouncement(session: AgendaSessionDto): string {
  const room = session.roomLabel ?? 'the schedule'
  return `Placed ${session.title} in ${room} at ${timeOfDay(session.start)} on ${session.day}.`
}

function ViewRegion({
  name,
  groups,
}: {
  readonly name: string
  readonly groups: ReadonlyArray<{
    readonly key: string
    readonly label: string
    readonly sessions: readonly AgendaSessionDto[]
  }>
}) {
  return (
    <section aria-label={`${name} view`} className="grid gap-1 rounded-lg border border-border p-3">
      <h3 className="text-sm font-medium">{name}</h3>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
      ) : (
        <ul className="grid gap-2">
          {groups.map((group) => (
            <li key={group.key} className="grid gap-1">
              {group.label === '' ? null : (
                <span className="text-sm text-muted-foreground">{group.label}</span>
              )}
              <ul className="grid gap-1">
                {group.sessions.map((session) => (
                  <li key={session.submissionId} className="flex flex-wrap gap-x-3 text-sm">
                    <span>{session.title}</span>
                    <span className="text-muted-foreground">
                      {timeOfDay(session.start)}–{timeOfDay(session.end)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function AgendaAdminPage({ eventSlug }: AgendaAdminPageProps) {
  const queryClient = useQueryClient()
  const queryKey = adminAgendaQueryKeys.board(eventSlug)
  const boardQuery = useAgendaBoard(eventSlug)
  // Keep the mutations with the page that owns their pending and result UI.
  // This makes the duplicate-submit boundary explicit instead of hiding the
  // action in a data-only adapter whose consumer has to reconstruct its state.
  const place = useMutation({
    mutationFn: (variables: PlaceAgendaSessionVariables) =>
      placeAgendaSession(eventSlug, variables.submissionId, variables.placement),
    onMutate: async (variables: PlaceAgendaSessionVariables) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<AgendaBoardDto>(queryKey)
      if (previous !== undefined) {
        queryClient.setQueryData(queryKey, withPlacement(previous, variables))
      }
      return { previous }
    },
    onError: (
      _error: unknown,
      _variables: PlaceAgendaSessionVariables,
      context: { previous: AgendaBoardDto | undefined } | undefined,
    ) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
    onSuccess: (board: AgendaBoardDto) => {
      queryClient.setQueryData(queryKey, board)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })
  const unplace = useMutation({
    mutationFn: (submissionId: SubmissionId) => unplaceAgendaSession(eventSlug, submissionId),
    onSuccess: (board: AgendaBoardDto) => {
      queryClient.setQueryData(queryKey, board)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })
  const publish = useMutation({
    mutationFn: () => publishAgenda(eventSlug),
    onSuccess: (result: AgendaPublishResultDto) => {
      queryClient.setQueryData(queryKey, result.board)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const dayFields = useRef(new Map<string, HTMLSelectElement>())

  useEffect(() => {
    document.title = 'Agenda — SpeakerOps'
  }, [])

  const registerDayField = useCallback(
    (submissionId: string, element: HTMLSelectElement | null): void => {
      if (element === null) dayFields.current.delete(submissionId)
      else dayFields.current.set(submissionId, element)
    },
    [],
  )

  const board = boardQuery.data
  const byId = useMemo(
    () => new Map((board?.sessions ?? []).map((session) => [session.submissionId, session])),
    [board],
  )
  const placeSession = useCallback(
    (request: AgendaPlacementRequest) => {
      place.mutate(request as PlaceAgendaSessionVariables)
    },
    [place],
  )
  const unplaceSession = useCallback(
    (submissionId: string) => {
      unplace.mutate(submissionId)
    },
    [unplace],
  )

  if (boardQuery.isError) {
    const code = getApiErrorCode(boardQuery.error)
    if (code === 'forbidden') return <ForbiddenState />
    if (code === 'not_found') return <DeniedState />
  }

  if (boardQuery.isPending) {
    return (
      <section aria-busy="true" aria-label="Loading the agenda" className="grid gap-3">
        <Card>
          <CardContent className="grid gap-3">
            {/* aria-busy is a state, not a live region, and this state owns no
                heading and no copy of its own — so without an announcement it
                offers a screen reader nothing at all while the board loads. */}
            <StatusLive aria-live="polite">Loading the agenda.</StatusLive>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      </section>
    )
  }

  if (board === undefined) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <Card>
          <CardContent className="grid gap-3">
            <AlertLive>Unable to load the agenda.</AlertLive>
            <Button variant="outline" onClick={() => void boardQuery.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (board.sessions.length === 0) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <Card>
          <CardContent>
            <StatusLive aria-live="polite">No accepted sessions to schedule yet.</StatusLive>
          </CardContent>
        </Card>
      </div>
    )
  }

  const unmet = unmetAgendaPreconditions(board)
  const placeable = unmet.length === 0
  const days = placeableDays(board)
  const day = selectedDay ?? days[0]?.day ?? board.sessions[0]?.day ?? ''
  const title = (submissionId: string): string => byId.get(submissionId)?.title ?? submissionId
  const groupsOf = (
    grouped: Readonly<Record<string, readonly string[]>>,
    label: (key: string) => string,
  ) =>
    Object.entries(grouped).map(([key, submissionIds]) => ({
      key,
      label: label(key),
      sessions: submissionIds.flatMap((submissionId) => {
        const session = byId.get(submissionId)
        return session === undefined ? [] : [session]
      }),
    }))
  const placedTarget = place.isSuccess ? byId.get(place.variables.submissionId) : undefined
  const placed = placedTarget?.assignment === 'scheduled' ? placedTarget : undefined
  const removedTarget = unplace.isSuccess ? byId.get(unplace.variables) : undefined
  const removed = removedTarget?.assignment === 'scheduled' ? undefined : removedTarget

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Agenda</h1>

      {/* A placement needs a day, a slot on it, and a room to go in. Each can be
          missing on its own, so the page names the ones that are — and only
          those — beside the surface that fixes each. Naming a prerequisite that
          is already met would send the organizer to a setting they have already
          made; naming none at all is what makes a board look broken. */}
      {unmet.length === 0 ? null : (
        <section aria-label="Placement prerequisites" className="grid gap-3">
          <h2 className="text-lg font-semibold">Before sessions can be placed</h2>
          <Card>
            <CardContent>
              <ul className="grid gap-3">
                {unmet.map((precondition) => (
                  <li key={precondition} className="grid gap-1">
                    <StatusLive aria-live="polite">
                      {PRECONDITION_COPY[precondition].message}
                    </StatusLive>
                    <PreconditionLink precondition={precondition} eventSlug={eventSlug} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}

      <section aria-label="Publishing" className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => publish.mutate()} disabled={publish.isPending}>
          Publish agenda
        </Button>
        {publish.isSuccess ? (
          <StatusLive aria-live="polite">
            Published {publish.data.publishedCount}{' '}
            {publish.data.publishedCount === 1 ? 'session' : 'sessions'}.
          </StatusLive>
        ) : null}
        {publish.isError ? <AlertLive>Could not publish the agenda.</AlertLive> : null}
      </section>

      <section aria-label="Conflicts" className="grid gap-2">
        <h2 className="text-lg font-semibold">Conflicts</h2>
        {/* One live region across both states: a conflict that appears after a
            placement has to be spoken, and a region that unmounts says nothing. */}
        <StatusLive aria-live="polite">{conflictSummary(board.conflicts.length)}</StatusLive>
        {board.conflicts.length === 0 ? null : (
          <ul className="grid gap-2">
            {board.conflicts.map((conflict) => (
              <li
                key={`${conflict.kind}-${conflict.first}-${conflict.second}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive p-2"
              >
                <Badge>{CONFLICT_LABELS[conflict.kind]}</Badge>
                <span className="text-sm">
                  {title(conflict.first)} and {title(conflict.second)}
                </span>
                {/* The shortcut only moves focus to a day select, so it is
                    offered exactly when that select exists. */}
                {placeable ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Reschedule ${title(conflict.first)}`}
                    onClick={() => dayFields.current.get(conflict.first)?.focus()}
                  >
                    Reschedule
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Every cell of the drag board is a room crossed with a slot of the day,
          so a board short of either is a table nothing can be dropped into. */}
      {placeable ? (
        <section aria-label="Placement board" className="grid gap-3">
          <h2 className="text-lg font-semibold">Placement board</h2>
          {/* A very long window is drawn only as far as it can be read, and the
              board says so rather than letting the last day it lists pass for
              the end of the event. The days past it are days the event really
              covers and the server really accepts a placement on. */}
          {unlistedWindowDays(board) === 0 ? null : (
            <StatusLive aria-live="polite" id={WINDOW_REACH_NOTICE_ID}>
              {windowReachNotice(board)}
            </StatusLive>
          )}
          <span className="grid w-fit gap-1">
            <label htmlFor="agenda-board-day" className="text-sm">
              Board day
            </label>
            <select
              id="agenda-board-day"
              className={selectClass}
              aria-describedby={
                unlistedWindowDays(board) === 0 ? undefined : WINDOW_REACH_NOTICE_ID
              }
              value={day}
              onChange={(event) => setSelectedDay(event.target.value)}
            >
              {days.map((option) => (
                <option key={option.day} value={option.day}>
                  {option.day}
                </option>
              ))}
            </select>
          </span>
          <Suspense
            fallback={
              <div aria-busy="true" className="grid gap-2">
                <StatusLive aria-live="polite">Loading the placement board.</StatusLive>
                <Skeleton className="h-24 w-full" />
              </div>
            }
          >
            <AgendaDndBoard board={board} day={day} onPlace={placeSession} />
          </Suspense>
        </section>
      ) : null}

      <section aria-label="Sessions" className="grid gap-3">
        <h2 className="text-lg font-semibold">Sessions</h2>
        {place.isError ? <AlertLive>Could not place the session.</AlertLive> : null}
        {unplace.isError ? (
          <AlertLive>Could not remove the session from the schedule.</AlertLive>
        ) : null}
        {/* A placement that lands is as much news as one that fails, and it is
            the only confirmation an organizer who never sees the board gets. */}
        {placed === undefined ? null : (
          <StatusLive aria-live="polite">{placedAnnouncement(placed)}</StatusLive>
        )}
        {removed === undefined ? null : (
          <StatusLive aria-live="polite">{`Removed ${removed.title} from the schedule.`}</StatusLive>
        )}
        {board.sessions.map((session) => (
          <SessionPlacementForm
            key={session.submissionId}
            session={session}
            board={board}
            onPlace={placeSession}
            onUnplace={unplaceSession}
            onRegisterDayField={registerDayField}
            isSaving={place.isPending || unplace.isPending}
          />
        ))}
      </section>

      <section aria-label="Views" className="grid gap-3">
        <h2 className="text-lg font-semibold">Views</h2>
        <ViewRegion
          name="List"
          groups={
            board.views.list.length === 0
              ? []
              : [
                  {
                    key: 'list',
                    label: '',
                    sessions: board.views.list.flatMap((submissionId) => {
                      const session = byId.get(submissionId)
                      return session === undefined ? [] : [session]
                    }),
                  },
                ]
          }
        />
        <ViewRegion name="Day" groups={groupsOf(board.views.day, (key) => key)} />
        <ViewRegion name="Week" groups={groupsOf(board.views.week, (key) => key)} />
        <ViewRegion
          name="Track"
          groups={groupsOf(board.views.track, (key) => optionLabel(board.tracks, key))}
        />
        <ViewRegion
          name="Room"
          groups={groupsOf(board.views.room, (key) => optionLabel(board.rooms, key))}
        />
      </section>
    </div>
  )
}
