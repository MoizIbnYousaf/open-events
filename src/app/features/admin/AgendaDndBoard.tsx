import { useMemo, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'

import type { AgendaBoardDto, AgendaOptionDto, AgendaSessionDto } from '../../../application'
import { cn } from '../../../lib/utils'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table'

import {
  agendaAnnouncements,
  cellId,
  placementFromCell,
  sessionsInCell,
  slotsForDay,
  unplacedSessions,
  type AgendaPlacementRequest,
} from './agenda-board'

interface AgendaDndBoardProps {
  readonly board: AgendaBoardDto
  readonly day: string
  readonly onPlace: (request: AgendaPlacementRequest) => void
}

/**
 * The draggable session, as a chip.
 *
 * The drag handle keeps the title as its exact accessible name. The separate
 * details control means inspecting a session never starts a drag gesture, and
 * the richer visual metadata does not make the handle repeat the room and time
 * already announced by the cell.
 */
function SessionChip({
  session,
  compact = false,
  conflicted = false,
  selected = false,
  onSelect,
}: {
  readonly session: AgendaSessionDto
  readonly compact?: boolean
  readonly conflicted?: boolean
  readonly selected?: boolean
  readonly onSelect: (session: AgendaSessionDto) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: session.submissionId,
  })
  return (
    <span
      className={cn(
        'group/session relative min-w-0 max-w-full overflow-hidden rounded-md border bg-card text-foreground transition-[border-color,box-shadow,background-color]',
        compact ? 'inline-flex items-stretch' : 'flex min-h-14 w-full items-stretch',
        'border-border hover:border-border-opaque hover:bg-muted/40',
        selected && 'border-ring bg-primary/5 ring-2 ring-ring',
        conflicted && 'border-destructive/60 bg-destructive/5',
        isDragging && 'opacity-60',
      )}
    >
      <button
        type="button"
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        aria-label={session.title}
        className={cn(
          'max-w-full min-w-0 cursor-grab text-left active:cursor-grabbing',
          'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none',
          compact
            ? 'inline-flex flex-1 items-center truncate px-2 py-1 text-sm font-medium'
            : 'flex flex-1 items-stretch',
        )}
      >
        {compact ? (
          <span className="truncate">{session.title}</span>
        ) : (
          <>
            <span
              aria-hidden="true"
              className={cn(
                'w-1 shrink-0 bg-primary/55',
                session.status === 'published' && 'bg-emerald-500',
                conflicted && 'bg-destructive',
              )}
            />
            <span className="grid min-w-0 flex-1 content-center gap-1 px-2 py-1.5">
              <span className="truncate text-xs font-semibold leading-tight">{session.title}</span>
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
                <span className="shrink-0 tabular-nums">
                  {session.start.slice(11, 16)}–{session.end.slice(11, 16)}
                </span>
                {session.trackLabel === null ? null : (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{session.trackLabel}</span>
                  </>
                )}
              </span>
            </span>
          </>
        )}
      </button>
      <button
        type="button"
        aria-label={`View details for ${session.title}`}
        aria-pressed={selected}
        className={cn(
          'shrink-0 border-l border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors',
          'hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none',
          compact ? 'py-1' : 'px-1.5',
        )}
        onClick={() => onSelect(session)}
      >
        Details
      </button>
    </span>
  )
}

function BoardCell({
  board,
  day,
  room,
  startTime,
  selectedId,
  onSelect,
}: {
  readonly board: AgendaBoardDto
  readonly day: string
  readonly room: AgendaOptionDto
  readonly startTime: string
  readonly selectedId: string | null
  readonly onSelect: (session: AgendaSessionDto) => void
}) {
  const id = cellId(day, room.id, startTime)
  const { setNodeRef, isOver } = useDroppable({ id })
  const placed = sessionsInCell(board, day, room.id, startTime)
  const conflicted = (submissionId: string): boolean =>
    board.conflicts.some(
      (conflict) => conflict.first === submissionId || conflict.second === submissionId,
    )
  return (
    <TableCell
      ref={setNodeRef}
      aria-label={`${room.label} at ${startTime}`}
      className={cn(
        // The grid reads as a grid, so the columns carry a rule of their own;
        // the row rule comes from the table primitive.
        'h-20 min-w-48 border-l border-border p-1.5 align-top transition-colors',
        // A drop target says so with a wash and an inset outline, never with a
        // border: a border on hover would move every cell beside it by a pixel.
        isOver && 'bg-primary/10 outline-2 -outline-offset-1 outline-ring',
        placed.length > 1 && 'bg-destructive/5 outline-1 -outline-offset-1 outline-destructive',
      )}
    >
      <span className="grid gap-1">
        {placed.map((session) => (
          <SessionChip
            key={session.submissionId}
            session={session}
            conflicted={conflicted(session.submissionId)}
            selected={selectedId === session.submissionId}
            onSelect={onSelect}
          />
        ))}
      </span>
    </TableCell>
  )
}

/**
 * Drag-and-drop placement board: every accepted session is a draggable chip and
 * every room/slot cell of the selected day is a drop target. A drop persists
 * through the same placement call the keyboard form uses, so dragging is an
 * alternative to that form and never the only way to place a session. Because
 * the keyboard sensor makes dragging a real keyboard path, the board supplies
 * its own announcements: titles and room/day/time, never identifiers.
 *
 * The rows are the slots of the day on the board — a day the event window
 * bounds differently from its neighbours — so every cell drawn is a cell a drop
 * can resolve.
 *
 * A press begins a drag, so a click on a chip is a whole drag cycle that ends
 * on the cell the chip already sits in. `placementFromCell` answers that with no
 * placement, which is what keeps a session moving only where the organizer
 * sends it — never a slot shorter or a track fewer for a press that moved it
 * nowhere.
 */
export default function AgendaDndBoard({ board, day, onPlace }: AgendaDndBoardProps) {
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const unplaced = unplacedSessions(board)
  const slots = slotsForDay(board, day)
  const announcements = useMemo(() => agendaAnnouncements(board), [board])
  const selected = board.sessions.find((session) => session.submissionId === selectedId) ?? null

  const selectSession = (session: AgendaSessionDto): void => {
    setSelectedId((current) => (current === session.submissionId ? null : session.submissionId))
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    const over = event.over
    if (over === null) return
    const request = placementFromCell(board, String(event.active.id), String(over.id))
    if (request !== null) onPlace(request)
  }

  return (
    <DndContext sensors={sensors} accessibility={{ announcements }} onDragEnd={handleDragEnd}>
      <div className="grid gap-3">
        <div className="grid gap-2 rounded-lg p-3 ring-1 ring-border">
          <h3 className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
            Unplaced
          </h3>
          {unplaced.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every session has a place.</p>
          ) : (
            // `min-w-0` is what makes the chip's own `truncate` reachable. This
            // row is a grid item, so its automatic minimum size is `min-content`
            // — the widest unplaced title — and a chip sized `max-w-full`
            // against a parent that never shrinks can never clip anything. On a
            // 390px phone one 86-character title pushed the whole document to
            // 631px wide. The floor belongs here rather than on the chip: a
            // chip is a flex item whose `overflow: hidden` already gives it an
            // automatic minimum of zero, which is why setting it there changed
            // nothing.
            <span className="flex min-w-0 flex-wrap gap-1.5">
              {unplaced.map((session) => (
                <SessionChip
                  key={session.submissionId}
                  session={session}
                  compact
                  selected={selectedId === session.submissionId}
                  onSelect={selectSession}
                />
              ))}
            </span>
          )}
        </div>
        {selected === null ? null : (
          <section
            aria-label="Selected session details"
            className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="grid min-w-0 gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold">{selected.title}</h3>
                <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
                  {selected.status === 'published' ? 'Published' : 'Draft'}
                </span>
              </div>
              {selected.assignment === 'scheduled' ? (
                <p className="text-xs text-muted-foreground">
                  {selected.day} · {selected.start.slice(11, 16)}–{selected.end.slice(11, 16)} ·{' '}
                  {selected.roomLabel ?? 'Room unavailable'}
                  {selected.trackLabel === null ? '' : ` · ${selected.trackLabel}`}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Unplaced. Drag this session into a room and time slot.
                </p>
              )}
            </div>
            <button
              type="button"
              className="h-7 w-fit self-start rounded-sm px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => setSelectedId(null)}
            >
              Close details
            </button>
          </section>
        )}
        {/* The frame is drawn by the scroller itself. Wrapping it in an
            `overflow-hidden` box put the rounding on an element the grid
            scrolls past and clipped the scroll container's own focus ring —
            an outward shadow on a real tab stop — out of existence.

            The caption names the day the grid is drawn for, so it belongs
            above the grid rather than under it. */}
        <Table
          bordered
          className="caption-top"
          containerProps={{ className: 'max-h-[38rem] overflow-y-auto' }}
        >
          <TableCaption className="mt-0 mb-0 border-b border-border px-2 py-2 text-left">
            Rooms on {day}
          </TableCaption>
          <TableHeader sticky>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" pinned className="w-16">
                Time
              </TableHead>
              {board.rooms.map((room) => (
                <TableHead key={room.id} scope="col" className="border-l border-border">
                  {room.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {slots.map((slot) => (
              <TableRow key={slot.startTime} className="hover:bg-transparent">
                <TableHead
                  scope="row"
                  pinned
                  className="w-16 align-top text-xs whitespace-nowrap text-muted-foreground"
                >
                  {slot.startTime}
                </TableHead>
                {board.rooms.map((room) => (
                  <BoardCell
                    key={room.id}
                    board={board}
                    day={day}
                    room={room}
                    startTime={slot.startTime}
                    selectedId={selectedId}
                    onSelect={selectSession}
                  />
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </DndContext>
  )
}
