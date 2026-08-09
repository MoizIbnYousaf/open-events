import StartForm from './StartForm'

/** Seeded DemoConf 2026 pair (src/db/seed.ts:19,42); the golden journey starts here. */
const START_EVENT_SLUG = 'demo-conf-2026'
const START_FORM_SLUG = 'cfp'

export function PublicStartPage() {
  return <StartForm eventSlug={START_EVENT_SLUG} formSlug={START_FORM_SLUG} />
}
