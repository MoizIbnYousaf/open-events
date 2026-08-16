import { describe, expect, it } from 'vitest'

import {
  ACCEPTANCE_BODY_TEMPLATE,
  ACCEPTANCE_SUBJECT_TEMPLATE,
  ApplicationError,
  CommunicationsService,
  SPEAKER_PORTAL_PATH,
  SPEAKER_WELCOME_BODY_TEMPLATE,
  SPEAKER_WELCOME_SUBJECT_TEMPLATE,
  renderAcceptanceTemplate,
  renderSpeakerTemplate,
} from '../../../src/application'
import type { Event, SubmissionDecisionOutcome } from '../../../src/domain'
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
  InMemoryProgrammeRepository,
  InMemorySubmissionRepository,
} from '../helpers/in-memory-repositories'
import { InMemorySpeakerTaskRepository } from '../helpers/in-memory-onboarding'
import { createInMemoryRoleAccessIssuer } from '../helpers/role-access-issuer'

const SUBMISSION_ID = 'submission-1'

const ACCEPTANCE = {
  eventId: EVENT_ID,
  submissionId: SUBMISSION_ID,
  acceptedAt: '2026-05-19T09:00:00.000Z',
}

/**
 * Accepted by default: acceptance is the precondition of every send.
 *
 * `decision` is a SEPARATE axis from `accepted` on purpose. Accepting writes
 * both the acceptance record and an accepted decision, so the default seeds
 * both — but the two can legitimately disagree, and that disagreement is the
 * whole point of the decision table: rejecting leaves the acceptance row in
 * place (`speaker_tasks` and `agenda_sessions` hang foreign keys off it) and
 * records a rejection above it. A harness that could not express "accepted
 * once, rejected since" could not test the case the product exists to handle.
 */
function buildHarness({
  accepted = true,
  decision = accepted ? 'accepted' : null,
  event = eventFixture,
}: {
  accepted?: boolean
  decision?: SubmissionDecisionOutcome | null
  event?: Event
} = {}) {
  const versions = new InMemoryFormVersionRepository([createVersion()])
  const submissions = new InMemorySubmissionRepository(
    versions,
    [createSubmission()],
    decision === null
      ? []
      : [
          {
            id: `decision-${SUBMISSION_ID}`,
            eventId: EVENT_ID,
            submissionId: SUBMISSION_ID,
            sequence: 1,
            outcome: decision,
            decidedBy: 'organizer',
            decidedAt: ACCEPTANCE.acceptedAt,
          },
        ],
  )
  const events = new InMemoryEventRepository([event])
  const contacts = new InMemoryContactRepository([ownerContact])
  const messages = new InMemoryCapturedMessageRepository()
  const tasks = new InMemorySpeakerTaskRepository([], accepted ? [ACCEPTANCE] : [])
  const service = new CommunicationsService(
    submissions,
    events,
    contacts,
    messages,
    tasks,
    {
      now: () => FIXED_NOW,
    },
    'https://www.openevents.engineer',
    createInMemoryRoleAccessIssuer(messages),
  )
  return { service, messages, contacts }
}

describe('renderAcceptanceTemplate', () => {
  it('substitutes every supported placeholder', () => {
    const rendered = renderAcceptanceTemplate(
      '{{speakerName}} / {{eventName}} / {{title}} / {{portalLink}}',
      {
        speakerName: 'Speaker A',
        eventName: 'DemoConf 2026',
        title: 'Workshop proposal',
        portalLink: 'https://www.openevents.engineer/portal',
      },
    )

    expect(rendered).toBe(
      'Speaker A / DemoConf 2026 / Workshop proposal / https://www.openevents.engineer/portal',
    )
  })

  it('leaves unknown placeholders untouched rather than emitting undefined', () => {
    const rendered = renderAcceptanceTemplate('{{unknown}}', {
      speakerName: 'Speaker A',
      eventName: 'DemoConf 2026',
      title: 'Workshop proposal',
      portalLink: 'https://www.openevents.engineer/portal',
    })

    expect(rendered).toBe('{{unknown}}')
  })

  it('ships built-in acceptance templates that reference every message placeholder', () => {
    const combined = `${ACCEPTANCE_SUBJECT_TEMPLATE}\n${ACCEPTANCE_BODY_TEMPLATE}`

    expect(combined).toContain('{{speakerName}}')
    expect(combined).toContain('{{eventName}}')
    expect(combined).toContain('{{title}}')
    expect(combined).toContain('{{portalLink}}')
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
  // portal's canonical URL supplied by the trusted server configuration.
  it('addresses the speaker portal through the trusted link placeholder', () => {
    expect(SPEAKER_PORTAL_PATH).toBe('/portal')
    expect(ACCEPTANCE_BODY_TEMPLATE).toContain('{{portalLink}}')
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
    expect(queued[0]?.toEmail).toBe('s***@example.test')
    expect(queued[0]?.createdAt).toBe(FIXED_NOW)
    expect(queued[0]?.body).toBe('Message content is protected in the encrypted delivery job.')
    expect(queued[0]?.kind).toBe('acceptance')
    expect(messages.list()[0]?.body).toContain('Speaker A')
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

  /**
   * The acceptance record survives a rejection by design, so a send gated on it
   * alone would post "Great news: your proposal has been accepted" to somebody
   * the programme has just turned down. That is the worst possible message to
   * get wrong, and it is unrecallable once sent — the standing decision is the
   * only thing that can prevent it.
   */
  it('refuses to announce an acceptance the programme has since rejected', async () => {
    const { service, messages } = buildHarness({ accepted: true, decision: 'rejected' })

    await expect(
      service.queueAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(messages.list()).toEqual([])
  })

  /** The reminder carries the same claim ("your accepted proposal") and needs the same gate. */
  it('refuses to remind a speaker the programme has since rejected', async () => {
    const { service, messages } = buildHarness({ accepted: true, decision: 'rejected' })

    await expect(
      service.queueReminder(organizerActor, EVENT_ID, SUBMISSION_ID),
    ).rejects.toMatchObject({ code: 'conflict' })
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

  /**
   * The rejection case is the one that matters, and it is deliberately set up
   * with the acceptance record STILL PRESENT — which is exactly the state a
   * rejection leaves behind, because retracting the acceptance row would delete
   * onboarding work the speaker had already done. An invite gate reading the
   * acceptance record renders a calendar hold here; only one reading the
   * standing decision refuses. Ownership and event scope are satisfied, so the
   * decision is the sole reason this is null.
   */
  it('refuses an invite to a speaker the programme has rejected', async () => {
    const { service } = buildHarness({ accepted: true, decision: 'rejected' })

    expect(await service.buildInvite(ownerActor, SUBMISSION_ID)).toBeNull()
  })

  /**
   * Undecided is refused too. A proposal nobody has ruled on — no decision
   * record AND no acceptance record — has not earned a place in the programme,
   * and an .ics is a promise of one, so silence is not consent.
   */
  it('refuses an invite while the proposal is still undecided', async () => {
    const { service } = buildHarness({ accepted: false, decision: null })

    expect(await service.buildInvite(ownerActor, SUBMISSION_ID)).toBeNull()
  })

  /**
   * The half-written accept: an acceptance record with no decision beside it.
   *
   * `accept()` and `decide()` are two writes — the accept route makes both — so
   * a failure between them leaves exactly this state, and migration 0016
   * backfills the same shape for every acceptance predating the decision table.
   * That speaker genuinely WAS accepted: they have a materialised checklist and
   * an agenda session. So the invite is granted, and it is granted for the same
   * reason their portal shows "Accepted" — one rule, read in both places.
   * Reading it as undecided here is what produced an Accepted badge beside a
   * download that answered 404.
   */
  it('grants the invite on a legacy acceptance that predates the decision record', async () => {
    const { service } = buildHarness({ accepted: true, decision: null })

    expect(await service.buildInvite(ownerActor, SUBMISSION_ID)).toContain('BEGIN:VCALENDAR')
  })
})

describe('renderSpeakerTemplate', () => {
  it('substitutes name, event, and portal link', () => {
    expect(
      renderSpeakerTemplate('Hi {{name}} — {{eventName}} {{portalLink}}', {
        name: 'Priya',
        eventName: 'DemoConf 2026',
        portalLink: SPEAKER_PORTAL_PATH,
      }),
    ).toBe('Hi Priya — DemoConf 2026 /portal')
  })
})

describe('CommunicationsService.sendSpeakerBroadcast', () => {
  it('renders merge fields and records one captured message per selected speaker', async () => {
    const { service, messages, contacts } = buildHarness()
    await contacts.upsertSpeakerProfile({
      eventId: EVENT_ID,
      contactId: ownerContact.id,
      jobTitle: '',
      company: '',
      travelNotes: '',
      workflowStatus: 'invited',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })

    const result = await service.sendSpeakerBroadcast(organizerActor, EVENT_ID, {
      subject: SPEAKER_WELCOME_SUBJECT_TEMPLATE,
      body: SPEAKER_WELCOME_BODY_TEMPLATE,
      contactIds: [ownerContact.id],
    })

    expect(result.sent).toBe(1)
    expect(result.messages[0]?.subject).toContain(eventFixture.name)
    const stored = await messages.listByEvent(EVENT_ID, 10)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.toEmail).toBe(ownerContact.email)
    expect(stored[0]?.body).toContain(ownerContact.name)
    expect(stored[0]?.body).toContain('/api/public/session?token=role-1')
  })
})

describe('CommunicationsService confirmation template', () => {
  it('returns the default copy and persists an organizer override', async () => {
    const { contacts, messages } = buildHarness()
    const programme = new InMemoryProgrammeRepository()
    const versions = new InMemoryFormVersionRepository([createVersion()])
    const submissions = new InMemorySubmissionRepository(versions, [createSubmission()])
    const tasks = new InMemorySpeakerTaskRepository([], [ACCEPTANCE])
    const service = new CommunicationsService(
      submissions,
      new InMemoryEventRepository([eventFixture]),
      contacts,
      messages,
      tasks,
      { now: () => FIXED_NOW },
      'https://www.openevents.engineer',
      createInMemoryRoleAccessIssuer(messages),
      programme,
    )
    expect(await service.getConfirmationTemplate(organizerActor, EVENT_ID)).toEqual({
      subject: 'Your submission was received',
      body: 'Open Events: your submission "{{title}}" was received ({{submissionId}}).',
    })
    await service.saveConfirmationTemplate(organizerActor, EVENT_ID, {
      subject: '{{eventName}} received {{title}}',
      body: 'Thanks {{submissionId}}',
    })
    expect(await service.getConfirmationTemplate(organizerActor, EVENT_ID)).toEqual({
      subject: '{{eventName}} received {{title}}',
      body: 'Thanks {{submissionId}}',
    })
  })
})
