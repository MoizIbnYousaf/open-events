import { describe, expect, it } from 'vitest'

import {
  EVALUATION_RATING_MAX,
  EVALUATION_RATING_MIN,
  EVALUATION_ROUND_STATUSES,
  EVALUATION_WEIGHT_MIN,
  canTransitionRoundStatus,
  closeEvaluationRound,
  computeWeightedTotals,
  evaluationRoundWeights,
  isValidCriterionPosition,
  isValidCriterionWeight,
  isValidEvaluationRating,
  roundHalfUpDivision,
  selectCurrentRound,
  selectDefaultCriterion,
  selectOpenRound,
  selectRoundAssignments,
  selectSurfaceAssignments,
  snapshotCriterionWeights,
  type EvaluationAssignment,
  type EvaluationCriterion,
  type EvaluationRound,
} from '../../../src/domain'

const EVENT_ID = 'event-demo-conf'
const SUBMISSION_ID = 'submission-1'

function criterion(overrides: Partial<EvaluationCriterion> = {}): EvaluationCriterion {
  return {
    id: 'criterion-overall',
    eventId: EVENT_ID,
    name: 'Overall fit',
    weight: 1,
    position: 0,
    ...overrides,
  }
}

function assignment(overrides: Partial<EvaluationAssignment> = {}): EvaluationAssignment {
  return {
    id: 'assignment-1',
    eventId: EVENT_ID,
    roundId: 'round-1',
    submissionId: SUBMISSION_ID,
    evaluatorContactId: 'contact-reviewer-one',
    createdAt: '2026-05-20T09:00:00.000Z',
    ...overrides,
  }
}

function round(overrides: Partial<EvaluationRound> = {}): EvaluationRound {
  return {
    id: 'round-1',
    eventId: EVENT_ID,
    number: 1,
    name: 'Round 1',
    status: 'open',
    recordedWeights: null,
    // A round nobody has configured: no window, open to the whole committee.
    opensAt: null,
    closesAt: null,
    anonymize: false,
    ...overrides,
  }
}

describe('evaluation rating bounds', () => {
  it('accepts exactly the integers 1 through 5', () => {
    expect(EVALUATION_RATING_MIN).toBe(1)
    expect(EVALUATION_RATING_MAX).toBe(5)
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(isValidEvaluationRating(rating)).toBe(true)
    }
  })

  it('rejects out-of-range, fractional and non-numeric ratings', () => {
    for (const rating of [0, -1, 6, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isValidEvaluationRating(rating)).toBe(false)
    }
    for (const rating of ['3', null, undefined, {}, []]) {
      expect(isValidEvaluationRating(rating)).toBe(false)
    }
  })
})

describe('criterion weight and position bounds', () => {
  it('accepts integer weights at or above the minimum of one', () => {
    expect(EVALUATION_WEIGHT_MIN).toBe(1)
    for (const weight of [1, 2, 7, 100]) {
      expect(isValidCriterionWeight(weight)).toBe(true)
    }
  })

  it('rejects zero, negative, fractional and non-numeric weights', () => {
    for (const weight of [0, -3, 1.5, Number.NaN, '2', null, undefined]) {
      expect(isValidCriterionWeight(weight)).toBe(false)
    }
  })

  it('accepts integer positions from zero upward and rejects everything else', () => {
    for (const position of [0, 1, 42]) {
      expect(isValidCriterionPosition(position)).toBe(true)
    }
    for (const position of [-1, 0.5, Number.NaN, '0', null, undefined]) {
      expect(isValidCriterionPosition(position)).toBe(false)
    }
  })
})

describe('review round transitions', () => {
  it('exposes exactly the open and closed statuses', () => {
    expect([...EVALUATION_ROUND_STATUSES]).toEqual(['open', 'closed'])
  })

  it('allows open to closed and every same-status no-op, never closed to open', () => {
    expect(canTransitionRoundStatus('open', 'closed')).toBe(true)
    expect(canTransitionRoundStatus('open', 'open')).toBe(true)
    expect(canTransitionRoundStatus('closed', 'closed')).toBe(true)
    expect(canTransitionRoundStatus('closed', 'open')).toBe(false)
  })

  it('closes an open round and leaves an already closed round untouched', () => {
    const open = round()
    const weights = [{ criterionId: 'criterion-overall', weight: 3 }]
    const closed = closeEvaluationRound(open, weights)
    expect(closed.status).toBe('closed')
    expect(closed.id).toBe(open.id)
    expect(closed.recordedWeights).toEqual(weights)
    // Closing again keeps the rubric the round actually concluded under.
    expect(closeEvaluationRound(closed, [{ criterionId: 'criterion-overall', weight: 9 }])).toBe(
      closed,
    )
  })
})

describe('recorded round rubric', () => {
  it('snapshots the criteria weights in listed order', () => {
    const overall = criterion({ id: 'criterion-a', name: 'Overall fit', weight: 1, position: 0 })
    const relevance = criterion({ id: 'criterion-b', name: 'Relevance', weight: 3, position: 1 })

    expect(snapshotCriterionWeights([overall, relevance])).toEqual([
      { criterionId: 'criterion-a', weight: 1 },
      { criterionId: 'criterion-b', weight: 3 },
    ])
    expect(snapshotCriterionWeights([])).toEqual([])
  })

  it('reads live weights for an open round and the recorded ones for a closed round', () => {
    const overall = criterion({ id: 'criterion-a', weight: 2 })
    const open = round({ status: 'open' })
    const closed = round({
      id: 'round-2',
      number: 2,
      status: 'closed',
      recordedWeights: [{ criterionId: 'criterion-a', weight: 1 }],
    })

    expect([...evaluationRoundWeights(open, [overall])]).toEqual([['criterion-a', 2]])
    expect([...evaluationRoundWeights(closed, [overall])]).toEqual([['criterion-a', 1]])
  })

  it('falls back to the live weights when a closed round recorded none', () => {
    const overall = criterion({ id: 'criterion-a', weight: 5 })
    const closed = round({ status: 'closed', recordedWeights: null })

    expect([...evaluationRoundWeights(closed, [overall])]).toEqual([['criterion-a', 5]])
  })
})

describe('deterministic default selections', () => {
  it('selects the lowest-position criterion, breaking ties by name', () => {
    const overall = criterion({ id: 'criterion-a', name: 'Overall fit', position: 0 })
    const relevance = criterion({ id: 'criterion-b', name: 'Relevance', position: 1 })
    const clarity = criterion({ id: 'criterion-c', name: 'Clarity', position: 0 })

    expect(selectDefaultCriterion([relevance, overall])).toBe(overall)
    expect(selectDefaultCriterion([overall, clarity])).toBe(clarity)
    expect(selectDefaultCriterion([])).toBeNull()
  })

  it('selects the highest-numbered open round and ignores closed rounds', () => {
    const first = round({ id: 'round-a', number: 1, status: 'closed' })
    const second = round({ id: 'round-b', number: 2, status: 'open' })
    const third = round({ id: 'round-c', number: 3, status: 'open' })

    expect(selectOpenRound([third, second, first])).toBe(third)
    expect(selectOpenRound([first])).toBeNull()
    expect(selectOpenRound([])).toBeNull()
  })

  it('names the highest open round as current, falling back to the newest closed one', () => {
    const first = round({ id: 'round-a', number: 1, status: 'closed' })
    const second = round({ id: 'round-b', number: 2, status: 'open' })
    const third = round({ id: 'round-c', number: 3, status: 'closed' })

    expect(selectCurrentRound([first, second, third])).toBe(second)
    expect(selectCurrentRound([first, third])).toBe(third)
    expect(selectCurrentRound([])).toBeNull()
  })
})

describe('evaluator surface assignment selection', () => {
  const closedOne = round({ id: 'round-a', number: 1, status: 'closed' })
  const openTwo = round({ id: 'round-b', number: 2, status: 'open' })
  const openThree = round({ id: 'round-c', number: 3, status: 'open' })
  const closedFour = round({ id: 'round-d', number: 4, status: 'closed' })

  it('keeps one assignment per submission and prefers the highest open round', () => {
    const first = assignment({ id: 'assignment-1', roundId: closedOne.id })
    const second = assignment({ id: 'assignment-2', roundId: openThree.id })
    const third = assignment({ id: 'assignment-3', roundId: openTwo.id })

    const surface = selectSurfaceAssignments(
      [first, second, third],
      [closedOne, openTwo, openThree],
    )

    expect(surface.size).toBe(1)
    expect(surface.get(SUBMISSION_ID)).toBe(second)
  })

  it('falls back to the highest closed round when nothing is open', () => {
    const first = assignment({ id: 'assignment-1', roundId: closedOne.id })
    const second = assignment({ id: 'assignment-2', roundId: closedFour.id })

    const surface = selectSurfaceAssignments([second, first], [closedOne, closedFour])

    expect(surface.get(SUBMISSION_ID)).toBe(second)
  })

  it('ranks an assignment whose round is not in the event last, and keeps every submission', () => {
    const stray = assignment({ id: 'assignment-1', roundId: 'round-missing' })
    const closed = assignment({ id: 'assignment-2', roundId: closedOne.id })
    const other = assignment({
      id: 'assignment-3',
      submissionId: 'submission-2',
      roundId: closedOne.id,
    })

    const surface = selectSurfaceAssignments([stray, closed, other], [closedOne])

    expect(surface.get(SUBMISSION_ID)).toBe(closed)
    expect(surface.get('submission-2')).toBe(other)
    expect([...surface.keys()]).toEqual([SUBMISSION_ID, 'submission-2'])
  })

  it('is empty for an empty assignment list', () => {
    expect(selectSurfaceAssignments([], [closedOne]).size).toBe(0)
  })
})

// A committee total belongs to exactly one round, so the assignments behind it
// are the assignments of that round — never a set gathered across rounds, which
// is what produced a weighted average belonging to neither round.
describe('round assignment selection', () => {
  const closedOne = round({ id: 'round-a', number: 1, status: 'closed' })
  const openTwo = round({ id: 'round-b', number: 2, status: 'open' })

  it('keeps every assignment filed in the round, in insertion order', () => {
    const first = assignment({ id: 'assignment-1', roundId: closedOne.id })
    const second = assignment({
      id: 'assignment-2',
      roundId: closedOne.id,
      evaluatorContactId: 'contact-reviewer-two',
    })
    const later = assignment({ id: 'assignment-3', roundId: openTwo.id })

    expect(selectRoundAssignments([first, second, later], closedOne.id)).toEqual([first, second])
    expect(selectRoundAssignments([first, second, later], openTwo.id)).toEqual([later])
  })

  it('is empty for a round nothing was filed into and for an empty list', () => {
    const only = assignment({ id: 'assignment-1', roundId: closedOne.id })

    expect(selectRoundAssignments([only], openTwo.id)).toEqual([])
    expect(selectRoundAssignments([], closedOne.id)).toEqual([])
  })
})

describe('weighted total computation', () => {
  it('is all zeros for an empty score set', () => {
    expect(computeWeightedTotals([])).toEqual({
      scoreCount: 0,
      weightSum: 0,
      weightedTotal: 0,
      weightedAverageCentis: 0,
    })
  })

  it('multiplies each rating by its criterion weight and keeps integer sums', () => {
    const totals = computeWeightedTotals([
      { weight: 1, rating: 4 },
      { weight: 3, rating: 5 },
    ])

    expect(totals).toEqual({
      scoreCount: 2,
      weightSum: 4,
      weightedTotal: 19,
      weightedAverageCentis: 475,
    })
  })

  it('rounds the weighted average half up at hundredths of a rating point', () => {
    // weights 3 and 5, ratings 1 and 2 -> 13 / 8 = 1.625 -> 162.5 centis -> 163.
    const totals = computeWeightedTotals([
      { weight: 3, rating: 1 },
      { weight: 5, rating: 2 },
    ])

    expect(totals.weightedTotal).toBe(13)
    expect(totals.weightSum).toBe(8)
    expect(totals.weightedAverageCentis).toBe(163)
  })

  it('is order independent and keeps every field an integer', () => {
    const scores = [
      { weight: 2, rating: 3 },
      { weight: 5, rating: 1 },
      { weight: 1, rating: 5 },
    ]
    const forwards = computeWeightedTotals(scores)
    const backwards = computeWeightedTotals([...scores].reverse())

    expect(backwards).toEqual(forwards)
    for (const value of Object.values(forwards)) {
      expect(Number.isInteger(value)).toBe(true)
    }
  })

  it('pins half-up division as the single rounding rule', () => {
    expect(roundHalfUpDivision(5, 2)).toBe(3)
    expect(roundHalfUpDivision(4, 2)).toBe(2)
    expect(roundHalfUpDivision(7, 2)).toBe(4)
    expect(roundHalfUpDivision(1, 3)).toBe(0)
    expect(roundHalfUpDivision(2, 3)).toBe(1)
    expect(roundHalfUpDivision(0, 5)).toBe(0)
    expect(roundHalfUpDivision(3, 0)).toBe(0)
  })
})
