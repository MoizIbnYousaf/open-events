import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// @ts-expect-error — scripts/golden-row-count.mjs is plain ESM (narrow documented boundary).
import * as goldenRowCountModule from '../../../scripts/golden-row-count.mjs'

const {
  countGoldenRows,
  countLifecycleRows,
  resolveDatabaseFile,
  resolveStateRoot,
  runWranglerCount,
  selectCounter,
} = goldenRowCountModule

const EVENT_SLUG = 'demo-conf-2026'
const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const BINDING = 'open-events-production'

function emptyDbStateRoot() {
  const root = mkdtempSync(join(tmpdir(), 's3a-'))
  const dbDir = join(root, 'v3', 'd1', 'miniflare-D1DatabaseObject')
  mkdirSync(dbDir, { recursive: true })
  writeFileSync(join(dbDir, '0123456789abcdef0123456789abcdef.sqlite'), 'schema-seeded-empty')
  writeFileSync(join(dbDir, 'metadata.sqlite'), '{}')
  return root
}

function zeroRowSpawn() {
  return () => ({
    status: 0,
    stdout: JSON.stringify([{ results: [{ 'COUNT(*)': 0 }] }]),
    stderr: '',
  })
}

describe('golden-row-count contract', () => {
  it('returns the five exact count fields with numeric values', async () => {
    const root = emptyDbStateRoot()
    try {
      const result = await countGoldenRows({
        persistTo: root,
        spawn: zeroRowSpawn(),
      })
      expect(Object.keys(result).sort()).toEqual([
        'confirmations',
        'contributors',
        'drafts',
        'messages',
        'submissions',
      ])
      for (const value of Object.values(result)) {
        expect(typeof value).toBe('number')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('resolves the state root by CLI --persist-to first, then WRANGLER_STATE_PATH, then the repo default', () => {
    const cliRoot = join(tmpdir(), 's3a-cli')
    const envRoot = join(tmpdir(), 's3a-env')
    const repoRoot = join(tmpdir(), 's3a-repo')
    expect(
      resolveStateRoot({
        persistTo: cliRoot,
        env: { WRANGLER_STATE_PATH: envRoot },
        root: repoRoot,
      }),
    ).toBe(cliRoot)
    expect(
      resolveStateRoot({
        persistTo: undefined,
        env: { WRANGLER_STATE_PATH: envRoot },
        root: repoRoot,
      }),
    ).toBe(envRoot)
    expect(resolveStateRoot({ persistTo: undefined, env: {}, root: repoRoot })).toBe(
      join(repoRoot, '.wrangler', 'state'),
    )
  })

  it('resolves the single non-metadata sqlite for the configured binding and fails closed on missing or multiple candidates', () => {
    const single = emptyDbStateRoot()
    try {
      const db = resolveDatabaseFile(single)
      expect(db).toContain('0123456789abcdef0123456789abcdef.sqlite')
    } finally {
      rmSync(single, { recursive: true, force: true })
    }

    const missing = join(tmpdir(), 's3a-missing', 'v3', 'd1', 'miniflare-D1DatabaseObject')
    expect(() => resolveDatabaseFile(missing)).toThrow()

    const multiple = emptyDbStateRoot()
    try {
      writeFileSync(join(multiple, 'v3', 'd1', 'miniflare-D1DatabaseObject', 'second.sqlite'), 'x')
      expect(() => resolveDatabaseFile(multiple)).toThrow()
    } finally {
      rmSync(multiple, { recursive: true, force: true })
    }
  })

  it('invokes wrangler d1 execute --local --json for the single binding with a bounded command array', async () => {
    const root = emptyDbStateRoot()
    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = []
    try {
      await countGoldenRows({
        persistTo: root,
        spawn: (command: string, args: string[], options: Record<string, unknown>) => {
          calls.push({ command, args, options })
          return {
            status: 0,
            stdout: JSON.stringify([{ results: [{ 'COUNT(*)': 0 }] }]),
            stderr: '',
          }
        },
      })
      expect(calls).toHaveLength(5)
      for (const call of calls) {
        expect(call.command).toBe('pnpm')
        expect(call.args).toEqual([
          'exec',
          'wrangler',
          'd1',
          'execute',
          BINDING,
          '--local',
          '--json',
          '--persist-to',
          root,
          '--command',
          expect.any(String),
        ])
        expect(call.args[call.args.indexOf('--persist-to') + 1]).toBe(
          resolveStateRoot({ persistTo: root, env: {}, root: '/repo' }),
        )
        expect(typeof call.options.encoding).toBe('string')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns deterministic zeros for an existing empty seeded DB', async () => {
    const root = emptyDbStateRoot()
    try {
      const result = await countGoldenRows({
        persistTo: root,
        spawn: zeroRowSpawn(),
      })
      expect(result).toEqual({
        submissions: 0,
        contributors: 0,
        messages: 0,
        confirmations: 0,
        drafts: 0,
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('scopes every count query by the committed event/form relational keys, never global totals', async () => {
    const root = emptyDbStateRoot()
    const commands: string[] = []
    try {
      await countGoldenRows({
        persistTo: root,
        spawn: (_command: string, args: string[]) => {
          const sql = args[args.length - 1]
          if (sql === undefined) {
            throw new Error('wrangler command missing its SQL argument')
          }
          commands.push(sql)
          return {
            status: 0,
            stdout: JSON.stringify([{ results: [{ 'COUNT(*)': 0 }] }]),
            stderr: '',
          }
        },
      })
      expect(commands).toHaveLength(5)
      for (const sql of commands) {
        expect(sql).toContain('WHERE')
        expect(sql).toMatch(new RegExp(`${EVENT_SLUG}|${FORM_ID}`))
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('scopes the messages count to confirmation-linked messages for the fixed form', async () => {
    const root = emptyDbStateRoot()
    const commands: string[] = []
    try {
      await countGoldenRows({
        persistTo: root,
        spawn: (_command: string, args: string[]) => {
          const sql = args[args.length - 1]
          if (sql === undefined) {
            throw new Error('wrangler command missing its SQL argument')
          }
          commands.push(sql)
          return {
            status: 0,
            stdout: JSON.stringify([{ results: [{ 'COUNT(*)': 0 }] }]),
            stderr: '',
          }
        },
      })
      expect(commands).toHaveLength(5)
      const messagesSql = commands[2]
      expect(messagesSql).toContain('captured_messages')
      expect(messagesSql).toContain('confirmation_records')
      expect(messagesSql).toContain('captured_message_id')
      expect(messagesSql).toContain('form_id')
      expect(messagesSql).toContain(FORM_ID)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails closed on a missing database with no zero report', async () => {
    await expect(
      countGoldenRows({
        persistTo: join(tmpdir(), 's3a-absent'),
        spawn: zeroRowSpawn(),
      }),
    ).rejects.toThrow()
  })

  it('fails closed on a non-zero wrangler exit with no zero report', async () => {
    const root = emptyDbStateRoot()
    try {
      await expect(
        countGoldenRows({
          persistTo: root,
          spawn: () => ({ status: 1, stdout: '', stderr: 'boom' }),
        }),
      ).rejects.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails closed on malformed wrangler JSON output with no zero report', async () => {
    const root = emptyDbStateRoot()
    try {
      await expect(
        countGoldenRows({
          persistTo: root,
          spawn: () => ({ status: 0, stdout: 'not json', stderr: '' }),
        }),
      ).rejects.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails closed on a blank/schema-less database with no zero report', async () => {
    const root = mkdtempSync(join(tmpdir(), 's3a-blank'))
    const dbDir = join(root, 'v3', 'd1', 'miniflare-D1DatabaseObject')
    mkdirSync(dbDir, { recursive: true })
    writeFileSync(join(dbDir, 'blank.sqlite'), '')
    writeFileSync(join(dbDir, 'metadata.sqlite'), '{}')
    try {
      await expect(
        countGoldenRows({
          persistTo: root,
          spawn: () => ({ status: 1, stdout: '', stderr: 'no such table: proposal_submissions' }),
        }),
      ).rejects.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('exposes runWranglerCount as the bounded child-process parse seam', async () => {
    const db = join(tmpdir(), 's3a-run', 'db.sqlite')
    const call = await runWranglerCount(
      (command: string, args: string[]) => {
        expect(command).toBe('pnpm')
        expect(args).toContain(BINDING)
        expect(args).toContain('--json')
        return {
          status: 0,
          stdout: JSON.stringify([{ results: [{ 'COUNT(*)': 7 }] }]),
          stderr: '',
        }
      },
      BINDING,
      db,
      'SELECT COUNT(*) FROM proposal_submissions WHERE form_id = ?',
    )
    expect(call).toBe(7)
  })
})

// Lifecycle-tail persisted-row proofs (acceptance -> checklist -> completion ->
// headshot -> acceptance message). They are a SEPARATE callable rather than
// extra keys on countGoldenRows so the frozen five-count golden contract above
// keeps its exact shape; both share the same state-root resolution, the same
// fail-closed database validation, and the same bounded wrangler seam.
describe('golden-row-count lifecycle contract', () => {
  /** Recording spawn seam: captures the SQL of every wrangler invocation. */
  function recordingSpawn() {
    const commands: string[] = []
    const spawn = (_command: string, args: string[]) => {
      const sql = args[args.length - 1]
      if (sql === undefined) throw new Error('wrangler command missing its SQL argument')
      commands.push(sql)
      return { status: 0, stdout: JSON.stringify([{ results: [{ 'COUNT(*)': 0 }] }]), stderr: '' }
    }
    return { commands, spawn }
  }

  it('returns the five exact lifecycle count fields with numeric values', async () => {
    const root = emptyDbStateRoot()
    try {
      const result = await countLifecycleRows({ persistTo: root, spawn: zeroRowSpawn() })
      expect(Object.keys(result).sort()).toEqual([
        'acceptanceMessages',
        'acceptances',
        'completedTasks',
        'headshots',
        'speakerTasks',
      ])
      for (const value of Object.values(result)) {
        expect(typeof value).toBe('number')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves the frozen golden five-count contract untouched', async () => {
    const root = emptyDbStateRoot()
    try {
      const golden = await countGoldenRows({ persistTo: root, spawn: zeroRowSpawn() })
      expect(golden).toEqual({
        submissions: 0,
        contributors: 0,
        messages: 0,
        confirmations: 0,
        drafts: 0,
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns deterministic zeros for an existing empty seeded DB', async () => {
    const root = emptyDbStateRoot()
    try {
      const result = await countLifecycleRows({ persistTo: root, spawn: zeroRowSpawn() })
      expect(result).toEqual({
        acceptances: 0,
        speakerTasks: 0,
        completedTasks: 0,
        headshots: 0,
        acceptanceMessages: 0,
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('scopes every lifecycle count by the committed event/form relational keys', async () => {
    const root = emptyDbStateRoot()
    const probe = recordingSpawn()
    try {
      await countLifecycleRows({ persistTo: root, spawn: probe.spawn })
      expect(probe.commands).toHaveLength(5)
      for (const sql of probe.commands) {
        expect(sql).toContain('WHERE')
        expect(sql).toMatch(new RegExp(`${EVENT_SLUG}|${FORM_ID}`))
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('pins each lifecycle count to its own table and narrowing predicate', async () => {
    const root = emptyDbStateRoot()
    const probe = recordingSpawn()
    try {
      await countLifecycleRows({ persistTo: root, spawn: probe.spawn })
      const [acceptances, speakerTasks, completedTasks, headshots, acceptanceMessages] =
        probe.commands
      expect(acceptances).toContain('submission_acceptances')
      expect(speakerTasks).toContain('speaker_tasks')
      // The completed count must narrow by status, otherwise "blockers dropped"
      // would be indistinguishable from "checklist created".
      expect(completedTasks).toContain('speaker_tasks')
      expect(completedTasks).toContain("status = 'completed'")
      expect(headshots).toContain('uploaded_files')
      expect(headshots).toContain("kind = 'headshot'")
      // Acceptance messages are the submission-linked captured rows only;
      // start-link and submit-confirmation rows keep a NULL submission_id.
      expect(acceptanceMessages).toContain('captured_messages')
      expect(acceptanceMessages).toContain('submission_id')
      expect(acceptanceMessages).toContain(FORM_ID)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('drives the same bounded wrangler seam for the single committed binding', async () => {
    const root = emptyDbStateRoot()
    const calls: Array<{ command: string; args: string[] }> = []
    try {
      await countLifecycleRows({
        persistTo: root,
        spawn: (command: string, args: string[]) => {
          calls.push({ command, args })
          return {
            status: 0,
            stdout: JSON.stringify([{ results: [{ 'COUNT(*)': 0 }] }]),
            stderr: '',
          }
        },
      })
      expect(calls).toHaveLength(5)
      for (const call of calls) {
        expect(call.command).toBe('pnpm')
        expect(call.args.slice(0, 6)).toEqual([
          'exec',
          'wrangler',
          'd1',
          'execute',
          BINDING,
          '--local',
        ])
        expect(call.args).toContain('--json')
        expect(call.args[call.args.indexOf('--persist-to') + 1]).toBe(root)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('selects the lifecycle counter only for an explicit --counts lifecycle argv', () => {
    expect(selectCounter(['node', 'golden-row-count.mjs', '--counts', 'lifecycle'])).toBe(
      countLifecycleRows,
    )
    expect(selectCounter(['node', 'golden-row-count.mjs'])).toBe(countGoldenRows)
    expect(selectCounter(['node', 'golden-row-count.mjs', '--counts', 'golden'])).toBe(
      countGoldenRows,
    )
    // A bare flag, or an unknown set, must never silently pick lifecycle.
    expect(selectCounter(['node', 'golden-row-count.mjs', '--counts'])).toBe(countGoldenRows)
    expect(selectCounter(['node', 'golden-row-count.mjs', '--counts', 'nonsense'])).toBe(
      countGoldenRows,
    )
    expect(selectCounter(['node', 'golden-row-count.mjs', 'lifecycle'])).toBe(countGoldenRows)
  })

  it('fails closed on a missing database and on a non-zero wrangler exit', async () => {
    await expect(
      countLifecycleRows({
        persistTo: join(tmpdir(), 's3a-lifecycle-absent'),
        spawn: zeroRowSpawn(),
      }),
    ).rejects.toThrow()

    const root = emptyDbStateRoot()
    try {
      await expect(
        countLifecycleRows({
          persistTo: root,
          spawn: () => ({ status: 1, stdout: '', stderr: 'boom' }),
        }),
      ).rejects.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
