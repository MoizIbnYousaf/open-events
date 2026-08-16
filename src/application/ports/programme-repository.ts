import type { ContactId, EventId, SubmissionId, UtcInstant } from '../../domain'
import type {
  AssignmentKind,
  EmbedRecord,
  SessionContentStatus,
  SpeakerWorkflowStatus,
} from '../../domain/embed'

export interface ContentRevisionRecord {
  readonly id: string
  readonly eventId: EventId
  readonly submissionId: SubmissionId
  readonly editorName: string
  readonly title: string
  readonly abstract: string
  readonly createdAt: UtcInstant
}

export interface SpeakerAssignmentRecord {
  readonly id: string
  readonly eventId: EventId
  readonly title: string
  readonly dueAt: string | null
  readonly kind: AssignmentKind
  readonly instructions: string
  readonly createdAt: UtcInstant
}

export interface SpeakerAssignmentAssigneeRecord {
  readonly assignmentId: string
  readonly contactId: ContactId
  readonly status: 'pending' | 'completed'
  readonly completedAt: UtcInstant | null
}

export interface ProgrammeRepository {
  listEmbeds(eventId: EventId): Promise<readonly EmbedRecord[]>
  findEmbed(id: string): Promise<EmbedRecord | null>
  saveEmbed(record: EmbedRecord): Promise<void>

  listRevisions(
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<readonly ContentRevisionRecord[]>
  addRevision(record: ContentRevisionRecord): Promise<void>
  findRevision(id: string): Promise<ContentRevisionRecord | null>

  getContentStatus(eventId: EventId, submissionId: SubmissionId): Promise<SessionContentStatus>
  setContentStatus(
    eventId: EventId,
    submissionId: SubmissionId,
    status: SessionContentStatus,
  ): Promise<void>
  listContentStatuses(
    eventId: EventId,
  ): Promise<readonly { submissionId: SubmissionId; status: SessionContentStatus }[]>

  saveAssignment(record: SpeakerAssignmentRecord): Promise<void>
  listAssignments(eventId: EventId): Promise<readonly SpeakerAssignmentRecord[]>
  findAssignment(id: string): Promise<SpeakerAssignmentRecord | null>
  setAssignees(
    assignmentId: string,
    assignees: readonly SpeakerAssignmentAssigneeRecord[],
  ): Promise<void>
  listAssignees(assignmentId: string): Promise<readonly SpeakerAssignmentAssigneeRecord[]>
  listAssigneesForContact(
    eventId: EventId,
    contactId: ContactId,
  ): Promise<
    readonly (SpeakerAssignmentRecord & {
      readonly status: 'pending' | 'completed'
      readonly completedAt: UtcInstant | null
    })[]
  >
  completeAssignee(
    assignmentId: string,
    contactId: ContactId,
    completedAt: UtcInstant,
  ): Promise<'updated' | 'not-found'>

  findSpeakerProfile(
    eventId: EventId,
    contactId: ContactId,
  ): Promise<{
    jobTitle: string
    company: string
    travelNotes: string
    workflowStatus: SpeakerWorkflowStatus
  } | null>

  getEmailTemplate(
    eventId: EventId,
    kind: 'confirmation',
  ): Promise<{ readonly subject: string; readonly body: string } | null>
  saveEmailTemplate(
    eventId: EventId,
    kind: 'confirmation',
    subject: string,
    body: string,
  ): Promise<void>
}
