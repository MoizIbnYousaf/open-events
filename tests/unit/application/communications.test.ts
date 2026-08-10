import { describe, expect, it } from 'vitest'

import {
  ACCEPTANCE_BODY_TEMPLATE,
  ACCEPTANCE_SUBJECT_TEMPLATE,
  ApplicationError,
  CommunicationsService,
  renderAcceptanceTemplate,
} from '../../../src/application'
import { buildInviteUid } from '../../../src/domain'
import {
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

const SUBMISSION_ID = 'submission-1'

function buildHarness() {
  const versions = new InMemoryFormVersionRepository([createVersion()])
  const submissions = new InMemorySubmissionRepository(versions, [createSubmission()])
  const events = new InMemoryEventRepository([eventFixture])
  const contacts = new InMemoryContactRepository([ownerContact])
  const messages = new InMemoryCapturedMessageRepository()
  const service = new CommunicationsService(submissions, events, contacts, messages, {
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
})

describe('CommunicationsService.previewAcceptance', () => {
  it('renders the subject and body with the submission substitutions', async () => {
    const { service } = buildHarness()

    const preview = await service.previewAcceptance(organizerActor, SUBMISSION_ID)

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
  })

  it('reports alreadySent once the acceptance has been queued', async () => {
    const { service } = buildHarness()

    await service.queueAcceptance(organizerActor, SUBMISSION_ID)

    expect((await service.previewAcceptance(organizerActor, SUBMISSION_ID)).alreadySent).toBe(true)
  })

  it('is a pure read: previewing never writes a captured message', async () => {
    const { service, messages } = buildHarness()

    await service.previewAcceptance(organizerActor, SUBMISSION_ID)
    await service.previewAcceptance(organizerActor, SUBMISSION_ID)

    expect(messages.list()).toEqual([])
  })

  it('raises not_found for an unknown submission', async () => {
    const { service } = buildHarness()

    await expect(service.previewAcceptance(organizerActor, 'missing')).rejects.toBeInstanceOf(
      ApplicationError,
    )
  })
})

describe('CommunicationsService.queueAcceptance', () => {
  it('writes exactly one captured message carrying the rendered acceptance', async () => {
    const { service, messages } = buildHarness()

    const queued = await service.queueAcceptance(organizerActor, SUBMISSION_ID)

    expect(messages.list()).toHaveLength(1)
    expect(queued.submissionId).toBe(SUBMISSION_ID)
    expect(queued.toEmail).toBe('speaker-a@example.test')
    expect(queued.createdAt).toBe(FIXED_NOW)
    expect(queued.body).toContain('Speaker A')
  })

  it('is idempotent: a second send returns the first row and never duplicates', async () => {
    const { service, messages } = buildHarness()

    const first = await service.queueAcceptance(organizerActor, SUBMISSION_ID)
    const second = await service.queueAcceptance(organizerActor, SUBMISSION_ID)

    expect(second).toEqual(first)
    expect(messages.list()).toHaveLength(1)
  })

  it('never mutates the stored row on a repeat send', async () => {
    const { service, messages } = buildHarness()

    await service.queueAcceptance(organizerActor, SUBMISSION_ID)
    const before = structuredClone(messages.list())
    await service.queueAcceptance(organizerActor, SUBMISSION_ID)

    expect(messages.list()).toEqual(before)
  })

  it('raises not_found for an unknown submission', async () => {
    const { service } = buildHarness()

    await expect(service.queueAcceptance(organizerActor, 'missing')).rejects.toBeInstanceOf(
      ApplicationError,
    )
  })
})

describe('CommunicationsService.listHistory', () => {
  it('is empty before any send', async () => {
    const { service } = buildHarness()

    expect(await service.listHistory(organizerActor, SUBMISSION_ID)).toEqual([])
  })

  it('returns the immutable single-entry history after repeat sends', async () => {
    const { service } = buildHarness()

    await service.queueAcceptance(organizerActor, SUBMISSION_ID)
    const first = await service.listHistory(organizerActor, SUBMISSION_ID)
    await service.queueAcceptance(organizerActor, SUBMISSION_ID)
    const second = await service.listHistory(organizerActor, SUBMISSION_ID)

    expect(first).toHaveLength(1)
    expect(second).toEqual(first)
  })

  it('raises not_found for an unknown submission', async () => {
    const { service } = buildHarness()

    await expect(service.listHistory(organizerActor, 'missing')).rejects.toBeInstanceOf(
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
