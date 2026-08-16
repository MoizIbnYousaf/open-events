import type { CapturedMessageRepository, RoleAccessIssuer } from '../../../src/application'
import { FIXED_NOW } from './fixtures'

export function createInMemoryRoleAccessIssuer(
  messages: CapturedMessageRepository,
): RoleAccessIssuer {
  let sequence = 0
  return {
    async issueRoleAccess(_actor, input) {
      sequence += 1
      const accessUrl = `https://www.openevents.engineer/api/public/session?token=role-${sequence}`
      const message = {
        id: `role-message-${sequence}`,
        eventId: input.eventId,
        toEmail: input.email.trim().toLowerCase(),
        subject: input.subject,
        body: input.renderBody(accessUrl),
        createdAt: FIXED_NOW,
        kind: input.kind,
        submissionId: input.submissionId ?? null,
      }
      await messages.save(message)
      return { outcome: 'issued', accessUrl, message }
    },
  }
}
