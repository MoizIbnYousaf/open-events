import type { D1Database } from '@cloudflare/workers-types'

import {
  CapturedMessageService,
  DraftService,
  EventConfigService,
  FormBuilderService,
  GetEvent,
  OnboardingService,
  SessionService,
  SubmitService,
  TaxonomyService,
  createSha256TokenHasher,
  createUuidTokenGenerator,
  type Clock,
  type EventRepository,
  type FormRepository,
  type SubmissionRepository,
  type TaxonomyRepository,
} from '../application'
import {
  createAcceptUnitOfWork,
  createAgendaRepository,
  createCapturedMessageRepository,
  createContactRepository,
  createDraftRepository,
  createEventConfigRepository,
  createEventRepository,
  createFormBuilderUnitOfWork,
  createFormContentRepository,
  createFormRepository,
  createFormVersionRepository,
  createSessionRepository,
  createSessionUnitOfWork,
  createSpeakerTaskRepository,
  createSubmissionRepository,
  createSubmitUnitOfWork,
  createTaxonomyRepository,
  createTokenRepository,
} from '../db'
import type { AgendaRepository } from '../db'

import type { ServerContext } from './env'
import { getDatabaseBinding } from './env'

/** Fully wired application services for one D1 binding. */
export interface ServerDeps {
  readonly clock: Clock
  readonly events: EventRepository
  readonly forms: FormRepository
  readonly getEvent: GetEvent
  readonly agenda: AgendaRepository
  readonly submissions: SubmissionRepository
  readonly taxonomies: TaxonomyRepository
  readonly session: SessionService
  readonly eventConfig: EventConfigService
  readonly taxonomy: TaxonomyService
  readonly formBuilder: FormBuilderService
  readonly drafts: DraftService
  readonly submit: SubmitService
  readonly onboarding: OnboardingService
  readonly capturedMessages: CapturedMessageService
}

/** Builds every frozen service/adapters for a raw D1 binding. */
export function buildServerDeps(db: D1Database): ServerDeps {
  const clock: Clock = { now: () => new Date().toISOString() }
  const events = createEventRepository(db)
  const forms = createFormRepository(db)
  const versions = createFormVersionRepository(db)
  const content = createFormContentRepository(db)
  const contacts = createContactRepository(db)

  return {
    clock,
    events,
    forms,
    getEvent: new GetEvent(events),
    agenda: createAgendaRepository(db),
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
    eventConfig: new EventConfigService(createEventConfigRepository(db)),
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
    ),
    onboarding: new OnboardingService(
      createSubmissionRepository(db),
      createSpeakerTaskRepository(db),
      createAcceptUnitOfWork(db),
      clock,
    ),
    capturedMessages: new CapturedMessageService(createCapturedMessageRepository(db)),
  }
}

/** Resolves the deps for a request, or null when the D1 binding is missing. */
export function depsFromContext(context: ServerContext): ServerDeps | null {
  const db = getDatabaseBinding(context)
  return db === null ? null : buildServerDeps(db)
}
