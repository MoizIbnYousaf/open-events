import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { isValueEmpty, type AnswerMap, type AnswerValue } from '../../../domain/answers'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { ClipboardIcon } from '../../../components/ui/icons'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { SectionHeading } from '../../../components/ui/section-heading'
import { getApiErrorCode } from '../../api/admin-events'
import { isElementRequiredDto, isElementVisibleDto } from '../../lib/form-engine'
import {
  speakerTaskLabel,
  useCompleteFormTask,
  useCompletePortalTask,
  usePortalTasks,
  useTaskForm,
  type PortalTask,
} from '../../queries/portal-tasks'
import CfpFields from './CfpFields'

/**
 * REQ-011 speaker task panel. Standalone: it owns no h1 so a host page keeps
 * its page-owned heading. Completion is optimistic and rolls back on failure.
 */
export default function TasksPanel() {
  const query = usePortalTasks()
  const complete = useCompletePortalTask()
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  /**
   * Completion removes the button the speaker just pressed, which would drop
   * keyboard focus onto <body>.
   *
   * Focus must NOT be handed to another row's live control. Completing a task
   * cannot be undone from this surface, and a held Enter auto-repeats a native
   * button's click: moving focus to the next "Mark complete" while the first
   * request is still in flight completed a second, unintended task. So the
   * pressed control stays mounted and inert until the mutation settles (see
   * `inFlight` below), and only once it succeeds does focus move — to the
   * section heading, which is a landing place and not another action.
   */
  const completeTask = (taskId: string, label: string) => {
    complete.mutate(taskId, {
      onSuccess: () => {
        // Focus first: the control that is losing focus is about to unmount,
        // and the heading is always mounted.
        headingRef.current?.focus()
        // A toast, because the checklist is a stop on the way somewhere: the
        // speaker usually leaves for the headshot or the portal immediately
        // after. The row's own "Complete" is still the durable record; this is
        // the confirmation that survives the navigation (DEC-019).
        toast.success(`${label} marked complete`)
      },
    })
  }

  if (query.isPending) {
    return (
      <section aria-label="Your tasks" aria-busy="true">
        <Card>
          <CardContent className="grid gap-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
            <StatusLive aria-live="polite">Loading your tasks…</StatusLive>
          </CardContent>
        </Card>
      </section>
    )
  }

  if (query.isError) {
    const unauthenticated =
      getApiErrorCode(query.error) === 'unauthenticated' ||
      (query.error as { status?: number } | null)?.status === 401
    return (
      <section aria-label="Your tasks">
        <Card>
          <CardContent className="grid gap-3">
            {unauthenticated ? (
              <StatusLive aria-live="polite">Sign in to view your tasks.</StatusLive>
            ) : (
              <>
                <AlertLive>Unable to load your tasks.</AlertLive>
                <Button
                  variant="outline"
                  pending={query.isFetching}
                  onClick={() => void query.refetch()}
                >
                  {query.isFetching ? 'Trying again…' : 'Try again'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </section>
    )
  }

  const tasks: readonly PortalTask[] = query.data
  // Derived from THIS mutation's own variables: `complete.isPending` alone
  // disabled Mark complete on every row, so one speaker task froze all of them
  // and nothing said which row was actually in flight.
  const inFlightTaskId = complete.isPending ? complete.variables : undefined

  return (
    <section aria-label="Your tasks">
      <Card>
        <CardHeader>
          <SectionHeading ref={headingRef} tabIndex={-1} className="outline-hidden">
            Your tasks
          </SectionHeading>
        </CardHeader>
        {/* The failure's single live region. Focus is still on the control that
            failed, because it was never moved, so the message is next to it. No
            announce() beside it: the same sentence in two live regions is spoken
            twice (DEC-014). */}
        {complete.isError ? (
          <CardContent>
            <AlertLive>Unable to complete that task.</AlertLive>
          </CardContent>
        ) : null}
        {tasks.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={<ClipboardIcon size={20} />}
              title="No tasks yet."
              description="Onboarding tasks appear here once a proposal is accepted."
            />
          </CardContent>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {tasks.map((task) => {
              const label = speakerTaskLabel(task.kind)
              const done = task.status === 'completed'
              // The optimistic flip marks the row complete straight away, but the
              // control the speaker pressed stays mounted until the request
              // settles: it holds their focus, and it shows the in-flight state
              // on the thing they actually pressed.
              const inFlight = inFlightTaskId === task.id
              return (
                <li
                  key={task.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
                >
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span
                      className={
                        done ? 'text-sm text-muted-foreground line-through' : 'text-sm font-medium'
                      }
                    >
                      {label}
                    </span>
                    <span className="text-xs text-muted-foreground">{task.submissionTitle}</span>
                    <span className="text-xs text-muted-foreground">
                      {done ? 'Complete' : 'Outstanding'}
                    </span>
                    {/* Evidence-backed tasks name where the proof lives; the
                      button below only records completion once it exists. */}
                    {!done && task.kind === 'submit_bio' ? (
                      <span className="text-xs text-muted-foreground">
                        Requires a saved bio in “Your profile” below.
                      </span>
                    ) : null}
                    {!done && task.kind === 'submit_headshot' ? (
                      <span className="text-xs text-muted-foreground">
                        Requires an uploaded headshot below.
                      </span>
                    ) : null}
                    {!done && task.kind === 'confirm_participation' ? (
                      <span className="text-xs text-muted-foreground">
                        Completed by your explicit confirmation.
                      </span>
                    ) : null}
                  </span>
                  {task.kind === 'complete_form' ? (
                    done ? null : (
                      <FormTaskEditor task={task} onCompleted={() => headingRef.current?.focus()} />
                    )
                  ) : done && !inFlight ? null : (
                    <Button
                      type="button"
                      variant="outline"
                      pending={inFlight}
                      focusableWhenDisabled
                      /* The words on the control lead the accessible name, so
                         someone driving by voice can say what they can see
                         (WCAG 2.5.3 Label in Name). The row context still
                         follows, because three rows otherwise share one name. */
                      aria-label={
                        inFlight
                          ? `Marking complete: ${label} for ${task.submissionTitle}`
                          : task.kind === 'confirm_participation'
                            ? `I confirm I will participate — Mark complete: ${label} for ${task.submissionTitle}`
                            : `Mark complete: ${label} for ${task.submissionTitle}`
                      }
                      data-task-action="complete"
                      data-task-id={task.id}
                      onClick={() => completeTask(task.id, label)}
                    >
                      {inFlight
                        ? 'Marking complete…'
                        : task.kind === 'confirm_participation'
                          ? 'I confirm I will participate'
                          : 'Mark complete'}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </section>
  )
}

/**
 * Inline editor for one form-backed task: fetches the REAL published
 * definition pinned to the task, renders its visible fields with the shared
 * CFP primitives, and completes only through a validated answers submission.
 * The server re-validates, so a rejection keeps the row pending and shows a
 * generic error — never raw server copy, never a fake success.
 */
function FormTaskEditor({
  task,
  onCompleted,
}: {
  readonly task: PortalTask
  readonly onCompleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const definition = useTaskForm(task.id, open)
  const complete = useCompleteFormTask()
  const label = speakerTaskLabel(task.kind)

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        aria-label={`Fill out form: ${label} for ${task.submissionTitle}`}
        onClick={() => setOpen(true)}
      >
        Fill out form
      </Button>
    )
  }
  if (definition.isPending) {
    return (
      <div className="grid w-full gap-2" aria-busy="true">
        <Skeleton className="h-8 w-full" />
        <StatusLive>Loading the form…</StatusLive>
      </div>
    )
  }
  if (definition.isError || definition.data === undefined) {
    return (
      <div className="grid w-full gap-2">
        <AlertLive>Unable to load the form.</AlertLive>
        <Button variant="outline" onClick={() => void definition.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  const fields = definition.data.elements.filter(
    (element) =>
      (element.kind === 'field' || element.kind === 'question') &&
      element.fieldKey !== null &&
      isElementVisibleDto(element, definition.data.conditionRules, answers),
  )

  const submit = () => {
    const nextErrors: Record<string, string> = {}
    for (const element of fields) {
      if (
        element.fieldKey !== null &&
        isElementRequiredDto(element, definition.data.conditionRules, answers) &&
        isValueEmpty(answers[element.fieldKey])
      ) {
        nextErrors[element.fieldKey] = 'This field is required'
      }
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    complete.mutate(
      { taskId: task.id, answers },
      {
        onSuccess: () => {
          onCompleted()
          toast.success(`${label} marked complete`)
        },
      },
    )
  }

  return (
    <form
      className="grid w-full gap-3"
      aria-label={`${label} for ${task.submissionTitle}`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {fields.map((element) => (
        <CfpFields
          key={element.id}
          element={element}
          domId={`task-${task.id}-${element.id}`}
          value={element.fieldKey === null ? null : (answers[element.fieldKey] ?? null)}
          required={
            element.fieldKey !== null &&
            isElementRequiredDto(element, definition.data.conditionRules, answers)
          }
          error={element.fieldKey === null ? undefined : errors[element.fieldKey]}
          onChange={(value: AnswerValue) => {
            if (element.fieldKey === null) return
            const fieldKey = element.fieldKey
            setAnswers((current) => ({ ...current, [fieldKey]: value }))
            setErrors((current) => {
              if (current[fieldKey] === undefined) return current
              const next = { ...current }
              delete next[fieldKey]
              return next
            })
          }}
        />
      ))}
      {complete.isError ? <AlertLive>Unable to submit this form.</AlertLive> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="outline" pending={complete.isPending}>
          {complete.isPending ? 'Submitting…' : 'Submit form'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  )
}
