/**
 * WCAG 2.2 SC 1.3.5 (Identify Input Purpose) for organizer-authored CFP
 * questions. A CFP routinely asks the submitter for their own name, company,
 * job title, homepage or contact email, and those are exactly the fields the
 * token vocabulary exists for. The purpose is derived from the element's
 * fieldKey by one pure function so the live renderer and the builder preview
 * can never disagree about what a question autofills.
 *
 * Deliberately NOT modelled as data on FormElement: that would change the
 * canonical serialization behind the published-version content hash
 * (src/domain/invariants/content-hash.ts) and needs a migration. Derivation
 * is the correct size of change for an accessibility fix.
 */

/** Field-name tokens from the HTML autofill vocabulary that this app can honestly declare. */
export type AutocompletePurpose =
  | 'name'
  | 'given-name'
  | 'family-name'
  | 'email'
  | 'organization'
  | 'organization-title'
  | 'url'
  | 'tel'

/**
 * Frozen allow-list, exported so a test can enumerate it. 'title' is
 * deliberately absent: in this product it is the PROPOSAL title, not an
 * honorific prefix. 'bio' is absent because no token exists for prose.
 */
export const ELEMENT_AUTOCOMPLETE_KEYS: Readonly<Record<string, AutocompletePurpose>> =
  Object.freeze({
    name: 'name',
    full_name: 'name',
    speaker_name: 'name',
    first_name: 'given-name',
    given_name: 'given-name',
    last_name: 'family-name',
    family_name: 'family-name',
    surname: 'family-name',
    email: 'email',
    speaker_email: 'email',
    contact_email: 'email',
    organization: 'organization',
    organisation: 'organization',
    company: 'organization',
    employer: 'organization',
    job_title: 'organization-title',
    role_title: 'organization-title',
    website: 'url',
    homepage: 'url',
    url: 'url',
    phone: 'tel',
    telephone: 'tel',
  })

/** The shape both the live CFP element DTO and the builder's domain element satisfy. */
export interface AutocompleteCandidate {
  readonly fieldKey: string | null
  readonly questionType: string | null
}

export function autocompleteForElement(
  element: AutocompleteCandidate,
): AutocompletePurpose | undefined {
  // Only single-line text controls. long_text answers are free prose with no
  // token, and declaring one would additionally disable browser form-state
  // restoration of a half-typed abstract. single_choice/multi_choice option
  // values are organizer-authored strings that will never match the browser's
  // canonical values, so an autofilled value would fail the form's own
  // validation.
  if (element.questionType !== 'short_text' && element.questionType !== 'email') {
    return undefined
  }
  const fieldKey = element.fieldKey
  if (fieldKey === null) return undefined
  const normalized = fieldKey.toLowerCase().replaceAll('-', '_')
  const purpose = ELEMENT_AUTOCOMPLETE_KEYS[normalized]
  if (purpose === undefined) return undefined
  // Keep the email family explicit so the map stays safe if question types grow.
  if (
    purpose === 'email' &&
    element.questionType !== 'email' &&
    element.questionType !== 'short_text'
  ) {
    return undefined
  }
  return purpose
}
