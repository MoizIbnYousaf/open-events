import type { D1Database } from '@cloudflare/workers-types'

import {
  createSha256TokenHasher,
  createUuidTokenGenerator,
} from '../application/security/webcrypto'
import { AgendaService } from '../application/services/agenda'
import { SpeakerService } from '../application/services/speakers'
import { SupportService } from '../application/services/support'
import { AssignmentService } from '../application/services/assignments'
import { ContentLibraryService } from '../application/services/content-library'
import { EmbedService } from '../application/services/embeds'
import { capturingEmailSender, selectEmailSender } from './email'
import { selectOrbyReplyer } from './orby'
import type { OrbyReplyer } from '../application/ports/orby-replyer'
import type { EmailSender } from '../application/ports/email-sender'
import type { CapturedMessageRepository } from '../application/ports/captured-message-repository'
import { CapturedMessageService } from '../application/services/captured-messages'
import { CommunicationsService } from '../application/services/communications'
import { DocumentService } from '../application/services/documents'
import { DraftService } from '../application/services/drafts'
import { EvaluationService } from '../application/services/evaluations'
import { EventConfigService } from '../application/services/event-config'
import { FormBuilderService } from '../application/services/form-builder'
import { GetEvent } from '../application/services/get-event'
import { HeadshotService } from '../application/services/headshots'
import { OnboardingService } from '../application/services/onboarding'
import { ProfileService } from '../application/services/profile'
import { SessionService } from '../application/services/session'
import { SubmitService } from '../application/services/submit'
import { TaxonomyService } from '../application/services/taxonomy'
import type { AgendaRepository } from '../application/ports/agenda-repository'
import type { Clock } from '../application/ports/clock'
import type { ContactRepository } from '../application/ports/contact-repository'
import type { EventRepository } from '../application/ports/event-repository'
import type { FormContentRepository } from '../application/ports/form-content-repository'
import type { FormRepository } from '../application/ports/form-repository'
import type { ProgrammeRepository } from '../application/ports/programme-repository'
import type { SubmissionRepository } from '../application/ports/submission-repository'
import type { TaxonomyRepository } from '../application/ports/taxonomy-repository'
import { createAcceptUnitOfWork } from '../db/accept-unit-of-work'
import { createAgendaRepository } from '../db/agenda-repository'
import { createEvaluationRepository } from '../db/evaluation-repository'
import { createFormBuilderUnitOfWork } from '../db/form-builder-unit-of-work'
import {
  createCapturedMessageRepository,
  createContactRepository,
  createDraftRepository,
  createEventConfigRepository,
  createEventRepository,
  createFormContentRepository,
  createFormRepository,
  createFormVersionRepository,
  createSessionRepository,
  createSubmissionRepository,
  createTaxonomyRepository,
  createTokenRepository,
} from '../db/repositories'
import { createProgrammeRepository } from '../db/programme-repository'
import { createSessionUnitOfWork } from '../db/session-unit-of-work'
import { createSpeakerTaskRepository } from '../db/speaker-task-repository'
import { createSubmitUnitOfWork } from '../db/submit-unit-of-work'
import { createSupportRepository } from '../db/support-repository'
import { createUploadedFileRepository } from '../db/uploaded-file-repository'

import type { ServerContext } from './env'
import { getDatabaseBinding, getFilesBinding } from './env'
import { createR2ObjectStorage } from './storage'

/** Fully wired application services for one D1 binding. */
export interface ServerDeps {
  readonly clock: Clock
  readonly events: EventRepository
  readonly forms: FormRepository
  readonly getEvent: GetEvent
  readonly contacts: ContactRepository
  readonly formContent: FormContentRepository
  readonly programme: ProgrammeRepository
  readonly agenda: AgendaRepository
  readonly agendaBoard: AgendaService
  readonly submissions: SubmissionRepository
  readonly taxonomies: TaxonomyRepository
  readonly embeds: EmbedService
  readonly contentLibrary: ContentLibraryService
  readonly assignments: AssignmentService
  readonly session: SessionService
  readonly eventConfig: EventConfigService
  readonly taxonomy: TaxonomyService
  readonly formBuilder: FormBuilderService
  readonly drafts: DraftService
  readonly submit: SubmitService
  readonly onboarding: OnboardingService
  readonly profile: ProfileService
  readonly evaluations: EvaluationService
  readonly capturedMessages: CapturedMessageService
  readonly speakers: SpeakerService
  /** Null when the Worker has no R2 uploads binding. */
  readonly headshots: HeadshotService | null
  /** Null when the Worker has no R2 uploads binding. */
  readonly documents: DocumentService | null

  readonly communications: CommunicationsService
  readonly support: SupportService
}

/** Builds every frozen service/adapters for the raw D1 and R2 bindings. */
/**
 * Records the message, then tries to deliver it.
 *
 * Wrapping the repository rather than editing every service is deliberate:
 * magic links, acceptances and reminders all already write through this one
 * seam, so delivery reaches all of them without a single call site learning
 * that email exists. The save happens FIRST and its failure still propagates —
 * losing the record is a real error — while a delivery failure is swallowed by
 * the sender, because a proposal is submitted whether or not its confirmation
 * left the building.
 */
function withDelivery(
  inner: CapturedMessageRepository,
  sender: EmailSender,
): CapturedMessageRepository {
  return {
    ...inner,
    async save(message) {
      await inner.save(message)
      await sender.send({
        to: message.toEmail,
        subject: message.subject,
        body: message.body,
      })
    },
  }
}

export function buildServerDeps(
  db: D1Database,
  files: R2Bucket | null = null,
  // Capture-only unless a deployment configures a provider, so the safe
  // behaviour is what you get by default and turning on real delivery is the
  // deliberate act.
  emailSender: EmailSender = capturingEmailSender,
  orby: OrbyReplyer = selectOrbyReplyer({}),
): ServerDeps {
  const clock: Clock = { now: () => new Date().toISOString() }
  const events = createEventRepository(db)
  const forms = createFormRepository(db)
  const versions = createFormVersionRepository(db)
  const content = createFormContentRepository(db)
  const contacts = createContactRepository(db)
  const agenda = createAgendaRepository(db)

  return {
    clock,
    events,
    forms,
    getEvent: new GetEvent(events),
    contacts,
    agenda,
    agendaBoard: new AgendaService(
      events,
      agenda,
      createSubmissionRepository(db),
      createTaxonomyRepository(db),
      createSpeakerTaskRepository(db),
      clock,
    ),
    submissions: createSubmissionRepository(db),
    taxonomies: createTaxonomyRepository(db),
    session: new SessionService(
      createTokenRepository(db),
      createSessionRepository(db),
      contacts,
      events,
      forms,
      createSha256TokenHasher(),
      createUuidTokenGenerator(),
      createSessionUnitOfWork(db),
      clock,
    ),
    formContent: content,
    programme: createProgrammeRepository(db),
    eventConfig: new EventConfigService(createEventConfigRepository(db), clock),
    taxonomy: new TaxonomyService(events, createTaxonomyRepository(db)),
    formBuilder: new FormBuilderService(
      events,
      forms,
      versions,
      content,
      createTaxonomyRepository(db),
      createFormBuilderUnitOfWork(db),
      clock,
    ),
    drafts: new DraftService(createDraftRepository(db), forms, versions, clock),
    submit: new SubmitService(
      createDraftRepository(db),
      createSubmissionRepository(db),
      contacts,
      forms,
      versions,
      content,
      createSubmitUnitOfWork(db),
      clock,
      createProgrammeRepository(db),
    ),
    profile: new ProfileService(contacts),
    onboarding: new OnboardingService(
      createSubmissionRepository(db),
      events,
      createSpeakerTaskRepository(db),
      createAcceptUnitOfWork(db),
      clock,
      forms,
      versions,
      content,
      contacts,
      createUploadedFileRepository(db),
      createTaxonomyRepository(db),
    ),
    evaluations: new EvaluationService(
      createSubmissionRepository(db),
      contacts,
      createEvaluationRepository(db),
      clock,
      withDelivery(createCapturedMessageRepository(db), emailSender),
    ),
    // The dev inbox READS the log; it never sends, so it is deliberately not
    // wrapped — reading a message must not be able to re-deliver it.
    capturedMessages: new CapturedMessageService(createCapturedMessageRepository(db)),
    speakers: new SpeakerService(contacts, clock),
    embeds: new EmbedService(events, createProgrammeRepository(db), clock),
    contentLibrary: new ContentLibraryService(
      events,
      createUploadedFileRepository(db),
      createProgrammeRepository(db),
      createSubmissionRepository(db),
      contacts,
      clock,
      files === null ? null : createR2ObjectStorage(files),
    ),
    assignments: new AssignmentService(events, createProgrammeRepository(db), clock),
    documents:
      files === null
        ? null
        : new DocumentService(
            createUploadedFileRepository(db),
            createR2ObjectStorage(files),
            clock,
          ),
    headshots:
      files === null
        ? null
        : new HeadshotService(
            createUploadedFileRepository(db),
            createR2ObjectStorage(files),
            clock,
          ),

    communications: new CommunicationsService(
      createSubmissionRepository(db),
      events,
      contacts,
      withDelivery(createCapturedMessageRepository(db), emailSender),
      createSpeakerTaskRepository(db),
      clock,
    ),
    support: new SupportService(
      events,
      contacts,
      createSupportRepository(db),
      withDelivery(createCapturedMessageRepository(db), emailSender),
      createSha256TokenHasher(),
      createUuidTokenGenerator(),
      clock,
      orby,
    ),
  }
}

/** Resolves the deps for a request, or null when the D1 binding is missing. */
export function depsFromContext(context: ServerContext): ServerDeps | null {
  const db = getDatabaseBinding(context)
  return db === null
    ? null
    : buildServerDeps(
        db,
        getFilesBinding(context),
        selectEmailSender(context.env),
        selectOrbyReplyer(context.env),
      )
}
