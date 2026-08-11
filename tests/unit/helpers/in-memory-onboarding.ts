import type {
  AcceptBatchInput,
  AcceptBatchResult,
  AcceptSessionDraft,
  AcceptUnitOfWork,
  SpeakerTaskRepository,
  UploadedFileKind,
  UploadedFileRecord,
  UploadedFileRepository,
} from '../../../src/application'
import type { AnswerMap, SpeakerTask, SubmissionAcceptance } from '../../../src/domain'
import { completeSpeakerTask } from '../../../src/domain'

/**
 * In-memory twin of the D1 speaker-task adapter. Reads are event-scoped and
 * ordered exactly like the SQL adapter (submission id, then position) so the
 * service contract is adapter-independent.
 */
export class InMemorySpeakerTaskRepository implements SpeakerTaskRepository {
  readonly #tasks = new Map<string, SpeakerTask>()
  readonly #acceptances = new Map<string, SubmissionAcceptance>()

  constructor(
    tasks: readonly SpeakerTask[] = [],
    acceptances: readonly SubmissionAcceptance[] = [],
  ) {
    for (const task of tasks) this.#tasks.set(task.id, task)
    for (const acceptance of acceptances) this.#acceptances.set(acceptance.submissionId, acceptance)
  }

  async findById(id: string): Promise<SpeakerTask | null> {
    return this.#tasks.get(id) ?? null
  }

  async listByEvent(eventId: string): Promise<readonly SpeakerTask[]> {
    return this.#sorted((task) => task.eventId === eventId)
  }

  async listByContact(eventId: string, contactId: string): Promise<readonly SpeakerTask[]> {
    return this.#sorted((task) => task.eventId === eventId && task.contactId === contactId)
  }

  async listBySubmission(eventId: string, submissionId: string): Promise<readonly SpeakerTask[]> {
    return this.#sorted((task) => task.eventId === eventId && task.submissionId === submissionId)
  }

  async findAcceptance(
    eventId: string,
    submissionId: string,
  ): Promise<SubmissionAcceptance | null> {
    const acceptance = this.#acceptances.get(submissionId)
    return acceptance !== undefined && acceptance.eventId === eventId ? acceptance : null
  }

  async listAcceptancesByEvent(eventId: string): Promise<readonly SubmissionAcceptance[]> {
    return [...this.#acceptances.values()]
      .filter((acceptance) => acceptance.eventId === eventId)
      .sort((a, b) => a.submissionId.localeCompare(b.submissionId))
  }

  async markCompleted(
    eventId: string,
    id: string,
    completedAt: string,
    response?: AnswerMap,
  ): Promise<SpeakerTask | null> {
    const task = this.#tasks.get(id)
    if (task === undefined || task.eventId !== eventId) return null
    const completed = completeSpeakerTask(task, completedAt, response ?? null)
    this.#tasks.set(id, completed)
    return completed
  }

  async createFormTask(task: SpeakerTask): Promise<SpeakerTask> {
    const existing = await this.findFormTask(
      task.eventId,
      task.submissionId,
      task.contactId,
      task.formId ?? '',
    )
    if (existing !== null) return existing
    this.#tasks.set(task.id, task)
    return task
  }

  async findFormTask(
    eventId: string,
    submissionId: string,
    contactId: string,
    formId: string,
  ): Promise<SpeakerTask | null> {
    for (const task of this.#tasks.values()) {
      if (
        task.eventId === eventId &&
        task.submissionId === submissionId &&
        task.contactId === contactId &&
        task.formId === formId
      ) {
        return task
      }
    }
    return null
  }

  /** Test-only write used to build fixtures without a unit of work. */
  seed(task: SpeakerTask): void {
    this.#tasks.set(task.id, task)
  }

  seedAcceptance(acceptance: SubmissionAcceptance): void {
    this.#acceptances.set(acceptance.submissionId, acceptance)
  }

  #sorted(predicate: (task: SpeakerTask) => boolean): readonly SpeakerTask[] {
    return [...this.#tasks.values()]
      .filter(predicate)
      .sort((a, b) => a.submissionId.localeCompare(b.submissionId) || a.position - b.position)
  }
}

/**
 * In-memory twin of the D1 accept batch: acceptance-first, gated task inserts,
 * and the same idempotent outcomes. Writes are staged and applied only when the
 * whole batch succeeds, mirroring the atomic D1 `batch()`.
 */
export interface RecordedAgendaSession extends AcceptSessionDraft {
  readonly eventId: string
  readonly submissionId: string
}

export class InMemoryAcceptUnitOfWork implements AcceptUnitOfWork {
  readonly #tasks: InMemorySpeakerTaskRepository
  readonly #knownSubmissions: ReadonlySet<string>
  readonly #knownContacts: ReadonlySet<string>
  readonly #sessions = new Map<string, RecordedAgendaSession>()

  constructor(
    tasks: InMemorySpeakerTaskRepository,
    knownSubmissions: readonly string[] = [],
    knownContacts: readonly string[] = [],
  ) {
    this.#tasks = tasks
    this.#knownSubmissions = new Set(knownSubmissions)
    this.#knownContacts = new Set(knownContacts)
  }

  async execute(input: AcceptBatchInput): Promise<AcceptBatchResult> {
    if (!this.#knownSubmissions.has(input.submissionId)) {
      return { outcome: 'not-found', acceptance: null, tasks: [] }
    }
    for (const task of input.tasks) {
      if (!this.#knownContacts.has(task.contactId)) {
        throw new Error('accept batch violates the speaker_tasks contact foreign key')
      }
    }
    for (const contactId of input.session.speakerContactIds) {
      if (!this.#knownContacts.has(contactId)) {
        throw new Error('accept batch violates the agenda_session_speakers contact foreign key')
      }
    }
    const existing = await this.#tasks.findAcceptance(input.eventId, input.submissionId)
    if (existing !== null) {
      return {
        outcome: 'already-accepted',
        acceptance: existing,
        tasks: await this.#tasks.listBySubmission(input.eventId, input.submissionId),
      }
    }
    const acceptance = {
      eventId: input.eventId,
      submissionId: input.submissionId,
      acceptedAt: input.acceptedAt,
    }
    this.#tasks.seedAcceptance(acceptance)
    for (const task of input.tasks) this.#tasks.seed(task)
    // The agenda row is keyed by submission exactly like the UNIQUE constraint,
    // so a repeated accept can never place a second session.
    if (!this.#sessions.has(input.submissionId)) {
      this.#sessions.set(input.submissionId, {
        eventId: input.eventId,
        submissionId: input.submissionId,
        ...input.session,
      })
    }
    return {
      outcome: 'accepted',
      acceptance,
      tasks: await this.#tasks.listBySubmission(input.eventId, input.submissionId),
    }
  }

  /** Test-only read of the agenda sessions the batch materialised. */
  listSessions(): readonly RecordedAgendaSession[] {
    return [...this.#sessions.values()]
  }
}

/** In-memory twin of the D1 uploaded-file adapter (one row per owner+kind). */
export class InMemoryUploadedFileRepository implements UploadedFileRepository {
  readonly #records = new Map<string, UploadedFileRecord>()

  #key(eventId: string, ownerContactId: string, kind: string): string {
    return `${eventId}|${ownerContactId}|${kind}`
  }

  async findOwn(
    eventId: string,
    ownerContactId: string,
    kind: UploadedFileKind,
  ): Promise<UploadedFileRecord | null> {
    return this.#records.get(this.#key(eventId, ownerContactId, kind)) ?? null
  }

  async upsert(record: UploadedFileRecord): Promise<UploadedFileRecord | null> {
    const key = this.#key(record.eventId, record.ownerContactId, record.kind)
    const previous = this.#records.get(key) ?? null
    this.#records.set(key, record)
    return previous
  }
}
