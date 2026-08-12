import type { EvaluationResultRowDto } from '../../../application'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'

import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { ClipboardIcon, DocumentStackIcon } from '../../../components/ui/icons'
import { NativeSelect } from '../../../components/ui/native-select'
import { Textarea } from '../../../components/ui/textarea'
import { SectionHeading } from '../../../components/ui/section-heading'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { getApiErrorCode } from '../../api/admin-events'
import type { EventSlug } from '../../../domain'
import {
  useAddCommitteeMember,
  useCommittee,
  useConfigureRound,
  useDefineEvaluationCriteria,
  useEvaluationCriteria,
  useEvaluationResults,
  useEvaluationRounds,
  usePutRoundPool,
  usePutRoundScorecard,
  useRemoveCommitteeMember,
  useDistributeRound,
  useRemindReviewers,
  useRoundPool,
  useRoundScorecard,
  useRunEventRounds,
} from '../../queries/admin-evaluations'
import type {
  CommitteeRosterEntry,
  RoundCriterion,
  RoundCriterionInput,
} from '../../api/admin-evaluations'
import { ConfirmDialog } from '../../../components/ui/confirm-dialog'
import AppShell from '../nav/AppShell'
import { DeniedState, ExpiredSessionState, ForbiddenState } from './AdminStates'
import RoundConfirmDialog from './RoundConfirmDialog'

/**
 * The event-level half of REQ-009: the rubric the committee scores against and
 * the rounds it scores in.
 *
 * Staffing a particular submission stays on that submission's page, where the
 * organizer can see what they are staffing; what belongs here is everything
 * that is true of the event rather than of one proposal.
 */
export default function EvaluationCommitteePage() {
  const params = useParams({ strict: false })
  const slug = params.slug as string | undefined
  const criteria = useEvaluationCriteria(slug as EventSlug | undefined)
  const rounds = useEvaluationRounds(slug as EventSlug | undefined)
  // An expired session is a dead end, and a dead end is a PAGE. Rendered inside
  // the rail it was a card in a shell full of destinations the reader can no
  // longer open — the same moment wearing a different anatomy depending on
  // which organizer route reached it. Bare is what the majority render and what
  // the AdminStates grammar is drawn for. Both observers share the screen's own
  // queries, so asking one level up adds no request.
  const loadError = criteria.error ?? rounds.error
  if (loadError != null && getApiErrorCode(loadError) === 'unauthorized') {
    return <ExpiredCommitteeSession />
  }
  return (
    <AppShell slug={slug ?? ''}>
      {/* The same reading measure Event settings and Taxonomies use. This page
          is a form — a rubric editor and a rounds editor — and full-bleed it
          stretched a single-line "Criterion name" input to ~1250px, wider than
          a page of prose. C0 §3: readable column for forms, full width for
          tables and boards. */}
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <EvaluationCommitteeScreen />
      </div>
    </AppShell>
  )
}

/** Its own component so the router hook runs only when the branch renders. */
function ExpiredCommitteeSession() {
  const navigate = useNavigate()
  useEffect(() => {
    document.title = 'Session expired — SpeakerOps'
  }, [])
  return <ExpiredSessionState onLogin={() => void navigate({ to: '/admin' })} />
}

function EvaluationCommitteeScreen() {
  const params = useParams({ strict: false })
  const slug = params.slug as EventSlug | undefined
  const criteria = useEvaluationCriteria(slug)
  const rounds = useEvaluationRounds(slug)
  // Read once here and handed down: the round editors offer the committee as
  // the pool to choose from, and a second fetch per round would ask the same
  // question many times over.
  const committee = useCommittee(slug)
  const committeeRoster = committee.data ?? []

  useEffect(() => {
    document.title = 'Review committee — SpeakerOps'
  }, [])

  const loadError = criteria.error ?? rounds.error
  if (loadError != null) {
    const code = getApiErrorCode(loadError)
    if (code === 'forbidden') return <ForbiddenState />
    if (code === 'not_found') return <DeniedState />
    // `unauthorized` never reaches here: the page answers it above the shell.
    // A committee that cannot be read is a transient server or network fault,
    // so the organizer gets something to press instead of a sentence and a
    // dead end. Refetching a read adds no write to the mutation ledger.
    const retrying = criteria.isFetching || rounds.isFetching
    return (
      <div className="grid gap-4">
        <CommitteeHeading />
        <Card>
          <CardContent className="grid justify-items-start gap-3">
            <AlertLive>The review committee could not be loaded.</AlertLive>
            <Button
              type="button"
              variant="outline"
              pending={retrying}
              onClick={() => {
                void criteria.refetch()
                void rounds.refetch()
              }}
            >
              {retrying ? 'Trying again…' : 'Try again'}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (criteria.isPending || rounds.isPending || slug === undefined) {
    return (
      <div aria-busy="true" aria-label="Loading the review committee" className="grid gap-4">
        <Card>
          <CardContent className="grid gap-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-64" />
            <StatusLive>Loading the review committee…</StatusLive>
          </CardContent>
        </Card>
      </div>
    )
  }

  // No back link: Review committee is a rail destination, so the rail is the
  // way back and says so with `aria-current`. See `BackLink.tsx`.
  // Reviewers first. The page is named for the committee, and for most of its
  // life the question is who is on it — the rubric and the rounds are what the
  // committee scores WITH, and they were the whole page while the committee
  // itself had no screen at all.
  return (
    <div className="grid gap-4">
      <CommitteeHeading />
      <ReviewersSection slug={slug} />
      <CriteriaSection slug={slug} defined={criteria.data ?? []} />
      <RoundsSection slug={slug} rounds={rounds.data ?? []} committee={committeeRoster} />
      <ResultsSection slug={slug} />
    </div>
  )
}

/** "1 of 3" — done over given, in the order an organizer reads it. */
function workloadText(entry: CommitteeRosterEntry): string {
  return `${entry.completedCount} of ${entry.assignedCount} reviews done`
}

/**
 * The committee itself: who is seated, what each of them owes, how somebody
 * joins, and how somebody leaves.
 *
 * This section is the whole point of the page's name. Before it existed the
 * only way to seat a reviewer was a box on ONE submission's detail, so an
 * organizer could staff a proposal but never see or manage their committee —
 * and an evaluator looking for reviewer management concluded, correctly, that
 * the product had none.
 */
function ReviewersSection({ slug }: { readonly slug: EventSlug }) {
  const roster = useCommittee(slug)
  const add = useAddCommitteeMember(slug)
  const remove = useRemoveCommitteeMember(slug)
  const [email, setEmail] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [invited, setInvited] = useState<string | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<CommitteeRosterEntry | null>(null)
  const remind = useRemindReviewers(slug)
  const [nudge, setNudge] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const emailErrorId = 'reviewer-email-error'

  const members = roster.data ?? []

  /**
   * Where focus goes when the control holding it stops existing.
   *
   * Removing a reviewer unmounts the row — and the Remove button inside it that
   * the confirm dialog just handed focus back to — so a keyboard reader would
   * land on <body> with the page's place lost. The section heading is always
   * mounted and is a destination rather than another action.
   */
  const landOnHeading = () => headingRef.current?.focus()

  function submitInvite(event: React.FormEvent): void {
    event.preventDefault()
    const candidate = email.trim()
    // Refused here rather than posted and refused there: an empty field is not
    // a question worth asking the server, and the answer would arrive as a
    // generic failure rather than as the specific thing that is wrong.
    if (candidate.length === 0) {
      setInvalid(true)
      // A previous failure's alert must not stand beside this one: they would
      // describe two different attempts, one of which is no longer in flight.
      add.reset()
      return
    }
    setInvalid(false)
    setInvited(null)
    // `mutate` with callbacks, not `mutateAsync`: the async form REJECTS on
    // failure, and firing it into a `void` leaves an unhandled rejection behind
    // every failed invite. The error is already rendered from `add.error`.
    add.mutate(candidate, {
      onSuccess: (seated) => {
        // The SERVER's answer, not the string that was typed: it resolves the
        // person's real name, and it says whether this was actually a new seat.
        // Announcing an invitation for somebody already seated tells the
        // organizer they did something they did not.
        setInvited(seated.created ? seated.name.trim() || seated.email : null)
        setEmail('')
      },
    })
  }

  return (
    <section aria-labelledby="reviewers-heading">
      <Card>
        <CardHeader>
          {/* `level` is what makes CardTitle a heading — without it the
              component renders a div, and the section this page was rebuilt
              around would be missing from the heading outline while its two
              siblings appear. It is also the landing place focus needs after a
              row is removed from under it. */}
          <CardTitle id="reviewers-heading" level={2} ref={headingRef} tabIndex={-1}>
            Reviewers
          </CardTitle>
          <CardDescription>
            Who reads proposals for this event. Adding someone here grants them access to this
            event&rsquo;s review queue and nothing else.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* The placeholder shapes carry the busy flag; the sentence does not
              repeat them. Two announcements for one load is one too many, and
              this page already has more polite regions than it should. */}
          {roster.isPending ? (
            <div aria-busy="true" aria-label="Loading the reviewers" className="grid gap-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          ) : null}

          {roster.error != null ? (
            <div className="grid justify-items-start gap-2">
              <AlertLive>The reviewers could not be loaded.</AlertLive>
              <Button
                type="button"
                variant="outline"
                pending={roster.isFetching}
                onClick={() => void roster.refetch()}
              >
                {roster.isFetching ? 'Trying again…' : 'Try again'}
              </Button>
            </div>
          ) : null}

          {!roster.isPending && roster.error == null && members.length === 0 ? (
            <EmptyState
              icon={<ClipboardIcon aria-hidden />}
              title="No reviewers yet"
              description="Add someone by email to start building the review committee. They do not need an account first."
            />
          ) : null}

          {members.length > 0 ? (
            <ul className="grid gap-2" aria-label="Seated reviewers">
              {members.map((member) => (
                <li
                  key={member.contactId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <span className="grid min-w-0">
                    <span className="truncate text-sm font-medium">{member.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{member.email}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {/* The workload is the reason a roster exists, so it sits
                        beside the person rather than a click away. */}
                    <Badge variant="outline">{workloadText(member)}</Badge>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPendingRemoval(member)}
                    >
                      Remove
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {members.some((member) => member.completedCount < member.assignedCount) ? (
            <div className="flex flex-wrap items-center gap-3">
              {/* Beside the counts, because this is the only screen that knows
                  who is behind. On a mail screen an organizer would have to
                  cross-reference the roster by hand to write the same list. */}
              <Button
                type="button"
                variant="outline"
                pending={remind.isPending}
                onClick={() => {
                  setNudge(null)
                  remind.mutate(undefined, {
                    onSuccess: (result) =>
                      setNudge(
                        result.reminded === 0
                          ? 'Nobody needed a reminder.'
                          : `Reminded ${result.reminded} reviewer(s) with outstanding reviews.`,
                      ),
                  })
                }}
              >
                {remind.isPending ? 'Reminding…' : 'Remind reviewers with outstanding reviews'}
              </Button>
              {remind.error != null ? (
                <AlertLive>Those reminders could not be sent.</AlertLive>
              ) : null}
              <StatusLive aria-label="Reminder result">{nudge}</StatusLive>
            </div>
          ) : null}

          <form
            className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
            onSubmit={(event) => void submitInvite(event)}
          >
            <Field>
              <FieldLabel htmlFor="reviewer-email">Reviewer email</FieldLabel>
              <Input
                id="reviewer-email"
                type="email"
                value={email}
                aria-invalid={invalid || undefined}
                // The field POINTS at its error, as the criterion field beside
                // it does. Marked invalid with nothing described, a screen
                // reader returning to the input hears "invalid entry" and no
                // reason — and the alert it would have heard is shared with two
                // other messages.
                aria-describedby={invalid ? emailErrorId : undefined}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setInvalid(false)
                }}
              />
            </Field>
            <Button type="submit" pending={add.isPending}>
              {add.isPending ? 'Adding…' : 'Add reviewer'}
            </Button>
          </form>

          {invalid ? (
            <AlertLive id={emailErrorId}>Enter the reviewer&rsquo;s email address.</AlertLive>
          ) : null}
          {add.error != null ? (
            <AlertLive>
              That reviewer could not be added. Check the address and try again.
            </AlertLive>
          ) : null}

          {/* A provisioned reviewer may never have used the product, so the
              confirmation has to answer the question it raises: how do they get
              in? Naming the sign-in route is the difference between an invite
              and a row appearing in a list. */}
          {/* Named, because this page carries more than one polite region and
              an unnamed one is announced without saying what it is about. */}
          <StatusLive aria-label="Invite result">
            {invited === null
              ? null
              : `${invited} is on the review committee. They sign in from the home page with their email — no password, and no account needed first.`}
          </StatusLive>
        </CardContent>
        <CardFooter>
          <CardDescription>
            Assign proposals to reviewers from any submission&rsquo;s page, under Review committee.
          </CardDescription>
        </CardFooter>

        {/* The dialog stays open across the request and reports its own
            failure, per the component's contract: closing on click and
            surfacing the error at the bottom of the card reads as "removed",
            then silently is not. */}
        <ConfirmDialog
          open={pendingRemoval !== null}
          onOpenChange={(open) => setPendingRemoval(open ? pendingRemoval : null)}
          tone="destructive"
          title="Remove this reviewer"
          description={
            pendingRemoval === null
              ? ''
              : `${pendingRemoval.name || pendingRemoval.email} loses access to this event's review queue immediately, including any proposals already assigned to them. Anything they have already scored stays on record, and they keep their account.`
          }
          confirmLabel="Confirm removal"
          pending={remove.isPending}
          onConfirm={() => {
            const target = pendingRemoval
            if (target === null) return
            remove.mutate(target.contactId, {
              onSuccess: () => {
                setPendingRemoval(null)
                // The row that held focus is about to unmount underneath it.
                landOnHeading()
              },
            })
          }}
        >
          {remove.error != null ? (
            <AlertLive>
              That reviewer could not be removed. They are still on the committee.
            </AlertLive>
          ) : null}
        </ConfirmDialog>
      </Card>
    </section>
  )
}

/** One h1 for the page, identical in every state it survives into. */
/** Hundredths to a readable one-decimal score; null stays "not yet reviewed". */
function formatAggregate(centis: number | null): string {
  if (centis === null) return 'Not yet reviewed'
  return (centis / 100).toFixed(1)
}

/**
 * The results table: every proposal with what the committee scored it.
 *
 * Weighted criteria were configurable and their output was readable one
 * proposal at a time, so the question a programme committee meets to answer —
 * which proposals came out on top — had no screen. Opening each proposal and
 * remembering the number is not a ranking.
 *
 * Sorted by score, and the sort reverses, because a committee reads this list
 * from both ends: the strongest proposals to accept, and the weakest to decline.
 * A proposal nobody has scored sorts to the BOTTOM in either direction rather
 * than being treated as a zero — it has no score, and pretending it scored
 * nothing would bury it beneath proposals that were genuinely reviewed badly.
 */
function ResultsSection({ slug }: { readonly slug: EventSlug }) {
  const results = useEvaluationResults(slug)
  const [descending, setDescending] = useState(true)
  const rows = useMemo<readonly EvaluationResultRowDto[]>(() => {
    const all: EvaluationResultRowDto[] = [...(results.data ?? [])]
    all.sort((a, b) => {
      // Unscored last in BOTH directions: "no score" is not a low score.
      if (a.weightedAverageCentis === null && b.weightedAverageCentis === null) {
        return a.title.localeCompare(b.title)
      }
      if (a.weightedAverageCentis === null) return 1
      if (b.weightedAverageCentis === null) return -1
      const delta = a.weightedAverageCentis - b.weightedAverageCentis
      return descending ? -delta : delta
    })
    return all
  }, [results.data, descending])

  const exportCsv = () => {
    const header = ['Title', 'Score', 'Reviews', 'Assigned', 'Decision', 'Participants']
    const body = rows.map((row) => [
      row.title,
      row.weightedAverageCentis === null ? '' : (row.weightedAverageCentis / 100).toFixed(2),
      String(row.scoredCount),
      String(row.assignmentCount),
      row.decision,
      row.contributors.map((person) => `${person.name} (${person.role})`).join('; '),
    ])
    // Quote every field and double any embedded quote: a proposal title with a
    // comma in it would otherwise split into two columns and silently corrupt
    // every row after it.
    const csv = [header, ...body]
      .map((cells) => cells.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','))
      .join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${slug}-review-results.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardHeader>
        {/* `level` is what makes CardTitle a heading; without it the section
            is a div and vanishes from the heading outline. */}
        <CardTitle level={2}>Results</CardTitle>
        <CardDescription>
          Every proposal with the committee&apos;s weighted score, strongest first.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {results.isError ? (
          <AlertLive>The results could not be loaded.</AlertLive>
        ) : results.data === undefined ? (
          <StatusLive aria-live="polite" aria-label="Results status">
            Loading results…
          </StatusLive>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<DocumentStackIcon size={20} />}
            title="No proposals yet"
            description="Once speakers submit, their scores appear here as the committee reviews them."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                aria-pressed={descending}
                onClick={() => setDescending((current) => !current)}
              >
                {descending ? 'Sort by score: highest first' : 'Sort by score: lowest first'}
              </Button>
              <Button type="button" variant="outline" onClick={exportCsv}>
                Export results (CSV)
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Proposals by weighted review score, {descending ? 'highest' : 'lowest'} first
                </caption>
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Proposal
                    </th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Score
                    </th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">
                      Reviews
                    </th>
                    <th scope="col" className="py-1.5 font-medium">
                      Decision
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.submissionId} className="border-b border-border last:border-0">
                      <td className="py-1.5 pr-3">
                        <span className="font-medium">{row.title}</span>
                        {row.contributors.length > 0 ? (
                          <span className="block text-xs text-muted-foreground">
                            {row.contributors
                              .map((person) => `${person.name} (${person.role})`)
                              .join(', ')}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {formatAggregate(row.weightedAverageCentis)}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {row.scoredCount} of {row.assignmentCount}
                      </td>
                      <td className="py-1.5">
                        <Badge variant={row.decision === 'accepted' ? 'secondary' : 'outline'}>
                          {row.decision === 'pending' ? 'Not decided' : row.decision}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function CommitteeHeading() {
  return (
    <PageHeader>
      <PageHeaderContent>
        <PageHeaderTitle>Review committee</PageHeaderTitle>
        <PageHeaderDescription>
          The rubric every rating is scored against, and the rounds it is scored in.
        </PageHeaderDescription>
      </PageHeaderContent>
    </PageHeader>
  )
}

interface DefinedCriterion {
  readonly id: string
  readonly name: string
  readonly weight: number
  readonly position: number
}

/**
 * The rubric. Weights are relative, so a criterion weighted 2 counts twice as
 * much as one weighted 1 — which is only meaningful next to the others, hence
 * the list and the form on one surface.
 */
function CriteriaSection({
  slug,
  defined,
}: {
  readonly slug: EventSlug
  readonly defined: readonly DefinedCriterion[]
}) {
  const define = useDefineEvaluationCriteria(slug)
  const [name, setName] = useState('')
  const [weight, setWeight] = useState('1')
  const [nameMissing, setNameMissing] = useState(false)
  const nameErrorId = 'criterion-name-error'

  const handleAdd = () => {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      define.reset()
      setNameMissing(true)
      return
    }
    setNameMissing(false)
    const parsed = Number(weight)
    const safeWeight = Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : 1
    // The route defines the whole set, so everything already stored travels
    // back with the addition rather than being deleted by omission.
    define.mutate(
      [
        ...defined.map((criterion) => ({
          name: criterion.name,
          weight: criterion.weight,
          position: criterion.position,
        })),
        { name: trimmed, weight: safeWeight, position: defined.length },
      ],
      {
        onSuccess: () => {
          setName('')
          setWeight('1')
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>Criteria</CardTitle>
        <CardDescription>Relative weights: a criterion at 2 counts twice one at 1.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {defined.length === 0 ? (
          <EmptyState
            icon={<ClipboardIcon size={20} />}
            title="Define what the committee scores"
            description="Every rating is weighed against the criteria you add here."
          />
        ) : (
          <ul className="-my-1 divide-y divide-border">
            {defined.map((criterion) => (
              <li key={criterion.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate font-medium">{criterion.name}</span>
                {/* An annotation on a criterion, not a state it is in: quiet
                    ink, and no state marker to claim otherwise. */}
                <Badge variant="ghost">{`Weight ${criterion.weight}`}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CardFooter className="flex-wrap items-end gap-3">
        <Field className="min-w-48 flex-1">
          <FieldLabel htmlFor="criterion-name">Criterion name</FieldLabel>
          <Input
            id="criterion-name"
            value={name}
            aria-invalid={nameMissing ? true : undefined}
            aria-describedby={nameMissing ? nameErrorId : undefined}
            onChange={(event) => {
              setName(event.target.value)
              setNameMissing(false)
            }}
          />
        </Field>
        <Field className="w-24">
          <FieldLabel htmlFor="criterion-weight">Weight</FieldLabel>
          <Input
            id="criterion-weight"
            type="number"
            min={1}
            step={1}
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
          />
        </Field>
        <Button type="button" pending={define.isPending} onClick={handleAdd}>
          Add criterion
        </Button>
        {nameMissing ? (
          <AlertLive id={nameErrorId} className="w-full">
            A criterion name is required
          </AlertLive>
        ) : null}
        {define.isError ? (
          <AlertLive className="w-full">That criterion could not be saved.</AlertLive>
        ) : null}
      </CardFooter>
    </Card>
  )
}

interface ListedRound {
  readonly id: string
  readonly number: number
  readonly name: string
  readonly status: 'open' | 'closed'
  /** The round's own configuration; null/false on one nobody has set. */
  readonly opensAt: string | null
  readonly closesAt: string | null
  readonly anonymize: boolean
}

/** The rounds, and the two moves an organizer can make on them. */
/**
 * One round's own settings, scorecard and reviewers.
 *
 * A round used to be a number, a name and open-or-closed, sharing one rubric
 * with every other round of the event — so a shortlisting pass and a final pass
 * could not ask different questions. Everything a round can differ in now lives
 * here, under the round it belongs to rather than on a separate screen where an
 * organizer would have to remember which round they were editing.
 */
function RoundEditor({
  slug,
  round,
  committee,
}: {
  readonly slug: EventSlug
  readonly round: ListedRound
  readonly committee: readonly CommitteeRosterEntry[]
}) {
  const configure = useConfigureRound(slug, round.id)
  const scorecard = useRoundScorecard(slug, round.id)
  const saveScorecard = usePutRoundScorecard(slug, round.id)
  const pool = useRoundPool(slug, round.id)
  const savePool = usePutRoundPool(slug, round.id)

  const [name, setName] = useState(round.name)
  const [opensAt, setOpensAt] = useState(toLocalInput(round.opensAt))
  const [closesAt, setClosesAt] = useState(toLocalInput(round.closesAt))
  const [anonymize, setAnonymize] = useState(round.anonymize === true)

  const [draft, setDraft] = useState<RoundCriterionInput[]>([])
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<'rating' | 'select' | 'text'>('rating')
  const [weight, setWeight] = useState('1')
  const [choices, setChoices] = useState('')
  const [selected, setSelected] = useState<readonly string[] | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [scorecardSaved, setScorecardSaved] = useState<string | null>(null)
  const [poolSaved, setPoolSaved] = useState<string | null>(null)

  // The saved scorecard is the starting point for editing it; the local draft
  // only takes over once the organizer has actually changed something.
  const questions = draft.length > 0 ? draft : (scorecard.data ?? []).map(toCriterionInput)
  const pooled = selected ?? (pool.data ?? []).map((entry) => entry.contactId)

  return (
    <section aria-labelledby={`round-${round.id}-heading`} className="grid gap-3">
      <SectionHeading id={`round-${round.id}-heading`}>
        {`Round ${round.number}: ${round.name}`}
      </SectionHeading>

      <Card>
        <CardContent className="grid gap-3">
          <Field>
            <FieldLabel htmlFor={`round-${round.id}-name`}>Round name</FieldLabel>
            <Input
              id={`round-${round.id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {/* Local wall-clock in, canonical UTC out. The organizer types the
              time they mean; the wire carries the instant every other surface
              in this product speaks. */}
          <Field>
            <FieldLabel htmlFor={`round-${round.id}-opens`}>Reviewing opens</FieldLabel>
            <Input
              id={`round-${round.id}-opens`}
              type="datetime-local"
              value={opensAt}
              onChange={(event) => setOpensAt(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`round-${round.id}-closes`}>Reviewing closes</FieldLabel>
            <Input
              id={`round-${round.id}-closes`}
              type="datetime-local"
              value={closesAt}
              onChange={(event) => setClosesAt(event.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={anonymize}
              onChange={(event) => setAnonymize(event.target.checked)}
            />
            {/* What this actually does. It read "Hide reviewer identities",
                which is the opposite promise: the server withholds the
                SPEAKER's name from reviewers and hides no reviewer from
                anyone. An organizer running a double-blind committee would
                have got speaker anonymity and believed they had reviewer
                anonymity — a privacy promise the product never made. */}
            Hide the speaker&apos;s name from reviewers (blind review)
          </label>
          {configure.error != null ? (
            <AlertLive>That round could not be saved. Check the dates and try again.</AlertLive>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              pending={configure.isPending}
              onClick={() => {
                setSaved(null)
                configure.mutate(
                  {
                    name,
                    opensAt: toInstant(opensAt),
                    closesAt: toInstant(closesAt),
                    anonymize,
                  },
                  { onSuccess: () => setSaved('Round saved.') },
                )
              }}
            >
              {configure.isPending ? 'Saving…' : 'Save round'}
            </Button>
            {/* A save that reports nothing leaves an organizer to guess from an
                unchanged form whether it landed, and the usual guess is to
                press it again. */}
            <StatusLive aria-label="Round save state">{saved}</StatusLive>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle level={3}>Scorecard</CardTitle>
          <CardDescription>
            What reviewers are asked in this round. Only a rating is averaged — a choice and a note
            are recorded and shown, but there is no honest way to average them.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {questions.length === 0 ? (
            <EmptyState
              icon={<ClipboardIcon aria-hidden />}
              title="No questions yet"
              description="Reviewers see the event's default rating until this round asks something of its own."
            />
          ) : (
            <ul className="grid gap-1" aria-label="Scorecard questions">
              {questions.map((question, index) => (
                <li
                  key={`${question.label}-${index}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span>{question.label}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant="outline">
                      {question.kind === 'rating'
                        ? `Rating · weight ${question.weight ?? 1}`
                        : question.kind === 'select'
                          ? 'Choice'
                          : 'Free text'}
                    </Badge>
                    {/* A scorecard that can only grow is a scorecard nobody can
                        correct: a question added by mistake stayed on the form
                        every reviewer had to answer. Named for the question it
                        drops, because "Remove" repeated down a list is the same
                        control four times to anyone navigating by name. */}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setDraft(questions.filter((_, other) => other !== index))
                      }
                    >
                      <span aria-hidden="true">Remove</span>
                      <span className="sr-only">{`Remove ${question.label}`}</span>
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Field>
            <FieldLabel htmlFor={`round-${round.id}-question`}>Question</FieldLabel>
            <Input
              id={`round-${round.id}-question`}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`round-${round.id}-kind`}>Answer type</FieldLabel>
            <NativeSelect
              id={`round-${round.id}-kind`}
              value={kind}
              onChange={(event) => setKind(event.target.value as 'rating' | 'select' | 'text')}
            >
              <option value="rating">Rating</option>
              <option value="select">Choice</option>
              <option value="text">Free text</option>
            </NativeSelect>
          </Field>
          {/* Only a rating is offered a weight. Showing the field for a choice
              or a note would invite an organizer to set a number nothing can
              use, and the server would then have to refuse what the form
              suggested. */}
          {kind === 'rating' ? (
            <Field>
              {/* "Rating weight", not "Weight": the event-level rubric above
                  has a Weight field too, and two identically named controls on
                  one page are ambiguous to anyone navigating by label. */}
              {/* Named for its round as well as its kind. With two rounds on
                  screen, "Rating weight" twice is two controls a screen reader
                  reads identically and nothing distinguishes them. */}
              <FieldLabel htmlFor={`round-${round.id}-weight`}>
                {`Rating weight (Round ${round.number})`}
              </FieldLabel>
              <Input
                id={`round-${round.id}-weight`}
                type="number"
                min={1}
                value={weight}
                onChange={(event) => setWeight(event.target.value)}
              />
            </Field>
          ) : null}
          {kind === 'select' ? (
            <Field>
              <FieldLabel htmlFor={`round-${round.id}-choices`}>Choices (one per line)</FieldLabel>
              <Textarea
                id={`round-${round.id}-choices`}
                rows={3}
                value={choices}
                onChange={(event) => setChoices(event.target.value)}
              />
            </Field>
          ) : null}
          {saveScorecard.error != null ? (
            <AlertLive>That scorecard could not be saved.</AlertLive>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (label.trim() === '') return
                setDraft([
                  ...questions,
                  {
                    label: label.trim(),
                    kind,
                    weight: kind === 'rating' ? Number(weight) : null,
                    ...(kind === 'rating' ? { scale: { min: 1, max: 5 } } : {}),
                    ...(kind === 'select'
                      ? {
                          options: choices
                            .split('\n')
                            .map((choice) => choice.trim())
                            .filter((choice) => choice !== ''),
                        }
                      : {}),
                  },
                ])
                setLabel('')
                setChoices('')
                // The weight has to go back to its default too. It used to
                // persist, so an organizer who weighted one rating 2 and then
                // typed the next question straight afterwards silently weighted
                // that one 2 as well — and the weighted total the committee
                // ranks on was wrong in a way nothing on screen disclosed.
                setWeight('1')
              }}
            >
              Add question
            </Button>
            <Button
              type="button"
              pending={saveScorecard.isPending}
              onClick={() => {
                setScorecardSaved(null)
                saveScorecard.mutate(questions, {
                  onSuccess: () => setScorecardSaved('Scorecard saved.'),
                })
              }}
            >
              {saveScorecard.isPending ? 'Saving…' : 'Save scorecard'}
            </Button>
            <StatusLive aria-label="Scorecard save state">{scorecardSaved}</StatusLive>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle level={3}>Reviewers in this round</CardTitle>
          <CardDescription>
            Which committee members read this time. Everyone here holds a seat — the seat is what
            grants access, and this narrows it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {committee.length === 0 ? (
            <CardDescription>Add reviewers above before pooling them into a round.</CardDescription>
          ) : (
            <ul className="grid gap-1" aria-label="Reviewers in this round">
              {committee.map((member) => (
                <li key={member.contactId}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={pooled.includes(member.contactId)}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? [...pooled, member.contactId]
                            : pooled.filter((id) => id !== member.contactId),
                        )
                      }
                    />
                    {member.name || member.email}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {savePool.error != null ? (
            <AlertLive>Those reviewers could not be saved to this round.</AlertLive>
          ) : null}
          <div>
            <Button
              type="button"
              pending={savePool.isPending}
              onClick={() => {
                setPoolSaved(null)
                savePool.mutate(pooled, {
                  onSuccess: () => setPoolSaved('Reviewers saved for this round.'),
                })
              }}
            >
              {savePool.isPending ? 'Saving…' : 'Save reviewers'}
            </Button>
            <StatusLive aria-label="Round reviewers save state">{poolSaved}</StatusLive>
          </div>
        </CardContent>
      </Card>

      <ShareOutCard slug={slug} round={round} hasReviewers={committee.length > 0} />
    </section>
  )
}

/**
 * Sharing this round's reading out among its reviewers in one action.
 *
 * A committee reading five proposals can be assigned one at a time. A committee
 * reading two hundred cannot, and an organizer who has to click three hundred
 * times reaches for a spreadsheet instead — so the tool has to be able to do
 * the arithmetic it is asking them to do by hand.
 *
 * Readers-per-proposal is a TARGET, and the copy says so, because the safety of
 * pressing this twice is the whole reason it is expressed that way.
 */
function ShareOutCard({
  slug,
  round,
  hasReviewers,
}: {
  readonly slug: EventSlug
  readonly round: ListedRound
  readonly hasReviewers: boolean
}) {
  const distribute = useDistributeRound(slug, round.id)
  const [readers, setReaders] = useState('2')
  const [cap, setCap] = useState('')
  const [track, setTrack] = useState('')
  const [outcome, setOutcome] = useState<string | null>(null)
  const readersId = `share-readers-${round.id}`
  const capId = `share-cap-${round.id}`
  const trackId = `share-track-${round.id}`
  const closed = round.status === 'closed'

  const handleShare = () => {
    setOutcome(null)
    const readerCount = Number(readers)
    const capCount = cap.trim() === '' ? null : Number(cap)
    distribute.mutate(
      {
        readersPerSubmission: Number.isFinite(readerCount) ? readerCount : 1,
        ...(capCount !== null && Number.isFinite(capCount) ? { perReviewerCap: capCount } : {}),
        ...(track.trim() === '' ? {} : { track: track.trim() }),
      },
      {
        onSuccess: (result) => {
          // What it did, in numbers, rather than a bare success. An organizer
          // needs to know that some proposals came back short — a cap set too
          // low is invisible in a green tick.
          setOutcome(
            result.unassigned === 0
              ? `Shared out ${result.assigned} assignment(s) across ${result.reviewers} reviewer(s).`
              : `Shared out ${result.assigned} assignment(s) across ${result.reviewers} reviewer(s). ${result.unassigned} proposal(s) still need a reader.`,
          )
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle level={3}>Share the reading out</CardTitle>
        <CardDescription>
          Gives every proposal the number of reviewers you ask for, spread evenly across the
          reviewers in this round. Nobody is given the same proposal twice, so running it again
          only fills what is still short.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Field>
          <FieldLabel htmlFor={readersId}>Reviewers per proposal</FieldLabel>
          <Input
            id={readersId}
            type="number"
            min={1}
            value={readers}
            onChange={(event) => setReaders(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={capId}>Most proposals per reviewer (optional)</FieldLabel>
          <Input
            id={capId}
            type="number"
            min={1}
            value={cap}
            placeholder="No limit"
            onChange={(event) => setCap(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={trackId}>Only this track (optional)</FieldLabel>
          <Input
            id={trackId}
            value={track}
            placeholder="Every track"
            onChange={(event) => setTrack(event.target.value)}
          />
        </Field>
        {distribute.error != null ? (
          <AlertLive>The reading could not be shared out.</AlertLive>
        ) : null}
        {outcome !== null ? <StatusLive>{outcome}</StatusLive> : null}
        <div>
          <Button
            type="button"
            pending={distribute.isPending}
            disabled={closed || !hasReviewers}
            onClick={handleShare}
          >
            {distribute.isPending ? 'Sharing…' : 'Share the reading out'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * A stored instant as a `datetime-local` value, or blank when there is none.
 *
 * Tolerates an absent field as well as a null one. A payload from a build that
 * predates these columns should render an empty date box, not take the whole
 * committee page down with it — a crash here blanks every other control on the
 * screen too.
 */
function toLocalInput(instant: string | null | undefined): string {
  return typeof instant === 'string' ? instant.slice(0, 16) : ''
}

/** A `datetime-local` value as the canonical instant the wire carries. */
function toInstant(local: string): string | null {
  return local === '' ? null : `${local}:00.000Z`
}

function toCriterionInput(criterion: RoundCriterion): RoundCriterionInput {
  return {
    label: criterion.label,
    kind: criterion.kind,
    weight: criterion.weight,
    scale: criterion.scale,
    options: criterion.options,
  }
}

function RoundsSection({
  slug,
  rounds,
  committee,
}: {
  readonly slug: EventSlug
  readonly rounds: readonly ListedRound[]
  readonly committee: readonly CommitteeRosterEntry[]
}) {
  const run = useRunEventRounds(slug)
  const [confirmRound, setConfirmRound] = useState<'open' | 'close' | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  /**
   * Closing the open round removes "Close round N" and opening one renumbers
   * it, so the confirm dialog hands focus back to a trigger that is no longer
   * there and it lands on <body>. The card's own heading is always mounted and
   * is a landing place rather than another action.
   */
  const landOnHeading = () => headingRef.current?.focus()
  const liveRound = rounds.filter((round) => round.status === 'open').at(-1) ?? null
  const nextNumber = rounds.reduce((best, round) => Math.max(best, round.number), 0) + 1

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle level={2} ref={headingRef} tabIndex={-1} className="outline-hidden">
            Review rounds
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {/* Named, like the invite region above it. This one is never empty, so
            on a page carrying more than one polite region an unnamed instance
            is announced without saying what it is about (DEC-014), and the
            submission page labels its twin for the same reason. */}
          <StatusLive aria-label="Review round state">
            {liveRound === null ? 'No review round is open.' : `Round ${liveRound.number} is open.`}
          </StatusLive>
          {rounds.length === 0 ? null : (
            <ul className="-my-1 divide-y divide-border">
              {rounds.map((round) => (
                <li key={round.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {`Round ${round.number}: ${round.name}`}
                  </span>
                  {/* A round's status is a lifecycle state, so the chip carries
                    the state marker — and while a close is actually in the
                    air, that marker is the thing that says so. Only the open
                    round is moving: opening a round creates a new one, and no
                    chip on screen is waiting on that. The LABEL does not
                    change while the wait lasts; it is still the state the
                    server last confirmed, and it stays true until the server
                    says otherwise. The animation is silent by design — this
                    card already owns the page's live region, and a second
                    voice announcing the same wait is not an improvement. */}
                  <Badge
                    variant={round.status === 'closed' ? 'outline' : 'secondary'}
                    dot
                    pending={run.close.isPending && round.id === liveRound?.id}
                  >
                    {round.status === 'closed' ? 'Closed' : 'Open'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {run.open.isError || run.close.isError ? (
            <AlertLive>That review round could not be changed.</AlertLive>
          ) : null}
        </CardContent>
        <CardFooter className="flex-wrap gap-3">
          {liveRound === null ? null : (
            <Button
              type="button"
              variant="outline"
              pending={run.close.isPending}
              onClick={() => setConfirmRound('close')}
            >
              {`Close round ${liveRound.number}`}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            pending={run.open.isPending}
            onClick={() => setConfirmRound('open')}
          >
            {`Open round ${nextNumber}`}
          </Button>
          {/* Same two questions the submission-level panel asks, from the same
            module: closing is one-way, and opening moves what the committee
            is scoring. */}
          {liveRound === null ? null : (
            <RoundConfirmDialog
              open={confirmRound === 'close'}
              onOpenChange={(next) => {
                if (!next) setConfirmRound(null)
              }}
              kind="close"
              number={liveRound.number}
              pending={run.close.isPending}
              failed={run.close.isError}
              onConfirm={() =>
                run.close.mutate(liveRound.id, {
                  onSuccess: () => {
                    setConfirmRound(null)
                    landOnHeading()
                  },
                })
              }
            />
          )}
          <RoundConfirmDialog
            open={confirmRound === 'open'}
            onOpenChange={(next) => {
              if (!next) setConfirmRound(null)
            }}
            kind="open"
            number={nextNumber}
            pending={run.open.isPending}
            failed={run.open.isError}
            onConfirm={() =>
              run.open.mutate(
                { number: nextNumber, name: `Round ${nextNumber}` },
                {
                  onSuccess: () => {
                    setConfirmRound(null)
                    landOnHeading()
                  },
                },
              )
            }
          />
        </CardFooter>
      </Card>

      {/* Each round's own settings, scorecard and reviewers, under the round
          they belong to rather than on a separate screen where an organizer
          would have to remember which round they were editing. */}
      {rounds.map((round) => (
        <RoundEditor key={round.id} slug={slug} round={round} committee={committee} />
      ))}
    </div>
  )
}
