import { describe, expect, it } from 'vitest'

import { ContentLibraryService } from '../../../src/application/services/content-library'
import { latestApprovedSnapshot, publicSessionCopy } from '../../../src/domain/session-content'
import { organizerActor, createSubmission, eventFixture, EVENT_SLUG } from '../helpers/fixtures'
import {
  InMemoryContactRepository,
  InMemoryEventRepository,
  InMemoryFormVersionRepository,
  InMemoryProgrammeRepository,
  InMemorySubmissionRepository,
  InMemoryUploadedFileRepository,
} from '../helpers/in-memory-repositories'

describe('last approved copy after sequential draft edits', () => {
  it('keeps A public after A approved → B draft → C draft through the real edit path', async () => {
    const submission = createSubmission({
      title: 'Approved title A',
      answers: { abstract: 'Approved abstract A', title: 'Approved title A' },
    })
    const events = new InMemoryEventRepository([eventFixture])
    const versions = new InMemoryFormVersionRepository()
    const submissions = new InMemorySubmissionRepository(versions, [submission])
    const programme = new InMemoryProgrammeRepository()
    const library = new ContentLibraryService(
      events,
      new InMemoryUploadedFileRepository(),
      programme,
      submissions,
      new InMemoryContactRepository(),
      { now: () => '2026-08-14T12:00:00.000Z' },
      null,
    )

    await library.editSession(organizerActor, EVENT_SLUG, submission.id, {
      title: 'Pending title B',
      abstract: 'Pending abstract B',
    })
    await library.editSession(organizerActor, EVENT_SLUG, submission.id, {
      title: 'Pending title C',
      abstract: 'Pending abstract C',
    })

    const live = await submissions.findById(submission.id)
    expect(live?.title).toBe('Pending title C')
    expect(await programme.getContentStatus(submission.eventId, submission.id)).toBe('draft')

    const revisions = await programme.listRevisions(submission.eventId, submission.id)
    const lastApproved = latestApprovedSnapshot(revisions)
    expect(revisions).toHaveLength(1)
    expect(lastApproved).toEqual({ title: 'Approved title A', abstract: 'Approved abstract A' })

    const publicCopy = publicSessionCopy({
      contentStatus: 'draft',
      liveTitle: live?.title ?? '',
      liveAbstract: String(live?.answers.abstract ?? ''),
      lastApproved,
    })
    expect(publicCopy).toEqual({
      visible: true,
      title: 'Approved title A',
      abstract: 'Approved abstract A',
    })
  })
})
