import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

export interface AcceptanceResetReceipt {
  readonly auditId: string
  readonly eventId: string
  readonly objectCount: number
  readonly createdAt: string
}

export interface AcceptanceResetInput extends AcceptanceResetReceipt {
  readonly buildRevision: string
  readonly d1Id: string
  readonly r2Bucket: string
}

const EVENT_DELETE_STATEMENTS = [
  `DELETE FROM resend_webhook_events WHERE job_id IN
     (SELECT id FROM email_delivery_jobs WHERE event_id = ?)`,
  `DELETE FROM email_delivery_budget_events WHERE job_id IN
     (SELECT id FROM email_delivery_jobs WHERE event_id = ?)`,
  'DELETE FROM email_delivery_jobs WHERE event_id = ?',
  'DELETE FROM confirmation_records WHERE event_id = ?',
  'DELETE FROM captured_messages WHERE event_id = ?',
  'DELETE FROM submit_session_handoffs WHERE event_id = ?',
  `DELETE FROM support_messages WHERE chat_id IN
     (SELECT id FROM support_chats WHERE event_id = ?)`,
  'DELETE FROM support_chats WHERE event_id = ?',
  `DELETE FROM speaker_assignment_assignees WHERE assignment_id IN
     (SELECT id FROM speaker_assignments WHERE event_id = ?)`,
  'DELETE FROM speaker_assignments WHERE event_id = ?',
  'DELETE FROM uploaded_file_comments WHERE event_id = ?',
  'DELETE FROM uploaded_file_versions WHERE event_id = ?',
  'DELETE FROM uploaded_files WHERE event_id = ?',
  'DELETE FROM content_revisions WHERE event_id = ?',
  'DELETE FROM session_content_status WHERE event_id = ?',
  'DELETE FROM speaker_profiles WHERE event_id = ?',
  'DELETE FROM embeds WHERE event_id = ?',
  'DELETE FROM speaker_tasks WHERE event_id = ?',
  'DELETE FROM submission_decisions WHERE event_id = ?',
  'DELETE FROM agenda_session_speakers WHERE event_id = ?',
  'DELETE FROM agenda_sessions WHERE event_id = ?',
  'DELETE FROM evaluation_round_scores WHERE event_id = ?',
  'DELETE FROM evaluation_scores WHERE event_id = ?',
  'DELETE FROM evaluation_assignments WHERE event_id = ?',
  'DELETE FROM evaluation_round_pool WHERE event_id = ?',
  'DELETE FROM evaluation_round_criteria WHERE event_id = ?',
  'DELETE FROM evaluation_committee_members WHERE event_id = ?',
  'DELETE FROM evaluation_rounds WHERE event_id = ?',
  'DELETE FROM evaluation_criteria WHERE event_id = ?',
  'DELETE FROM submission_acceptances WHERE event_id = ?',
  'DELETE FROM submission_contributors WHERE event_id = ?',
  'DELETE FROM proposal_submissions WHERE event_id = ?',
  'DELETE FROM proposal_drafts WHERE event_id = ?',
  'DELETE FROM submitter_tokens WHERE event_id = ?',
  'DELETE FROM sessions WHERE event_id = ?',
  'DELETE FROM cfp_condition_rules WHERE event_id = ?',
  'DELETE FROM cfp_routing_rules WHERE event_id = ?',
  'DELETE FROM cfp_elements WHERE event_id = ?',
  'DELETE FROM cfp_pages WHERE event_id = ?',
  'DELETE FROM cfp_form_versions WHERE event_id = ?',
  'DELETE FROM cfp_forms WHERE event_id = ?',
  'DELETE FROM taxonomy_items WHERE event_id = ?',
  'DELETE FROM event_email_templates WHERE event_id = ?',
  'DELETE FROM events WHERE id = ?',
] as const

/** One transaction: authorize one event, remove only its rows, append receipt. */
export async function resetAcceptanceEvent(
  db: D1Database,
  input: AcceptanceResetInput,
): Promise<AcceptanceResetReceipt> {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO acceptance_reset_authorizations (event_id, nonce, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(event_id) DO UPDATE SET nonce = excluded.nonce, created_at = excluded.created_at`,
      )
      .bind(input.eventId, crypto.randomUUID(), input.createdAt),
    ...EVENT_DELETE_STATEMENTS.map((sql) => db.prepare(sql).bind(input.eventId)),
    db
      .prepare(
        `INSERT INTO acceptance_reset_audits
           (id, event_id, environment, build_revision, d1_id, r2_bucket, object_count, created_at)
         VALUES (?, ?, 'acceptance', ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.auditId,
        input.eventId,
        input.buildRevision,
        input.d1Id,
        input.r2Bucket,
        input.objectCount,
        input.createdAt,
      ),
    db
      .prepare('DELETE FROM acceptance_reset_authorizations WHERE event_id = ?')
      .bind(input.eventId),
  ]
  await db.batch(statements)
  return {
    auditId: input.auditId,
    eventId: input.eventId,
    objectCount: input.objectCount,
    createdAt: input.createdAt,
  }
}
