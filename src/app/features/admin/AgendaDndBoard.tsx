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
        'inline-flex cursor-grab items-center rounded-md border border-border bg-card px-2 py-1 text-sm',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
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
    <td
      ref={setNodeRef}
      aria-label={`${room.label} at ${startTime}`}
      className={cn(
        'min-w-40 border border-border p-2 align-top',
        isOver && 'bg-accent',
        placed.length > 1 && 'border-destructive',
      )}
    >
      <span className="flex flex-wrap gap-1">
        {placed.map((session) => (
          <SessionChip key={session.submissionId} session={session} />
        ))}
      </span>
    </td>
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
        <div className="grid gap-2 rounded-lg border border-border p-3">
          <h3 className="text-sm font-medium">Unplaced</h3>
          {unplaced.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every session has a place.</p>
          ) : (
            <span className="flex flex-wrap gap-2">
              {unplaced.map((session) => (
                <SessionChip key={session.submissionId} session={session} />
              ))}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="pb-2 text-left text-sm text-muted-foreground">
              Rooms on {day}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="border border-border p-2 text-left font-medium">
                  Time
                </th>
                {board.rooms.map((room) => (
                  <th
                    key={room.id}
                    scope="col"
                    className="border border-border p-2 text-left font-medium"
                  >
                    {room.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot.startTime}>
                  <th scope="row" className="border border-border p-2 text-left font-normal">
                    {slot.startTime}
                  </th>
                  {board.rooms.map((room) => (
                    <BoardCell
                      key={room.id}
                      board={board}
                      day={day}
                      room={room}
                      startTime={slot.startTime}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DndContext>
  )
}
