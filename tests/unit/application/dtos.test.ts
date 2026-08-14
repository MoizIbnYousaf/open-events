import { describe, expect, it } from 'vitest'

import {
  toFormDefinitionDto,
  toFormSummaryDto,
  toOwnSubmissionListItemDto,
  toSubmissionListItemDto,
  toFormVersionDetailDto,
} from '../../../src/application'
import { createContent, createForm, createSubmission, createVersion } from '../helpers/fixtures'
import { EVENT_SLUG } from '../helpers/fixtures'

/** The definition now carries the window's verdict, so it needs an instant. */
const NOW = '2026-06-01T00:00:00.000Z'
const DECIDED_AT = '2026-06-02T00:00:00.000Z'

describe('toFormDefinitionDto', () => {
  it('exposes only published versions and omits routing rules', () => {
    const form = createForm({ status: 'published', publishedVersionId: 'version-1' })
    const version = createVersion({
      status: 'published',
      contentHash: 'hash',
      publishedAt: '2026-05-01T00:00:00.000Z',
    })

    const dto = toFormDefinitionDto(form, EVENT_SLUG, version, createContent(), NOW)

    expect(dto.status).toBe('published')
    expect(dto.eventSlug).toBe(EVENT_SLUG)
    expect(dto.contentHash).toBe('hash')
    expect(dto).not.toHaveProperty('routingRules')
    expect(dto.conditionRules).toHaveLength(1)
  })

  it('throws when asked to build a definition from a draft version', () => {
    const form = createForm()
    const draft = createVersion({ status: 'draft', contentHash: null, publishedAt: null })

    expect(() => toFormDefinitionDto(form, EVENT_SLUG, draft, createContent(), NOW)).toThrow(
      'Cannot build a public definition',
    )
  })
})

describe('toFormSummaryDto', () => {
  it('maps the form summary row', () => {
    const dto = toFormSummaryDto(
      createForm({ status: 'published', publishedVersionId: 'version-1' }),
    )

    expect(dto).toEqual({
      formId: 'form-cfp',
      eventId: 'event-demo-conf',
      slug: 'cfp',
      status: 'published',
      publishedVersionId: 'version-1',
      opensAt: null,
      closesAt: null,
    })
  })
})

describe('DTO round-trip fidelity (element page membership and rule order)', () => {
  it('exposes element.pageId in toFormVersionDetailDto equal to the source FormElement.pageId', () => {
    const version = createVersion({ status: 'draft' })
    const content = createContent()

    const detail = toFormVersionDetailDto(version, content)

    for (const element of content.elements) {
      const dtoElement = detail.elements.find((candidate) => candidate.id === element.id)
      expect(dtoElement?.pageId).toBe(element.pageId)
    }
  })

  it('exposes element.pageId in toFormDefinitionDto equal to the source FormElement.pageId', () => {
    const form = createForm({ status: 'published', publishedVersionId: 'version-1' })
    const version = createVersion({
      status: 'published',
      contentHash: 'hash',
      publishedAt: '2026-05-01T00:00:00.000Z',
    })

    const definition = toFormDefinitionDto(form, EVENT_SLUG, version, createContent(), NOW)

    for (const element of createContent().elements) {
      const dtoElement = definition.elements.find((candidate) => candidate.id === element.id)
      expect(dtoElement?.pageId).toBe(element.pageId)
    }
  })

  it('exposes conditionRule.position in toFormVersionDetailDto equal to the source ElementRule.position', () => {
    const version = createVersion({ status: 'draft' })
    const content = createContent()

    const detail = toFormVersionDetailDto(version, content)

    for (const rule of content.conditionRules) {
      const dtoRule = detail.conditionRules.find((candidate) => candidate.id === rule.id)
      expect(dtoRule?.position).toBe(rule.position)
    }
  })

  it('exposes conditionRule.position in toFormDefinitionDto equal to the source ElementRule.position', () => {
    const form = createForm({ status: 'published', publishedVersionId: 'version-1' })
    const version = createVersion({
      status: 'published',
      contentHash: 'hash',
      publishedAt: '2026-05-01T00:00:00.000Z',
    })

    const definition = toFormDefinitionDto(form, EVENT_SLUG, version, createContent(), NOW)

    for (const rule of createContent().conditionRules) {
      const dtoRule = definition.conditionRules.find((candidate) => candidate.id === rule.id)
      expect(dtoRule?.position).toBe(rule.position)
    }
  })
})

describe('toSubmissionListItemDto', () => {
  it('picks the primary speaker and counts co-speakers', () => {
    const dto = toSubmissionListItemDto(
      createSubmission(),
      createForm({ status: 'published', publishedVersionId: 'version-1' }),
      createVersion({ status: 'published' }),
      [
        {
          contactId: 'contact-primary',
          name: 'Speaker A',
          email: 'speaker-a@example.test',
          role: 'primary',
          position: 0,
        },
        {
          contactId: 'contact-co',
          name: 'Co Speaker',
          email: 'co@example.test',
          role: 'co-speaker',
          position: 1,
        },
      ],
    )

    expect(dto.primarySpeaker).toMatchObject({ role: 'primary', email: 'speaker-a@example.test' })
    expect(dto.coSpeakerCount).toBe(1)
    expect(dto.routing).toEqual({ actionKind: 'assign_track', actionTarget: 'workshop' })
  })
})

describe('toOwnSubmissionListItemDto', () => {
  const organizerRow = () =>
    toSubmissionListItemDto(
      createSubmission(),
      createForm({ status: 'published', publishedVersionId: 'version-1' }),
      createVersion({ status: 'published' }),
      [
        {
          contactId: 'contact-primary',
          name: 'Speaker A',
          email: 'speaker-a@example.test',
          role: 'primary',
          position: 0,
        },
      ],
    )

  // Routing is the organizer's triage decision (including manual_review and the
  // internal taxonomy keys). The speaker's own row is a public read, so the
  // decision must not travel with it.
  it('drops the organizer-only routing outcome from the speaker payload', () => {
    const row = organizerRow()
    expect(row.routing).not.toBeNull()

    const own = toOwnSubmissionListItemDto(row, 'accepted', DECIDED_AT, true)

    expect(own).not.toHaveProperty('routing')
    expect(own.id).toBe(row.id)
    expect(own.primarySpeaker).toEqual(row.primarySpeaker)
  })

  it('carries the verdict and calendar-invite availability as separate facts', () => {
    const row = organizerRow()

    expect(toOwnSubmissionListItemDto(row, 'accepted', DECIDED_AT, true)).toMatchObject({
      decision: 'accepted',
      accepted: true,
      inviteAvailable: true,
    })
    expect(toOwnSubmissionListItemDto(row, 'accepted', DECIDED_AT, false)).toMatchObject({
      decision: 'accepted',
      accepted: true,
      inviteAvailable: false,
    })
    // A rejection is a decision the speaker can read, and it is not acceptance:
    // the accept-only shape could not tell it from a proposal still in review.
    expect(toOwnSubmissionListItemDto(row, 'rejected', DECIDED_AT, false)).toMatchObject({
      decision: 'rejected',
      accepted: false,
      decidedAt: DECIDED_AT,
    })
    // Undecided is the WORD 'pending', never null and never absent: one
    // spelling across the wire, the cache and every client, so no surface has
    // to invent a reading for a missing field. `decidedAt` stays null because
    // there genuinely is no instant to name until somebody decides.
    expect(toOwnSubmissionListItemDto(row, 'pending', null, false)).toMatchObject({
      decision: 'pending',
      accepted: false,
      decidedAt: null,
      inviteAvailable: false,
    })
  })
})
