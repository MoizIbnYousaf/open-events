import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import app from '../../src/server'
import { applyMigrations, seedDemoConf, seedDemoConfShowcase } from './m2b-helpers'
import { bindings } from './m2c-helpers'

describe('the complete showcase seed', () => {
  beforeEach(async () => {
    await reset()
    await applyMigrations(env.DB)
    await seedDemoConf(env.DB)
  })

  async function applyTwice(): Promise<void> {
    await seedDemoConfShowcase(env.DB)
    await seedDemoConfShowcase(env.DB)
  }

  it('is idempotent and exposes a coherent mixed lifecycle', async () => {
    await applyTwice()
    const counts = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM proposal_submissions) AS submissions,
        (SELECT COUNT(*) FROM submission_acceptances) AS accepted,
        (SELECT COUNT(*) FROM submission_decisions WHERE outcome = 'rejected') AS rejected,
        (SELECT COUNT(*) FROM proposal_submissions s WHERE NOT EXISTS (
          SELECT 1 FROM submission_decisions d WHERE d.submission_id = s.id
        )) AS pending,
        (SELECT COUNT(*) FROM agenda_sessions WHERE status = 'published') AS published,
        (SELECT COUNT(*) FROM evaluation_rounds) AS rounds,
        (SELECT COUNT(*) FROM evaluation_assignments WHERE recused_at IS NOT NULL) AS recusals,
        (SELECT COUNT(*) FROM speaker_tasks WHERE status = 'pending') AS pending_tasks,
        (SELECT COUNT(*) FROM speaker_tasks WHERE status = 'completed') AS completed_tasks`,
    ).first<Record<string, number>>()

    expect(counts).toMatchObject({
      submissions: 12,
      accepted: 8,
      rejected: 2,
      pending: 2,
      published: 8,
      rounds: 2,
      recusals: 1,
      pending_tasks: 6,
      completed_tasks: 3,
    })

    const event = await env.DB.prepare(
      `SELECT status, starts_at, ends_at FROM events
       WHERE id = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'`,
    ).first<{ status: string; starts_at: string; ends_at: string }>()
    expect(event).toEqual({
      status: 'published',
      starts_at: '2026-10-14T08:00:00.000Z',
      ends_at: '2026-10-15T17:00:00.000Z',
    })
  })

  it('keeps every published session attached to public programme data', async () => {
    await seedDemoConfShowcase(env.DB)
    const incomplete = await env.DB.prepare(
      `SELECT a.submission_id
       FROM agenda_sessions a
       LEFT JOIN proposal_submissions s ON s.event_id = a.event_id AND s.id = a.submission_id
       LEFT JOIN submission_acceptances x ON x.event_id = a.event_id AND x.submission_id = a.submission_id
       LEFT JOIN taxonomy_items room ON room.event_id = a.event_id AND room.id = a.room_id AND room.kind = 'room'
       LEFT JOIN taxonomy_items track ON track.event_id = a.event_id AND track.id = a.track_id AND track.kind = 'track'
       WHERE a.status = 'published' AND (
         s.id IS NULL OR x.submission_id IS NULL OR room.id IS NULL OR track.id IS NULL OR
         NOT EXISTS (SELECT 1 FROM agenda_session_speakers sp WHERE sp.event_id = a.event_id AND sp.submission_id = a.submission_id) OR
         NOT EXISTS (SELECT 1 FROM agenda_session_speakers sp JOIN speaker_profiles p ON p.event_id = sp.event_id AND p.contact_id = sp.contact_id WHERE sp.event_id = a.event_id AND sp.submission_id = a.submission_id)
       )`,
    ).all()
    expect(incomplete.results).toEqual([])

    const response = await app.request(
      '/api/public/events/demo-conf-2026/schedule',
      undefined,
      bindings(),
    )
    expect(response.status).toBe(200)
    const programme = (await response.json()) as {
      sessions: Array<{ day: string; speakers: readonly unknown[] }>
    }
    expect(programme.sessions).toHaveLength(8)
    expect(new Set(programme.sessions.map((session) => session.day))).toEqual(
      new Set(['2026-10-14', '2026-10-15']),
    )
    expect(programme.sessions.every((session) => session.speakers.length > 0)).toBe(true)
  })

  it('contains the recusal, reassignment, and deterministic speaker conflict', async () => {
    await seedDemoConfShowcase(env.DB)
    const reassignment = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM evaluation_assignments
       WHERE round_id = 'showcase-round-2'
         AND submission_id = 'd0000000-0000-4000-8000-000000000811'`,
    ).first<{ n: number }>()
    expect(reassignment?.n).toBe(2)

    const overlaps = await env.DB.prepare(
      `SELECT COUNT(*) AS n
       FROM agenda_sessions left_session
       JOIN agenda_session_speakers left_speaker
         ON left_speaker.event_id = left_session.event_id
        AND left_speaker.submission_id = left_session.submission_id
       JOIN agenda_session_speakers right_speaker
         ON right_speaker.event_id = left_speaker.event_id
        AND right_speaker.contact_id = left_speaker.contact_id
        AND right_speaker.submission_id > left_speaker.submission_id
       JOIN agenda_sessions right_session
         ON right_session.event_id = right_speaker.event_id
        AND right_session.submission_id = right_speaker.submission_id
       WHERE left_session.start < right_session.end
         AND right_session.start < left_session.end`,
    ).first<{ n: number }>()
    expect(overlaps?.n).toBe(1)
  })

  it('provides the exact builder, portal, embed, file, support, and review story', async () => {
    await applyTwice()
    const receipt = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM cfp_form_versions WHERE id = 'showcase-form-draft' AND status = 'draft') AS drafts,
        (SELECT COUNT(*) FROM cfp_pages WHERE version_id = 'showcase-form-draft') AS draft_pages,
        (SELECT COUNT(*) FROM cfp_condition_rules WHERE version_id = 'showcase-form-draft') AS draft_conditions,
        (SELECT COUNT(*) FROM cfp_routing_rules WHERE version_id = 'showcase-form-draft') AS draft_routes,
        (SELECT COUNT(*) FROM embeds WHERE id = 'showcase-schedule-embed' AND enabled = 1) AS embeds,
        (SELECT COUNT(*) FROM uploaded_files WHERE owner_contact_id = 'd0000000-0000-4000-8000-000000000610') AS files,
        (SELECT COUNT(*) FROM uploaded_file_versions WHERE owner_contact_id = 'd0000000-0000-4000-8000-000000000610') AS file_versions,
        (SELECT COUNT(*) FROM speaker_assignment_assignees WHERE assignment_id = 'showcase-file-request' AND status = 'pending') AS file_requests,
        (SELECT COUNT(*) FROM support_messages WHERE chat_id = 'showcase-support-chat') AS support_messages,
        (SELECT COUNT(*) FROM evaluation_round_scores WHERE assignment_id = 'showcase-assignment-featured') AS featured_scores`,
    ).first<Record<string, number>>()

    expect(receipt).toEqual({
      drafts: 1,
      draft_pages: 4,
      draft_conditions: 2,
      draft_routes: 1,
      embeds: 1,
      files: 2,
      file_versions: 1,
      file_requests: 1,
      support_messages: 2,
      featured_scores: 3,
    })
  })

  it('cannot be drained or interpreted as provider evidence', async () => {
    await seedDemoConfShowcase(env.DB)
    const safety = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM captured_messages WHERE to_email LIKE '%@%') AS raw_recipients,
        (SELECT COUNT(*) FROM captured_messages WHERE body LIKE '%token=%' OR body LIKE '%/start/%') AS bearer_links,
        (SELECT COUNT(*) FROM email_delivery_jobs WHERE status IN ('queued', 'leased', 'retry') OR next_attempt_at IS NOT NULL) AS drainable,
        (SELECT COUNT(*) FROM email_delivery_jobs WHERE provider_id IS NOT NULL OR provider_event_id IS NOT NULL OR provider_status IS NOT NULL) AS provider_evidence,
        (SELECT COUNT(*) FROM email_delivery_jobs WHERE nonce IS NOT NULL OR ciphertext IS NOT NULL) AS payloads,
        (SELECT COUNT(*) FROM email_delivery_budget_events) AS budgets,
        (SELECT COUNT(*) FROM submitter_tokens) AS access_tokens`,
    ).first<Record<string, number>>()
    expect(safety).toEqual({
      raw_recipients: 0,
      bearer_links: 0,
      drainable: 0,
      provider_evidence: 0,
      payloads: 0,
      budgets: 0,
      access_tokens: 0,
    })
  })
})
