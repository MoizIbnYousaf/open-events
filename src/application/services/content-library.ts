import { answerText } from '../../domain/programme'
import {
  assertActorCanMutate,
  assertSubmitterCapability,
  type OrganizerActor,
  type SubmitterActor,
} from '../actors'
import { ApplicationError, ValidationFailedError } from '../errors'
import type { Clock } from '../ports/clock'
import type { ContactRepository } from '../ports/contact-repository'
import type { EventRepository } from '../ports/event-repository'
import type { ObjectStoragePort } from '../ports/object-storage'
import type { ProgrammeRepository } from '../ports/programme-repository'
import type { SubmissionRepository } from '../ports/submission-repository'
import type { UploadedFileKind, UploadedFileRepository } from '../ports/uploaded-file-repository'
import { zipStoreFiles } from '../../domain/zip-store'
import { selectFilesForLatestZip, zipEntryFileName } from '../zip-latest'
import { isSessionContentStatus } from '../../domain/embed'
import { shouldSnapshotApprovedCopy } from '../../domain/session-content'

export class ContentLibraryService {
  readonly #events: EventRepository
  readonly #files: UploadedFileRepository
  readonly #programme: ProgrammeRepository
  readonly #submissions: SubmissionRepository
  readonly #contacts: ContactRepository
  readonly #clock: Clock
  readonly #storage: ObjectStoragePort | null

  constructor(
    events: EventRepository,
    files: UploadedFileRepository,
    programme: ProgrammeRepository,
    submissions: SubmissionRepository,
    contacts: ContactRepository,
    clock: Clock,
    storage: ObjectStoragePort | null,
  ) {
    this.#events = events
    this.#files = files
    this.#programme = programme
    this.#submissions = submissions
    this.#contacts = contacts
    this.#clock = clock
    this.#storage = storage
  }

  async listFiles(_actor: OrganizerActor, slug: string) {
    const event = await this.#event(slug)
    const files = await this.#files.listByEvent(event.id)
    const submissions = await this.#submissions.listByEvent(event.id)
    const titleByOwner = new Map(submissions.map((row) => [row.ownerContactId, row.title]))
    return Promise.all(
      files.map(async (file) => {
        const [versions, owner] = await Promise.all([
          this.#files.listVersions(file.eventId, file.ownerContactId, file.kind),
          this.#contacts.findById(file.ownerContactId),
        ])
        return {
          id: file.id,
          ownerContactId: file.ownerContactId,
          ownerName: owner?.name || owner?.email || file.ownerContactId,
          kind: file.kind,
          fileName: file.fileName ?? file.kind,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          updatedAt: file.updatedAt,
          versionCount: versions.length + 1,
          sessionTitle: titleByOwner.get(file.ownerContactId) ?? '',
        }
      }),
    )
  }

  async getFile(
    _actor: OrganizerActor,
    slug: string,
    ownerContactId: string,
    kind: UploadedFileKind,
  ) {
    const event = await this.#event(slug)
    if (this.#storage === null) {
      throw new ApplicationError('not_found', 'File storage is not configured')
    }
    const file = await this.#files.findOwn(event.id, ownerContactId, kind)
    if (file === null) return null
    const object = await this.#storage.get(file.storageKey)
    if (object === null) return null
    return {
      fileName: file.fileName ?? file.kind,
      contentType: file.contentType,
      body: object.body,
    }
  }

  async listVersions(
    _actor: OrganizerActor,
    slug: string,
    ownerContactId: string,
    kind: UploadedFileKind,
  ) {
    const event = await this.#event(slug)
    const current = await this.#files.findOwn(event.id, ownerContactId, kind)
    const prior = await this.#files.listVersions(event.id, ownerContactId, kind)
    const latest =
      current === null
        ? []
        : [
            {
              id: current.id,
              version: prior.length + 1,
              fileName: current.fileName ?? kind,
              createdAt: current.updatedAt,
              current: true as const,
            },
          ]
    return [
      ...prior.map((row) => ({
        id: row.id,
        version: row.version,
        fileName: row.fileName ?? kind,
        createdAt: row.createdAt,
        current: false as const,
      })),
      ...latest,
    ]
  }

  async listComments(
    _actor: OrganizerActor,
    slug: string,
    ownerContactId: string,
    kind: UploadedFileKind,
  ) {
    const event = await this.#event(slug)
    return this.#files.listComments(event.id, ownerContactId, kind)
  }

  async addComment(
    actor: OrganizerActor,
    slug: string,
    input: {
      readonly ownerContactId: string
      readonly kind: UploadedFileKind
      readonly authorName: string
      readonly body: string
    },
  ) {
    assertActorCanMutate(actor)
    const event = await this.#event(slug)
    const body = input.body.trim()
    if (body.length === 0) throw new ValidationFailedError('Comment is empty', [])
    const record = {
      id: crypto.randomUUID(),
      eventId: event.id,
      ownerContactId: input.ownerContactId,
      kind: input.kind,
      authorName: input.authorName.trim() || 'Organizer',
      body,
      createdAt: this.#clock.now(),
    }
    await this.#files.addComment(record)
    return record
  }

  async listOwnVersions(actor: SubmitterActor, kind: UploadedFileKind) {
    assertSubmitterCapability(actor, 'portal')
    const current = await this.#files.findOwn(actor.eventId, actor.contactId, kind)
    const prior = await this.#files.listVersions(actor.eventId, actor.contactId, kind)
    return [
      ...prior.map((row) => ({
        id: row.id,
        version: row.version,
        fileName: row.fileName ?? kind,
        createdAt: row.createdAt,
        current: false as const,
      })),
      ...(current === null
        ? []
        : [
            {
              id: current.id,
              version: prior.length + 1,
              fileName: current.fileName ?? kind,
              createdAt: current.updatedAt,
              current: true as const,
            },
          ]),
    ]
  }

  async listOwnComments(actor: SubmitterActor, kind: UploadedFileKind) {
    assertSubmitterCapability(actor, 'portal')
    return this.#files.listComments(actor.eventId, actor.contactId, kind)
  }

  async addOwnComment(actor: SubmitterActor, kind: UploadedFileKind, bodyInput: string) {
    assertSubmitterCapability(actor, 'portal')
    assertActorCanMutate(actor)
    const body = bodyInput.trim()
    if (body.length === 0) throw new ValidationFailedError('Comment is empty', [])
    const contact = await this.#contacts.findById(actor.contactId)
    const record = {
      id: crypto.randomUUID(),
      eventId: actor.eventId,
      ownerContactId: actor.contactId,
      kind,
      authorName: contact?.name.trim() || contact?.email || 'Speaker',
      body,
      createdAt: this.#clock.now(),
    }
    await this.#files.addComment(record)
    return record
  }

  async editSession(
    actor: OrganizerActor,
    slug: string,
    submissionId: string,
    input: { readonly title: string; readonly abstract: string; readonly editorName?: string },
  ) {
    assertActorCanMutate(actor)
    const event = await this.#event(slug)
    const submission = await this.#submissions.findById(submissionId)
    if (submission === null || submission.eventId !== event.id) {
      throw new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    }
    const previousAbstract = answerText(submission.answers.abstract)
    const status = await this.#programme.getContentStatus(event.id, submissionId)
    if (shouldSnapshotApprovedCopy(status)) {
      await this.#programme.addRevision({
        id: crypto.randomUUID(),
        eventId: event.id,
        submissionId,
        editorName: input.editorName?.trim() || 'Organizer',
        title: submission.title,
        abstract: previousAbstract,
        createdAt: this.#clock.now(),
      })
    }
    const answers = { ...submission.answers, abstract: input.abstract }
    const updated = await this.#submissions.updateContent({
      eventId: event.id,
      submissionId,
      title: input.title,
      answers,
    })
    if (updated === 'not-found') {
      throw new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    }
    await this.#programme.setContentStatus(event.id, submissionId, 'draft')
    return { submissionId, title: input.title, abstract: input.abstract }
  }

  async listRevisions(_actor: OrganizerActor, slug: string, submissionId: string) {
    const event = await this.#event(slug)
    return this.#programme.listRevisions(event.id, submissionId)
  }

  async restoreRevision(actor: OrganizerActor, slug: string, revisionId: string) {
    assertActorCanMutate(actor)
    const event = await this.#event(slug)
    const revision = await this.#programme.findRevision(revisionId)
    if (revision === null || revision.eventId !== event.id) {
      throw new ApplicationError('not_found', `Revision '${revisionId}' not found`)
    }
    const submission = await this.#submissions.findById(revision.submissionId)
    if (submission === null) {
      throw new ApplicationError('not_found', `Submission '${revision.submissionId}' not found`)
    }
    await this.#programme.addRevision({
      id: crypto.randomUUID(),
      eventId: event.id,
      submissionId: revision.submissionId,
      editorName: 'Organizer',
      title: submission.title,
      abstract: answerText(submission.answers.abstract),
      createdAt: this.#clock.now(),
    })
    await this.#submissions.updateContent({
      eventId: event.id,
      submissionId: revision.submissionId,
      title: revision.title,
      answers: { ...submission.answers, abstract: revision.abstract },
    })
    return {
      submissionId: revision.submissionId,
      title: revision.title,
      abstract: revision.abstract,
    }
  }

  async getContentStatus(_actor: OrganizerActor, slug: string, submissionId: string) {
    const event = await this.#event(slug)
    return {
      submissionId,
      status: await this.#programme.getContentStatus(event.id, submissionId),
    }
  }

  async setContentStatus(
    actor: OrganizerActor,
    slug: string,
    submissionId: string,
    status: string,
  ) {
    assertActorCanMutate(actor)
    if (!isSessionContentStatus(status)) {
      throw new ValidationFailedError('Unknown content status', [])
    }
    const event = await this.#event(slug)
    await this.#programme.setContentStatus(event.id, submissionId, status)
    return { submissionId, status }
  }

  async zipLatest(_actor: OrganizerActor, slug: string, ownerContactIds: readonly string[]) {
    const event = await this.#event(slug)
    if (this.#storage === null) {
      throw new ApplicationError('not_found', 'File storage is not configured')
    }
    const files = await this.#files.listByEvent(event.id)
    const chosen = selectFilesForLatestZip(files, ownerContactIds)
    const entries = []
    for (const file of chosen) {
      const object = await this.#storage.get(file.storageKey)
      if (object === null) continue
      const name = zipEntryFileName(file)
      entries.push({ name: `${file.ownerContactId}/${name}`, body: new Uint8Array(object.body) })
    }
    return zipStoreFiles(entries, new Date(this.#clock.now()))
  }

  async #event(slug: string) {
    const event = await this.#events.findBySlug(slug)
    if (event === null) throw new ApplicationError('not_found', `Event '${slug}' not found`)
    return event
  }
}
