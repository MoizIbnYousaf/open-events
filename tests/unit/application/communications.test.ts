import { describe, expect, it } from 'vitest'

import {
  ACCEPTANCE_BODY_TEMPLATE,
  ACCEPTANCE_SUBJECT_TEMPLATE,
  ApplicationError,
  CommunicationsService,
  SPEAKER_PORTAL_PATH,
  renderAcceptanceTemplate,
} from '../../../src/application'
import type { Event } from '../../../src/domain'
import { buildInviteUid } from '../../../src/domain'
import {
  EVENT_ID,
  createSubmission,
  createVersion,
  crossEventActor,
  eventFixture,
  foreignActor,
  organizerActor,
  ownerActor,
  ownerContact,
  FIXED_NOW,
} from '../helpers/fixtures'
import {
  InMemoryCapturedMessageRepository,
  InMemoryContactRepository,
  InMemoryEventRepository,
  InMemoryFormVersionRepository,
  InMemorySubmissionRepository,
} from '../helpers/in-memory-repositories'
import { InMemorySpeakerTaskRepository } from '../helpers/in-memory-onboarding'

const SUBMISSION_ID = 'submission-1'

const ACCEPTANCE = {
  eventId: EVENT_ID,
  submissionId: SUBMISSION_ID,
  acceptedAt: '2026-05-19T09:00:00.000Z',
}

/** Accepted by default: acceptance is the precondition of every send. */
function buildHarness({
  accepted = true,
  event = eventFixture,
}: { accepted?: boolean; event?: Event } = {}) {
  const versions = new InMemoryFormVersionRepository([createVersion()])
  const submissions = new InMemorySubmissionRepository(versions, [createSubmission()])
  const events = new InMemoryEventRepository([event])
  const contacts = new InMemoryContactRepository([ownerContact])
  const messages = new InMemoryCapturedMessageRepository()
  const tasks = new InMemorySpeakerTaskRepository([], accepted ? [ACCEPTANCE] : [])
  const service = new CommunicationsService(submissions, events, contacts, messages, tasks, {
    now: () => FIXED_NOW,
  })
  return { service, messages }
}

describe('renderAcceptanceTemplate', () => {
  it('substitutes every supported placeholder', () => {
    const rendered = renderAcceptanceTemplate(
      '{{speakerName}} / {{eventName}} / {{title}} / {{speakerName}}',
      { speakerName: 'Speaker A', eventName: 'DemoConf 2026', title: 'Workshop proposal' },
    )

    expect(rendered).toBe('Speaker A / DemoConf 2026 / Workshop proposal / Speaker A')
  })

  it('leaves unknown placeholders untouched rather than emitting undefined', () => {
    const rendered = renderAcceptanceTemplate('{{unknown}}', {
      speakerName: 'Speaker A',
      eventName: 'DemoConf 2026',
      title: 'Workshop proposal',
    })

    expect(rendered).toBe('{{unknown}}')
  })

  it('ships built-in acceptance templates that reference all three placeholders', () => {
    const combined = `${ACCEPTANCE_SUBJECT_TEMPLATE}\n${ACCEPTANCE_BODY_TEMPLATE}`

    expect(combined).toContain('{{speakerName}}')
    expect(combined).toContain('{{eventName}}')
    expect(combined).toContain('{{title}}')
  })

  // No attachment exists on a CapturedMessage and none can, so the body must
  // not claim one; it points at the portal, where the .ics is downloadable.
  it('never claims an attachment the captured message cannot carry', () => {
    expect(ACCEPTANCE_BODY_TEMPLATE).not.toMatch(/attach/i)
    expect(ACCEPTANCE_BODY_TEMPLATE).toMatch(/portal/i)
    expect(ACCEPTANCE_BODY_TEMPLATE).toMatch(/calendar invite/i)
  })

  // The message is the only thing an accepted speaker is handed, so naming a
  // destination without its address is not a way in: the body must carry the
  // portal's real path.
  it('addresses the speaker portal by its real path', () => {
    expect(SPEAKER_PORTAL_PATH).toBe('/portal')
    expect(ACCEPTANCE_BODY_TEMPLATE).toContain(SPEAKER_PORTAL_PATH)
  })
})

describe('CommunicationsService.isInviteAvailable', () => {
  it('is true only while the event still has configured dates', async () => {
    const dated = buildHarness()
    await expect(dated.service.isInviteAvailable(ownerActor)).resolves.toBe(true)

    const undated = buildHarness({ event: { ...eventFixture, dates: null } })
    await expect(undated.service.isInviteAvailable(ownerActor)).resolves.toBe(false)
  })

  it('is false for an unknown event rather than throwing', async () => {
    const { service } = buildHarness()

    await expect(service.isInviteAvailable(crossEventActor)).resolves.toBe(false)
  })
})

describe('CommunicationsService.previewAcceptance', () => {
  it('renders the subject and body with the submission substitutions', async () => {
    const { service } = buildHarness()

    const preview = await service.previewAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)

    expect(preview.submissionId).toBe(SUBMISSION_ID)
    expect(preview.toEmail).toBe('speaker-a@example.test')
    expect(preview.subject).toContain('Workshop proposal')
    expect(preview.subject).toContain('DemoConf 2026')
    expect(preview.body).toContain('Speaker A')
    expect(preview.body).toContain('Workshop proposal')
    expect(preview.body).toContain('DemoConf 2026')
    expect(preview.body).not.toContain('{{')
    expect(preview.subject).not.toContain('{{')
    expect(preview.alreadySent).toBe(false)
    expect(preview.accepted).toBe(true)
  })

  it('reports the acceptance state so the organizer never sends ahead of it', async () => {
    const { service } = buildHarness({ accepted: false })

    expect(
      (await service.previewAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)).accepted,
    ).toBe(false)
  })

  it('reports alreadySent once the acceptance has been queued', async () => {
    const { service } = buildHarness()

    await service.queueAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)

    expect(
      (await service.previewAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)).alreadySent,
    ).toBe(true)
  })

  it('is a pure read: previewing never writes a captured message', async () => {
    const { service, messages } = buildHarness()

    await service.previewAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)
    await service.previewAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)

    expect(messages.list()).toEqual([])
  })

  it('raises not_found for an unknown submission', async () => {
    const { service } = buildHarness()

    await expect(
      service.previewAcceptance(organizerActor, EVENT_ID, 'missing'),
    ).rejects.toBeInstanceOf(ApplicationError)
  })
})

describe('CommunicationsService.queueAcceptance', () => {
  // O2 updated this contract: sends are per-recipient (owner + contributors),
  // so queueAcceptance answers the stored rows as a list. This harness has no
  // contributors, so the audience is exactly the owner.
  it('writes exactly one captured message carrying the rendered acceptance', async () => {
    const { service, messages } = buildHarness()

    const queued = await service.queueAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)

    expect(messages.list()).toHaveLength(1)
    expect(queued).toHaveLength(1)
    expect(queued[0]?.submissionId).toBe(SUBMISSION_ID)
    expect(queued[0]?.toEmail).toBe('speaker-a@example.test')
    expect(queued[0]?.createdAt).toBe(FIXED_NOW)
    expect(queued[0]?.body).toContain('Speaker A')
    expect(queued[0]?.kind).toBe('acceptance')
  })

  it('refuses to announce an acceptance that was never recorded', async () => {
    const { service, messages } = buildHarness({ accepted: false })

    await expect(
      service.queueAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID),
    ).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(messages.list()).toEqual([])
  })

  it('is idempotent: a second send returns the first row and never duplicates', async () => {
    const { service, messages } = buildHarness()

    const first = await service.queueAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)
    const second = await service.queueAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)

    expect(second).toEqual(first)
    expect(messages.list()).toHaveLength(1)
  })

  it('never mutates the stored row on a repeat send', async () => {
    const { service, messages } = buildHarness()

    await service.queueAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)
    const before = structuredClone(messages.list())
    await service.queueAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)

    expect(messages.list()).toEqual(before)
  })

  it('raises not_found for an unknown submission', async () => {
    const { service } = buildHarness()

    await expect(
      service.queueAcceptance(organizerActor, EVENT_ID, 'missing'),
    ).rejects.toBeInstanceOf(ApplicationError)
  })
})

describe('CommunicationsService.listHistory', () => {
  it('is empty before any send', async () => {
    const { service } = buildHarness()

    expect(await service.listHistory(organizerActor, EVENT_ID, SUBMISSION_ID)).toEqual([])
  })

  it('returns the immutable single-entry history after repeat sends', async () => {
    const { service } = buildHarness()

    await service.queueAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)
    const first = await service.listHistory(organizerActor, EVENT_ID, SUBMISSION_ID)
    await service.queueAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)
    const second = await service.listHistory(organizerActor, EVENT_ID, SUBMISSION_ID)

    expect(first).toHaveLength(1)
    expect(second).toEqual(first)
  })

  it('raises not_found for an unknown submission', async () => {
    const { service } = buildHarness()

    await expect(service.listHistory(organizerActor, EVENT_ID, 'missing')).rejects.toBeInstanceOf(
      ApplicationError,
    )
  })
})

describe('CommunicationsService.buildInvite', () => {
  it('renders the owning submitter an ics carrying the stable UID and the event dates', async () => {
    const { service } = buildHarness()

    const ics = await service.buildInvite(ownerActor, SUBMISSION_ID)

    expect(ics).not.toBeNull()
    expect(ics ?? '').toContain(`UID:${buildInviteUid(SUBMISSION_ID)}`)
    expect(ics ?? '').toContain('DTSTART:20260513T080000Z')
    expect(ics ?? '').toContain('DTEND:20260515T170000Z')
    expect(ics ?? '').toContain('SUMMARY:Workshop proposal')
  })

  it('stamps DTSTAMP from the service clock', async () => {
    const { service } = buildHarness()

    expect(await service.buildInvite(ownerActor, SUBMISSION_ID)).toContain(
      'DTSTAMP:20260520T090000Z',
    )
  })

  it('returns null for a non-owning submitter of the same event', async () => {
    const { service } = buildHarness()

    expect(await service.buildInvite(foreignActor, SUBMISSION_ID)).toBeNull()
  })

  it('returns null across events', async () => {
    const { service } = buildHarness()

    expect(await service.buildInvite(crossEventActor, SUBMISSION_ID)).toBeNull()
  })

  it('returns null for an unknown submission', async () => {
    const { service } = buildHarness()

    expect(await service.buildInvite(ownerActor, 'missing')).toBeNull()
  })
})
