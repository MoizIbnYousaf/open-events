import { useMemo } from 'react'
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
 * Its text is the title and nothing else: dnd-kit gives the chip
 * `role="button"`, so whatever is rendered inside becomes the control's
 * accessible name, and a chip that also printed its room and time would read
 * out the cell the reader is already standing in.
 */
function SessionChip({ session }: { readonly session: AgendaSessionDto }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: session.submissionId,
  })
  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        'inline-flex max-w-full cursor-grab items-center truncate rounded-md border border-border bg-card px-1.5 py-0.5 text-sm font-medium text-foreground transition-colors',
        'hover:border-border-opaque active:cursor-grabbing',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        isDragging && 'opacity-60',
      )}
    >
      {session.title}
    </span>
  )
}

function BoardCell({
  board,
  day,
  room,
  startTime,
}: {
  readonly board: AgendaBoardDto
  readonly day: string
  readonly room: AgendaOptionDto
  readonly startTime: string
}) {
  const id = cellId(day, room.id, startTime)
  const { setNodeRef, isOver } = useDroppable({ id })
  const placed = sessionsInCell(board, day, room.id, startTime)
  return (
    <TableCell
      ref={setNodeRef}
      aria-label={`${room.label} at ${startTime}`}
      className={cn(
        // The grid reads as a grid, so the columns carry a rule of their own;
        // the row rule comes from the table primitive.
        'min-w-40 border-l border-border p-1.5 align-top transition-colors',
        // A drop target says so with a wash and an inset outline, never with a
        // border: a border on hover would move every cell beside it by a pixel.
        isOver && 'bg-primary/10 outline-2 -outline-offset-1 outline-ring',
        placed.length > 1 && 'bg-destructive/5 outline-1 -outline-offset-1 outline-destructive',
      )}
    >
      <span className="flex flex-wrap gap-1">
        {placed.map((session) => (
          <SessionChip key={session.submissionId} session={session} />
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
  const unplaced = unplacedSessions(board)
  const slots = slotsForDay(board, day)
  const announcements = useMemo(() => agendaAnnouncements(board), [board])

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
                <SessionChip key={session.submissionId} session={session} />
              ))}
            </span>
          )}
        </div>
        {/* The frame is drawn by the scroller itself. Wrapping it in an
            `overflow-hidden` box put the rounding on an element the grid
            scrolls past and clipped the scroll container's own focus ring —
            an outward shadow on a real tab stop — out of existence.

            The caption names the day the grid is drawn for, so it belongs
            above the grid rather than under it. */}
        <Table bordered className="caption-top">
          <TableCaption className="mt-0 mb-0 border-b border-border px-2 py-2 text-left">
            Rooms on {day}
          </TableCaption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className="w-16">
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
