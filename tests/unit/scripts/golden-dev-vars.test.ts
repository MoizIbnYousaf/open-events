import { describe, expect, it } from 'vitest'

// @ts-expect-error — scripts/golden-dev-vars.mjs is plain ESM (narrow documented boundary).
import * as goldenDevVarsModule from '../../../scripts/golden-dev-vars.mjs'

const { DEV_VARS_SENTINEL, devVarsContent, ownsDevVars } = goldenDevVarsModule

describe('golden-dev-vars ownership and content helpers', () => {
  it('ownsDevVars is exact-sentinel aware (no prefix collisions)', () => {
    expect(ownsDevVars(`${DEV_VARS_SENTINEL}\nLOCAL_ADMIN_TOKEN=x`)).toBe(true)
    expect(ownsDevVars(DEV_VARS_SENTINEL)).toBe(true)
    // Prefix collision: a longer marker must not be owned.
    expect(ownsDevVars(`${DEV_VARS_SENTINEL}-other\nLOCAL_ADMIN_TOKEN=x`)).toBe(false)
    expect(ownsDevVars('LOCAL_ADMIN_TOKEN=x')).toBe(false)
    expect(ownsDevVars('')).toBe(false)
  })

  it('devVarsContent emits the exact sentinel line and all local vars', () => {
    const content = devVarsContent('s3b-local-test')
    expect(content.startsWith(`${DEV_VARS_SENTINEL}\n`)).toBe(true)
    expect(content).toContain('LOCAL_ADMIN_TOKEN=s3b-local-test')
    expect(content).toContain('LOCAL_DEV_MODE=true')
    expect(content).toContain('ALLOWED_ORIGINS=http://localhost:4173')
  })

  it('devVarsContent rejects a missing token and CR/LF injection', () => {
    expect(() => devVarsContent(undefined)).toThrow('LOCAL_ADMIN_TOKEN is required')
    expect(() => devVarsContent('')).toThrow('LOCAL_ADMIN_TOKEN is required')
    expect(() => devVarsContent('bad\ntoken')).toThrow('must not contain CR or LF')
    expect(() => devVarsContent('bad\rtoken')).toThrow('must not contain CR or LF')
  })
})
