import type {
  DraftDto,
  FormDefinitionDto,
  SaveDraftInput,
  SubmissionDetailDto,
  SubmitInput,
} from '../../application'

import { ApiClientError, requestJson } from './admin-events'

type StartResponse = { readonly status: 'accepted' }

/** POST /api/public/start: uniform 202 { status: 'accepted' }, no link/token. */
export function startSession(
  email: string,
  eventSlug: string,
  formSlug: string,
): Promise<StartResponse> {
  return requestJson<StartResponse>('/api/public/start', {
    method: 'POST',
    body: JSON.stringify({ email, eventSlug, formSlug }),
  })
}

/**
 * GET /api/public/draft?formId= — the helper maps a 404 (no active draft) to
 * null locally; all other errors (including 409) propagate.
 */
export async function getActiveDraft(formId: string): Promise<DraftDto | null> {
  try {
    return await requestJson<DraftDto>(`/api/public/draft?formId=${encodeURIComponent(formId)}`)
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return null
    throw error
  }
}

/** PUT /api/public/draft: save/resume the active draft (actor/owner server-side). */
export function saveDraft(input: SaveDraftInput): Promise<DraftDto> {
  return requestJson<DraftDto>('/api/public/draft', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

/** POST /api/public/submit: idempotent final submit (gate outcomes -> 409). */
export function submitCfp(input: SubmitInput): Promise<SubmissionDetailDto> {
  return requestJson<SubmissionDetailDto>('/api/public/submit', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/**
 * GET /api/public/cfp/:eventSlug/:formSlug — the published form definition.
 * 404 (unknown event/form) maps to null helper-locally; all else propagates.
 */
export async function getPublishedFormDefinition(
  eventSlug: string,
  formSlug: string,
): Promise<FormDefinitionDto | null> {
  try {
    return await requestJson<FormDefinitionDto>(
      `/api/public/cfp/${encodeURIComponent(eventSlug)}/${encodeURIComponent(formSlug)}`,
    )
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return null
    throw error
  }
}
