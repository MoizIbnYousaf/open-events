import { describe, expect, it } from 'vitest'

import { TOUR_CHAPTERS, TOUR_STEPS } from '../../../src/app/features/tour/tour-steps'

describe('tour moment contract', () => {
  it('defines 26 unique moments across six chapters', () => {
    expect(TOUR_STEPS).toHaveLength(26)
    expect(new Set(TOUR_STEPS.map((step) => step.id)).size).toBe(26)
    expect(TOUR_CHAPTERS.map((chapter) => chapter.id)).toEqual([
      'orientation',
      'organizer',
      'submitter',
      'speaker',
      'reviewer',
      'programme',
    ])
    expect(new Set(TOUR_STEPS.map((step) => step.chapter))).toEqual(
      new Set(TOUR_CHAPTERS.map((chapter) => chapter.id)),
    )
  })

  it('gives every moment an executable target policy and concise visible claim', () => {
    for (const step of TOUR_STEPS) {
      expect(step.body.length, step.id).toBeLessThanOrEqual(240)
      expect(step.maxTransitionMs, step.id).toBeGreaterThan(0)
      expect(step.fixtureAssertions.length, step.id).toBeGreaterThan(0)
      if (step.targetPolicy === 'required') {
        expect(step.target, step.id).toBeTruthy()
      }
      expect(step.target ?? '', step.id).not.toMatch(/^rail-/)
      expect(step).toHaveProperty('mobileTarget')
    }
  })

  it('separates overloaded speaker-file and itinerary interactions', () => {
    expect(TOUR_STEPS.map((step) => step.id)).toContain('speaker-files')
    expect(TOUR_STEPS.map((step) => step.id)).toContain('itinerary')
    expect(TOUR_STEPS.find((step) => step.id === 'events')?.route).toBe('/admin/events')
    expect(TOUR_STEPS.find((step) => step.id === 'messages')?.body).toMatch(/delivery history/i)
    expect(TOUR_STEPS.find((step) => step.id === 'orby')?.body).toMatch(/support/i)
    expect(TOUR_STEPS.find((step) => step.id === 'orby')?.body).not.toMatch(/AI|assistant/i)
  })
})
