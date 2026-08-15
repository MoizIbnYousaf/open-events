export const CONFIRMATION_SUBJECT_TEMPLATE = 'Your submission was received'

export const CONFIRMATION_BODY_TEMPLATE =
  'Open Events: your submission "{{title}}" was received ({{submissionId}}).'

export interface ConfirmationTemplateVariables {
  readonly title: string
  readonly eventName: string
  readonly submissionId: string
}

export interface ConfirmationTemplates {
  readonly subject?: string
  readonly body?: string
}

/**
 * Substitutes the three supported `{{placeholder}}` tokens. Unknown tokens stay
 * verbatim so a typo is visible in the sent copy rather than becoming
 * `undefined`.
 */
export function renderConfirmationTemplate(
  template: string,
  variables: ConfirmationTemplateVariables,
): string {
  return template.replace(/\{\{(title|eventName|submissionId)\}\}/g, (_match, key: string) => {
    return variables[key as keyof ConfirmationTemplateVariables]
  })
}

/** Subject and body for the submit confirmation, defaults or organizer copy. */
export function renderConfirmationEmail(
  variables: ConfirmationTemplateVariables,
  templates?: ConfirmationTemplates,
): { readonly subject: string; readonly body: string } {
  const subjectTemplate = templates?.subject?.trim() || CONFIRMATION_SUBJECT_TEMPLATE
  const bodyTemplate = templates?.body?.trim() || CONFIRMATION_BODY_TEMPLATE
  return {
    subject: renderConfirmationTemplate(subjectTemplate, variables),
    body: renderConfirmationTemplate(bodyTemplate, variables),
  }
}
