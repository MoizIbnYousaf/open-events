import { beforeEach, describe, expect, it } from 'vitest'

import { ApplicationError, EvaluationService } from '../../../src/application'
import type { Clock } from '../../../src/application'
import type { Contact } from '../../../src/domain'
import {
  EVENT_ID,
  FIXED_NOW,
  NOW,
  createSubmission,
  createSubmitterActor,
  organizerActor,
} from '../helpers/fixtures'
import { InMemoryEvaluationRepository } from '../helpers/in-memory-evaluations'
import {
  InMemoryContactRepository,
  InMemoryFormVersionRepository,
  InMemorySubmissionRepository,
} from '../helpers/in-memory-repositories'

const REVIEWER_ONE_ID = 'contact-reviewer-one'
const REVIEWER_TWO_ID = 'contact-reviewer-two'
const REVIEWER_ONE_EMAIL = 'reviewer.one@example.test'
const REVIEWER_TWO_EMAIL = 'reviewer.two@example.test'
const LATER = '2026-05-21T09:00:00.000Z'

const submission = createSubmission()
const otherSubmission = createSubmission({
  id: 'submission-2',
  originDraftId: 'draft-2',
  title: 'Another proposal',
})
const foreignSubmission = createSubmission({
  id: 'submission-foreign',
  eventId: 'event-other',
  originDraftId: 'draft-foreign',
  title: 'Foreign proposal',
})

function contact(id: string, email: string, name: string): Contact {
  return { id, email, name, createdAt: NOW }
}

let now: string
let evaluations: InMemoryEvaluationRepository
let submissions: InMemorySubmissionRepository
let contacts: InMemoryContactRepository
let service: EvaluationService

const clock: Clock = { now: () => now }

/** Organizer setup shared by most cases: one criterion, one open round. */
async function defineDefaults(): Promise<string> {
  await service.defineCriteria(organizerActor, EVENT_ID, {
    criteria: [{ name: 'Overall fit', weight: 1, position: 0 }],
  })
  const round = await service.openRound(organizerActor, EVENT_ID, { number: 1, name: 'Round 1' })
  return round.id
}

beforeEach(() => {
  now = FIXED_NOW
  evaluations = new InMemoryEvaluationRepository()
  submissions = new InMemorySubmissionRepository(new InMemoryFormVersionRepository(), [
    submission,
    otherSubmission,
    foreignSubmission,
  ])
  contacts = new InMemoryContactRepository([
    contact(REVIEWER_ONE_ID, REVIEWER_ONE_EMAIL, 'Reviewer One'),
    contact(REVIEWER_TWO_ID, REVIEWER_TWO_EMAIL, 'Reviewer Two'),
  ])
  service = new EvaluationService(submissions, contacts, evaluations, clock)
})

describe('EvaluationService criteria', () => {
  it('defines weighted criteria and lists them in position order', async () => {
    const defined = await service.defineCriteria(organizerActor, EVENT_ID, {
      criteria: [
        { name: 'Relevance', weight: 3, position: 1 },
        { name: 'Overall fit', weight: 1, position: 0 },
      ],
    })

    expect(defined.map((criterion) => criterion.name)).toEqual(['Overall fit', 'Relevance'])
    expect(defined.map((criterion) => criterion.weight)).toEqual([1, 3])
    expect(defined.every((criterion) => criterion.eventId === EVENT_ID)).toBe(true)
    expect(new Set(defined.map((criterion) => criterion.id)).size).toBe(2)
    expect(await service.listCriteria(organizerActor, EVENT_ID)).toEqual(defined)
  })

  it('keeps the identity of a criterion when it is redefined by name', async () => {
    const [first] = await service.defineCriteria(organizerActor, EVENT_ID, {
      criteria: [{ name: 'Overall fit', weight: 1, position: 0 }],
    })
    const [second] = await service.defineCriteria(organizerActor, EVENT_ID, {
      criteria: [{ name: 'Overall fit', weight: 4, position: 0 }],
    })

    expect(second?.id).toBe(first?.id)
    expect(second?.weight).toBe(4)
    expect(await service.listCriteria(organizerActor, EVENT_ID)).toHaveLength(1)
  })

  it('breaks a shared position by code unit, exactly like the SQL adapter', async () => {
    // SQLite compares TEXT with BINARY collation, so 'Z' (0x5A) sorts before
    // 'a' (0x61). A locale-aware comparator would answer the other way round,
    // and the port pins one order for both adapters.
    const defined = await service.defineCriteria(organizerActor, EVENT_ID, {
      criteria: [
        { name: 'audience', weight: 1, position: 1 },
        { name: 'Zeal', weight: 1, position: 1 },
      ],
    })

    expect(defined.map((criterion) => criterion.name)).toEqual(['Zeal', 'audience'])
  })

  it('rejects an empty set, a blank name, a duplicate name and an out-of-bounds weight', async () => {
    const cases = [
      { criteria: [] },
      { criteria: [{ name: '   ', weight: 1, position: 0 }] },
      {
        criteria: [
          { name: 'Overall fit', weight: 1, position: 0 },
          { name: 'Overall fit', weight: 2, position: 1 },
        ],
      },
      { criteria: [{ name: 'Overall fit', weight: 0, position: 0 }] },
      { criteria: [{ name: 'Overall fit', weight: 1.5, position: 0 }] },
      { criteria: [{ name: 'Overall fit', weight: 1, position: -1 }] },
    ]
    for (const input of cases) {
      await expect(service.defineCriteria(organizerActor, EVENT_ID, input)).rejects.toMatchObject({
        code: 'validation_failed',
      })
    }
    expect(await service.listCriteria(organizerActor, EVENT_ID)).toEqual([])
  })
})

describe('EvaluationService rounds', () => {
  it('opens a numbered round and lists rounds by number', async () => {
    const first = await service.openRound(organizerActor, EVENT_ID, { number: 1, name: 'Round 1' })
    const second = await service.openRound(organizerActor, EVENT_ID, { number: 2, name: 'Round 2' })

    expect(first.status).toBe('open')
    expect(first.number).toBe(1)
    expect((await service.listRounds(organizerActor, EVENT_ID)).map((round) => round.id)).toEqual([
      first.id,
      second.id,
    ])
  })

  it('is idempotent when the same open round number is opened again', async () => {
    const first = await service.openRound(organizerActor, EVENT_ID, { number: 1, name: 'Round 1' })
    const again = await service.openRound(organizerActor, EVENT_ID, { number: 1, name: 'Renamed' })

    expect(again.id).toBe(first.id)
    expect(again.name).toBe('Round 1')
    expect(await service.listRounds(organizerActor, EVENT_ID)).toHaveLength(1)
  })

  it('closes a round idempotently and never reopens it', async () => {
    const round = await service.openRound(organizerActor, EVENT_ID, { number: 1, name: 'Round 1' })

    const closed = await service.closeRound(organizerActor, EVENT_ID, round.id)
    expect(closed.status).toBe('closed')
    expect((await service.closeRound(organizerActor, EVENT_ID, round.id)).status).toBe('closed')

    await expect(
      service.openRound(organizerActor, EVENT_ID, { number: 1, name: 'Round 1' }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('rejects an unknown round with not_found and invalid round input with validation_failed', async () => {
    await expect(
      service.closeRound(organizerActor, EVENT_ID, 'round-missing'),
    ).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(
      service.openRound(organizerActor, EVENT_ID, { number: 0, name: 'Round 0' }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(
      service.openRound(organizerActor, EVENT_ID, { number: 1, name: '  ' }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })
})

describe('EvaluationService assignments', () => {
  beforeEach(async () => {
    await defineDefaults()
  })

  it('resolves the evaluator email to a contact and is idempotent per round', async () => {
    const assignment = await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: '  Reviewer.One@Example.Test ',
    })
    const again = await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })

    expect(assignment.evaluatorContactId).toBe(REVIEWER_ONE_ID)
    expect(assignment.evaluatorEmail).toBe(REVIEWER_ONE_EMAIL)
    expect(assignment.submissionId).toBe(submission.id)
    expect(assignment.createdAt).toBe(FIXED_NOW)
    expect(again.id).toBe(assignment.id)
    expect(await service.listAssignments(organizerActor, EVENT_ID, submission.id)).toHaveLength(1)
  })

  it('rejects an unknown submission and a malformed email, but provisions a new reviewer', async () => {
    await expect(
      service.assign(organizerActor, EVENT_ID, 'submission-missing', {
        evaluatorEmail: REVIEWER_ONE_EMAIL,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
    // Handing someone reading is itself the act of provisioning them: an email
    // nobody has used yet becomes a contact rather than a refusal.
    const provisioned = await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: 'nobody@example.test',
    })
    expect(provisioned.evaluatorEmail).toBe('nobody@example.test')
    // And the committee auto-add that always followed a successful resolve
    // still happens for the identity that was just created.
    expect(await service.isOnCommittee(EVENT_ID, provisioned.evaluatorContactId)).toBe(true)
    await expect(
      service.assign(organizerActor, EVENT_ID, submission.id, { evaluatorEmail: 'not-an-email' }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('reuses an existing contact and never rewrites its name or bio', async () => {
    // Email is the identity key, so an organizer assigning an address that
    // already belongs to a real person must reuse that row. Overwriting the
    // name from an assignment box would let one event rename someone globally.
    const assignment = await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })
    expect(assignment.evaluatorContactId).toBe(REVIEWER_ONE_ID)
    const stored = await contacts.findByEmail(REVIEWER_ONE_EMAIL)
    expect(stored?.name).toBe('Reviewer One')
    expect(stored?.bio).toBeUndefined()
    expect(contacts.list().filter((c) => c.email === REVIEWER_ONE_EMAIL)).toHaveLength(1)
  })

  it('refuses to assign into a closed round or when no round is open', async () => {
    const rounds = await service.listRounds(organizerActor, EVENT_ID)
    const roundId = rounds[0]?.id ?? ''
    await service.closeRound(organizerActor, EVENT_ID, roundId)

    await expect(
      service.assign(organizerActor, EVENT_ID, submission.id, {
        evaluatorEmail: REVIEWER_ONE_EMAIL,
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
    await expect(
      service.assign(organizerActor, EVENT_ID, submission.id, {
        evaluatorEmail: REVIEWER_ONE_EMAIL,
        roundId,
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('never reaches a round belonging to another event', async () => {
    const foreignRound = await service.openRound(organizerActor, 'event-other', {
      number: 1,
      name: 'Other round',
    })

    await expect(
      service.assign(organizerActor, EVENT_ID, submission.id, {
        evaluatorEmail: REVIEWER_ONE_EMAIL,
        roundId: foreignRound.id,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('EvaluationService evaluator scoping', () => {
  let roundOneId: string

  beforeEach(async () => {
    roundOneId = await defineDefaults()
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })
  })

  it('denies an evaluator with no assignment in the event', async () => {
    const actor = createSubmitterActor({ contactId: REVIEWER_TWO_ID })

    await expect(service.listOwnEvaluations(actor)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(service.listOwnEvaluations(actor)).rejects.toBeInstanceOf(ApplicationError)
    await expect(
      service.upsertScore(actor, { submissionId: submission.id, rating: 4 }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('lists only assigned submissions and hides everything else', async () => {
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })

    const rows = await service.listOwnEvaluations(actor)
    // An unscored assignment says so with nulls; it never borrows the
    // off-scale 0 that the very same endpoint refuses on the way back in.
    expect(rows).toEqual([
      {
        submissionId: submission.id,
        sessionTitle: submission.title,
        roundId: roundOneId,
        roundNumber: 1,
        roundName: 'Round 1',
        roundStatus: 'open',
        rating: null,
        comments: null,
        updatedAt: null,
        previousRounds: [],
        // A round nobody has made blind names the speaker; this double holds
        // no contact for the owner, so there is no name to give.
        speakerName: null,
        anonymized: false,
      },
    ])
    expect(rows.map((row) => row.submissionId)).not.toContain(otherSubmission.id)
  })

  it('refuses to score a submission the evaluator is not assigned to', async () => {
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })

    await expect(
      service.upsertScore(actor, { submissionId: otherSubmission.id, rating: 5 }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      service.upsertScore(actor, { submissionId: foreignSubmission.id, rating: 5 }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('never surfaces an assignment from another event', async () => {
    const crossEvent = createSubmitterActor({ contactId: REVIEWER_ONE_ID, eventId: 'event-other' })

    await expect(service.listOwnEvaluations(crossEvent)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })
})

describe('EvaluationService scoring', () => {
  let roundOneId: string

  beforeEach(async () => {
    roundOneId = await defineDefaults()
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })
  })

  it('records a rating on the default criterion and returns the evaluator row', async () => {
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })

    const row = await service.upsertScore(actor, {
      submissionId: submission.id,
      rating: 4,
      comments: '  Strong fit  ',
    })

    expect(row).toEqual({
      submissionId: submission.id,
      sessionTitle: submission.title,
      roundId: roundOneId,
      roundNumber: 1,
      roundName: 'Round 1',
      roundStatus: 'open',
      rating: 4,
      comments: 'Strong fit',
      updatedAt: FIXED_NOW,
      previousRounds: [],
      speakerName: null,
      anonymized: false,
    })
    expect(await service.listOwnEvaluations(actor)).toEqual([row])
  })

  it('upserts in place: a second score keeps one row and moves only updatedAt', async () => {
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })
    await service.upsertScore(actor, { submissionId: submission.id, rating: 4 })
    now = LATER
    const updated = await service.upsertScore(actor, {
      submissionId: submission.id,
      rating: 2,
      comments: 'Reconsidered',
    })

    expect(updated.rating).toBe(2)
    expect(updated.comments).toBe('Reconsidered')
    expect(updated.updatedAt).toBe(LATER)
    const rows = await service.listOwnEvaluations(actor)
    expect(rows).toHaveLength(1)
    const summary = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)
    expect(summary.scoreCount).toBe(1)
  })

  it('treats a blank comment as no comment when nothing was written before', async () => {
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })

    const withoutComment = await service.upsertScore(actor, {
      submissionId: submission.id,
      rating: 3,
    })
    expect(withoutComment.comments).toBeNull()

    const blankComment = await service.upsertScore(actor, {
      submissionId: submission.id,
      rating: 3,
      comments: '   ',
    })
    expect(blankComment.comments).toBeNull()
  })

  it('keeps a written comment when a later rating-only edit omits the key', async () => {
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })
    await service.upsertScore(actor, {
      submissionId: submission.id,
      rating: 4,
      comments: 'Strong fit',
    })

    const ratingOnly = await service.upsertScore(actor, { submissionId: submission.id, rating: 2 })

    expect(ratingOnly.rating).toBe(2)
    expect(ratingOnly.comments).toBe('Strong fit')
    expect((await service.listOwnEvaluations(actor))[0]?.comments).toBe('Strong fit')
  })

  it('clears a written comment only when the evaluator sends one explicitly empty', async () => {
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })
    await service.upsertScore(actor, {
      submissionId: submission.id,
      rating: 4,
      comments: 'Strong fit',
    })

    const cleared = await service.upsertScore(actor, {
      submissionId: submission.id,
      rating: 4,
      comments: '',
    })
    expect(cleared.comments).toBeNull()

    await service.upsertScore(actor, {
      submissionId: submission.id,
      rating: 4,
      comments: 'Second thoughts',
    })
    const nulled = await service.upsertScore(actor, {
      submissionId: submission.id,
      rating: 4,
      comments: null,
    })
    expect(nulled.comments).toBeNull()
  })

  it('rejects a rating outside the integer scale', async () => {
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })

    for (const rating of [0, 6, 2.5, Number.NaN]) {
      await expect(
        service.upsertScore(actor, { submissionId: submission.id, rating }),
      ).rejects.toMatchObject({ code: 'validation_failed' })
    }
  })

  it('rejects a score once the round is closed', async () => {
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })
    await service.closeRound(organizerActor, EVENT_ID, roundOneId)

    await expect(
      service.upsertScore(actor, { submissionId: submission.id, rating: 5 }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect((await service.listOwnEvaluations(actor))[0]?.rating).toBeNull()
  })
})

describe('EvaluationService weighted summary', () => {
  it('weights each criterion and reports integer totals for two evaluators', async () => {
    await service.defineCriteria(organizerActor, EVENT_ID, {
      criteria: [
        { name: 'Overall fit', weight: 1, position: 0 },
        { name: 'Relevance', weight: 3, position: 1 },
      ],
    })
    await service.openRound(organizerActor, EVENT_ID, { number: 1, name: 'Round 1' })
    const first = await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })
    const second = await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_TWO_EMAIL,
    })
    const criteria = await service.listCriteria(organizerActor, EVENT_ID)
    const overall = criteria[0]
    const relevance = criteria[1]
    if (overall === undefined || relevance === undefined) throw new Error('expected two criteria')

    await evaluations.upsertScore({
      id: 'score-1',
      eventId: EVENT_ID,
      assignmentId: first.id,
      criterionId: overall.id,
      rating: 4,
      comment: null,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    await evaluations.upsertScore({
      id: 'score-2',
      eventId: EVENT_ID,
      assignmentId: second.id,
      criterionId: relevance.id,
      rating: 5,
      comment: null,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })

    const summary = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)

    expect(summary.submissionId).toBe(submission.id)
    expect(summary.title).toBe(submission.title)
    expect(summary.assignmentCount).toBe(2)
    expect(summary.scoreCount).toBe(2)
    expect(summary.weightSum).toBe(4)
    expect(summary.weightedTotal).toBe(19)
    expect(summary.weightedAverageCentis).toBe(475)
    expect(summary.criteria).toEqual([
      { criterionId: overall.id, name: 'Overall fit', weight: 1, scoreCount: 1, ratingSum: 4 },
      { criterionId: relevance.id, name: 'Relevance', weight: 3, scoreCount: 1, ratingSum: 5 },
    ])
    // The headline numbers are the current round's numbers, and the round they
    // belong to is named rather than assumed.
    const rounds = await service.listRounds(organizerActor, EVENT_ID)
    expect(summary.currentRoundId).toBe(rounds[0]?.id)
    expect(summary.rounds).toHaveLength(1)
    expect(summary.rounds[0]).toMatchObject({
      roundId: rounds[0]?.id,
      number: 1,
      name: 'Round 1',
      status: 'open',
      assignmentCount: 2,
      scoredCount: 2,
      scoreCount: 2,
      weightSum: 4,
      weightedTotal: 19,
      weightedAverageCentis: 475,
    })
  })

  it('reports zeros for a submission with no scores and 404s an unknown submission', async () => {
    const roundOneId = await defineDefaults()

    const summary = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)
    expect(summary.currentRoundId).toBe(roundOneId)
    expect(summary.scoreCount).toBe(0)
    expect(summary.scoredCount).toBe(0)
    expect(summary.weightedTotal).toBe(0)
    expect(summary.weightedAverageCentis).toBe(0)
    expect(summary.rounds).toHaveLength(1)

    await expect(
      service.weightedSummary(organizerActor, EVENT_ID, 'submission-missing'),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('reports no current round and no rounds before the organizer opens one', async () => {
    await service.defineCriteria(organizerActor, EVENT_ID, {
      criteria: [{ name: 'Overall fit', weight: 1, position: 0 }],
    })

    const summary = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)

    expect(summary.currentRoundId).toBeNull()
    expect(summary.rounds).toEqual([])
    expect(summary.assignmentCount).toBe(0)
    expect(summary.scoreCount).toBe(0)
  })
})

describe('EvaluationService multi-round evaluator rows', () => {
  /** Round 1 scored and closed, round 2 open, the same evaluator re-assigned. */
  async function reassignInSecondRound(): Promise<{
    readonly roundOneId: string
    readonly roundTwoId: string
  }> {
    const roundOneId = await defineDefaults()
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })
    await service.upsertScore(actor, {
      submissionId: submission.id,
      rating: 5,
      comments: 'Round one view',
    })
    await service.closeRound(organizerActor, EVENT_ID, roundOneId)
    const roundTwo = await service.openRound(organizerActor, EVENT_ID, {
      number: 2,
      name: 'Round 2',
    })
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })
    return { roundOneId, roundTwoId: roundTwo.id }
  }

  it('collapses two rounds on one submission to a single row that names its round', async () => {
    const { roundTwoId } = await reassignInSecondRound()
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })

    const rows = await service.listOwnEvaluations(actor)

    // The evaluator is looking at round 2 and has not scored it yet — and can
    // still read exactly what they themselves said in round 1.
    expect(rows).toEqual([
      {
        submissionId: submission.id,
        sessionTitle: submission.title,
        roundId: roundTwoId,
        roundNumber: 2,
        roundName: 'Round 2',
        roundStatus: 'open',
        rating: null,
        comments: null,
        updatedAt: null,
        previousRounds: [
          {
            roundNumber: 1,
            roundName: 'Round 1',
            rating: 5,
            comments: 'Round one view',
            updatedAt: FIXED_NOW,
          },
        ],
        speakerName: null,
        anonymized: false,
      },
    ])
    expect(new Set(rows.map((row) => row.submissionId)).size).toBe(rows.length)
    expect(await service.listAssignments(organizerActor, EVENT_ID, submission.id)).toHaveLength(2)
  })

  it('lists the row the evaluator can write, so a second-round score lands on it', async () => {
    await reassignInSecondRound()
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })
    now = LATER

    const written = await service.upsertScore(actor, { submissionId: submission.id, rating: 2 })

    expect(written.rating).toBe(2)
    expect(written.updatedAt).toBe(LATER)
    expect(await service.listOwnEvaluations(actor)).toEqual([written])
  })

  it('falls back to the latest round once every round is closed', async () => {
    await reassignInSecondRound()
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })
    now = LATER
    await service.upsertScore(actor, { submissionId: submission.id, rating: 2 })
    const rounds = await service.listRounds(organizerActor, EVENT_ID)
    await service.closeRound(organizerActor, EVENT_ID, rounds[1]?.id ?? '')

    const rows = await service.listOwnEvaluations(actor)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.rating).toBe(2)
    expect(rows[0]?.updatedAt).toBe(LATER)
  })
})

describe('EvaluationService weighted summary across rounds', () => {
  /**
   * Round 1 scored 5 and closed, round 2 open with the same evaluator
   * re-assigned and scoring again: the headline numbers follow the round that
   * is live, and round 1 keeps reporting exactly what it concluded.
   */
  async function rescoreInSecondRound(rating: number): Promise<{
    readonly roundOneId: string
    readonly roundTwoId: string
  }> {
    const roundOneId = await defineDefaults()
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })
    await service.upsertScore(actor, { submissionId: submission.id, rating: 5 })
    await service.closeRound(organizerActor, EVENT_ID, roundOneId)
    const roundTwo = await service.openRound(organizerActor, EVENT_ID, {
      number: 2,
      name: 'Round 2',
    })
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })
    now = LATER
    await service.upsertScore(actor, { submissionId: submission.id, rating })
    return { roundOneId, roundTwoId: roundTwo.id }
  }

  it('reports the live round on top and keeps the closed round beside it', async () => {
    const { roundOneId, roundTwoId } = await rescoreInSecondRound(1)
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })

    const summary = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)

    expect(await service.listAssignments(organizerActor, EVENT_ID, submission.id)).toHaveLength(2)
    expect(summary.currentRoundId).toBe(roundTwoId)
    expect(summary.assignmentCount).toBe(1)
    expect(summary.scoreCount).toBe(1)
    expect(summary.weightSum).toBe(1)
    expect(summary.weightedTotal).toBe(1)
    expect(summary.weightedAverageCentis).toBe(100)
    expect(summary.criteria[0]?.scoreCount).toBe(1)
    expect(summary.criteria[0]?.ratingSum).toBe(1)
    // Round 1 concluded at 5 and still says so.
    expect(summary.rounds.find((entry) => entry.roundId === roundOneId)).toMatchObject({
      number: 1,
      status: 'closed',
      assignmentCount: 1,
      scoredCount: 1,
      scoreCount: 1,
      weightedTotal: 5,
      weightedAverageCentis: 500,
    })
    // The headline rating is exactly the one the evaluator is shown and can edit.
    expect((await service.listOwnEvaluations(actor))[0]?.rating).toBe(1)
  })

  it('never lets a retired rating outvote the live ratings of the committee', async () => {
    const { roundOneId } = await rescoreInSecondRound(1)
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_TWO_EMAIL,
    })
    await service.upsertScore(createSubmitterActor({ contactId: REVIEWER_TWO_ID }), {
      submissionId: submission.id,
      rating: 2,
    })

    const summary = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)

    expect(summary.assignmentCount).toBe(2)
    expect(summary.scoreCount).toBe(2)
    expect(summary.weightedTotal).toBe(3)
    expect(summary.weightedAverageCentis).toBe(150)
    expect(summary.rounds.find((entry) => entry.roundId === roundOneId)?.weightedTotal).toBe(5)
  })

  it('keeps counting the closed round once it is the only round left', async () => {
    const roundOneId = await defineDefaults()
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })
    await service.upsertScore(createSubmitterActor({ contactId: REVIEWER_ONE_ID }), {
      submissionId: submission.id,
      rating: 4,
    })
    await service.closeRound(organizerActor, EVENT_ID, roundOneId)

    const summary = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)

    expect(summary.currentRoundId).toBe(roundOneId)
    expect(summary.assignmentCount).toBe(1)
    expect(summary.scoreCount).toBe(1)
    expect(summary.weightedTotal).toBe(4)
    expect(summary.rounds).toHaveLength(1)
  })

  it('reads two open rounds as two rounds, with the newest one live', async () => {
    const roundOneId = await defineDefaults()
    const second = await service.openRound(organizerActor, EVENT_ID, { number: 2, name: 'Round 2' })
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
      roundId: roundOneId,
    })
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
      roundId: second.id,
    })
    await service.upsertScore(createSubmitterActor({ contactId: REVIEWER_ONE_ID }), {
      submissionId: submission.id,
      rating: 3,
    })

    const summary = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)

    expect(await service.listAssignments(organizerActor, EVENT_ID, submission.id)).toHaveLength(2)
    // The rating went to the round the evaluator is working in: round 2.
    expect(summary.currentRoundId).toBe(second.id)
    expect(summary.assignmentCount).toBe(1)
    expect(summary.scoreCount).toBe(1)
    expect(summary.weightedTotal).toBe(3)
    expect(summary.rounds.map((entry) => entry.number)).toEqual([1, 2])
    expect(summary.rounds[0]).toMatchObject({ assignmentCount: 1, scoredCount: 0, scoreCount: 0 })
  })
})

// The integrator's rulings R1-R3, proved as the brief reproduces them.
describe('EvaluationService round results are preserved and readable', () => {
  it('E1 keeps the committee result when round 2 opens and the committee is re-assigned', async () => {
    const roundOneId = await defineDefaults()
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_TWO_EMAIL,
    })
    await service.upsertScore(createSubmitterActor({ contactId: REVIEWER_ONE_ID }), {
      submissionId: submission.id,
      rating: 5,
    })
    await service.upsertScore(createSubmitterActor({ contactId: REVIEWER_TWO_ID }), {
      submissionId: submission.id,
      rating: 4,
    })

    const beforeRoundTwo = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)
    expect(beforeRoundTwo.scoreCount).toBe(2)
    expect(beforeRoundTwo.weightedTotal).toBe(9)
    expect(beforeRoundTwo.weightedAverageCentis).toBe(450)

    await service.closeRound(organizerActor, EVENT_ID, roundOneId)
    const roundTwo = await service.openRound(organizerActor, EVENT_ID, {
      number: 2,
      name: 'Round 2',
    })
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_TWO_EMAIL,
    })

    const after = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)

    expect(after.currentRoundId).toBe(roundTwo.id)
    expect(after.assignmentCount).toBe(2)
    expect(after.scoredCount).toBe(0)
    expect(after.rounds.find((entry) => entry.roundId === roundOneId)).toMatchObject({
      number: 1,
      status: 'closed',
      assignmentCount: 2,
      scoredCount: 2,
      scoreCount: 2,
      weightSum: 2,
      weightedTotal: 9,
      weightedAverageCentis: 450,
    })
  })

  it('E1 never reports an unlabelled blend when only one member is re-assigned', async () => {
    const roundOneId = await defineDefaults()
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_TWO_EMAIL,
    })
    await service.upsertScore(createSubmitterActor({ contactId: REVIEWER_ONE_ID }), {
      submissionId: submission.id,
      rating: 5,
    })
    await service.upsertScore(createSubmitterActor({ contactId: REVIEWER_TWO_ID }), {
      submissionId: submission.id,
      rating: 4,
    })
    await service.closeRound(organizerActor, EVENT_ID, roundOneId)
    const roundTwo = await service.openRound(organizerActor, EVENT_ID, {
      number: 2,
      name: 'Round 2',
    })
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })

    const after = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)

    expect(after.currentRoundId).toBe(roundTwo.id)
    expect(after.rounds.map((entry) => entry.number)).toEqual([1, 2])
    expect(after.rounds[1]).toMatchObject({
      assignmentCount: 1,
      scoredCount: 0,
      weightedTotal: 0,
    })
    expect(after.rounds[0]).toMatchObject({
      assignmentCount: 2,
      scoredCount: 2,
      weightedTotal: 9,
    })
  })

  it('E2 exposes the closed round result to the organizer and the evaluator', async () => {
    const roundOneId = await defineDefaults()
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })
    await service.upsertScore(actor, {
      submissionId: submission.id,
      rating: 5,
      comments: 'Round one view',
    })
    await service.closeRound(organizerActor, EVENT_ID, roundOneId)
    const roundTwo = await service.openRound(organizerActor, EVENT_ID, {
      number: 2,
      name: 'Round 2',
    })
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })

    const summary = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)

    const roundOne = summary.rounds.find((entry) => entry.roundId === roundOneId)
    expect(roundOne).toMatchObject({
      number: 1,
      name: 'Round 1',
      status: 'closed',
      scoreCount: 1,
      weightSum: 1,
      weightedTotal: 5,
      weightedAverageCentis: 500,
    })
    expect(roundOne?.criteria[0]).toMatchObject({
      name: 'Overall fit',
      scoreCount: 1,
      ratingSum: 5,
    })

    const rows = await service.listOwnEvaluations(actor)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      roundId: roundTwo.id,
      roundNumber: 2,
      roundStatus: 'open',
      rating: null,
    })
    expect(rows[0]?.previousRounds).toEqual([
      {
        roundNumber: 1,
        roundName: 'Round 1',
        rating: 5,
        comments: 'Round one view',
        updatedAt: FIXED_NOW,
      },
    ])
  })

  it('E3 staffs the newest open round when the organizer names no round', async () => {
    await defineDefaults()
    const roundTwo = await service.openRound(organizerActor, EVENT_ID, {
      number: 2,
      name: 'Round 2',
    })
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })

    const roster = await service.listAssignments(organizerActor, EVENT_ID, submission.id)
    expect(roster).toHaveLength(1)
    expect(roster[0]?.roundId).toBe(roundTwo.id)
  })

  it('E3 does not move the total when an older round is closed', async () => {
    const roundOneId = await defineDefaults()
    const roundTwo = await service.openRound(organizerActor, EVENT_ID, {
      number: 2,
      name: 'Round 2',
    })
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
      roundId: roundOneId,
    })
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
      roundId: roundTwo.id,
    })
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })
    await service.upsertScore(actor, { submissionId: submission.id, rating: 5 })

    const before = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)
    expect(before.weightedTotal).toBe(5)

    await service.closeRound(organizerActor, EVENT_ID, roundOneId)
    const after = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)

    expect(after.currentRoundId).toBe(roundTwo.id)
    expect(after.weightedTotal).toBe(5)
    expect(after.weightedAverageCentis).toBe(500)
  })

  it('R3 does not re-weight a closed round when the rubric changes for the next round', async () => {
    const roundOneId = await defineDefaults()
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })
    await service.upsertScore(createSubmitterActor({ contactId: REVIEWER_ONE_ID }), {
      submissionId: submission.id,
      rating: 5,
    })
    await service.closeRound(organizerActor, EVENT_ID, roundOneId)

    const sealed = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)
    const roundOneBefore = sealed.rounds.find((entry) => entry.roundId === roundOneId)
    expect(roundOneBefore).toMatchObject({
      weightSum: 1,
      weightedTotal: 5,
      weightedAverageCentis: 500,
    })

    // The organizer retunes the rubric before round 2.
    await service.defineCriteria(organizerActor, EVENT_ID, {
      criteria: [{ name: 'Overall fit', weight: 2, position: 0 }],
    })

    const after = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)
    const roundOneAfter = after.rounds.find((entry) => entry.roundId === roundOneId)

    expect(roundOneAfter).toEqual(roundOneBefore)
  })
})

describe('EvaluationService criteria against recorded scores', () => {
  beforeEach(async () => {
    await defineDefaults()
    await service.assign(organizerActor, EVENT_ID, submission.id, {
      evaluatorEmail: REVIEWER_ONE_EMAIL,
    })
  })

  it('refuses a redefinition that would move the default away from a scored criterion', async () => {
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })
    await service.upsertScore(actor, { submissionId: submission.id, rating: 5 })

    await expect(
      service.defineCriteria(organizerActor, EVENT_ID, {
        criteria: [{ name: 'Clarity', weight: 4, position: 0 }],
      }),
    ).rejects.toMatchObject({ code: 'conflict' })

    expect(await service.listCriteria(organizerActor, EVENT_ID)).toHaveLength(1)
    expect((await service.listOwnEvaluations(actor))[0]?.rating).toBe(5)
    const summary = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)
    expect(summary.scoreCount).toBe(1)
    expect(summary.weightedTotal).toBe(5)
  })

  it('still accepts a criterion that leaves the scored default in place', async () => {
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })
    await service.upsertScore(actor, { submissionId: submission.id, rating: 5 })

    const defined = await service.defineCriteria(organizerActor, EVENT_ID, {
      criteria: [
        { name: 'Clarity', weight: 4, position: 1 },
        { name: 'Overall fit', weight: 2, position: 0 },
      ],
    })

    expect(defined.map((criterion) => criterion.name)).toEqual(['Overall fit', 'Clarity'])
    expect((await service.listOwnEvaluations(actor))[0]?.rating).toBe(5)
    const summary = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)
    expect(summary.scoreCount).toBe(1)
    expect(summary.weightedTotal).toBe(10)
  })

  it('moves the default freely while nothing has been scored against it', async () => {
    const defined = await service.defineCriteria(organizerActor, EVENT_ID, {
      criteria: [{ name: 'Clarity', weight: 4, position: 0 }],
    })

    expect(defined.map((criterion) => criterion.name)).toEqual(['Clarity', 'Overall fit'])
    const actor = createSubmitterActor({ contactId: REVIEWER_ONE_ID })
    await service.upsertScore(actor, { submissionId: submission.id, rating: 3 })
    const summary = await service.weightedSummary(organizerActor, EVENT_ID, submission.id)
    expect(summary.scoreCount).toBe(1)
    expect(summary.weightedTotal).toBe(12)
  })
})
