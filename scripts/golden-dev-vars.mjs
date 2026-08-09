/** Ownership sentinel for the wrapper-generated .dev.vars (exact first line). */
export const DEV_VARS_SENTINEL = '# golden-dev-server-owned'

/** True only when content begins with the exact sentinel line (no prefix collision). */
export function ownsDevVars(content) {
  return content === DEV_VARS_SENTINEL || content.startsWith(`${DEV_VARS_SENTINEL}\n`)
}

/** Emits the sentinel, the admin token, and the local dev vars; rejects CR/LF. */
export function devVarsContent(token) {
  if (token === undefined || token.length === 0) {
    throw new Error('LOCAL_ADMIN_TOKEN is required')
  }
  if (/[\r\n]/.test(token)) {
    throw new Error('LOCAL_ADMIN_TOKEN must not contain CR or LF')
  }
  return `${DEV_VARS_SENTINEL}\nLOCAL_ADMIN_TOKEN=${token}\nLOCAL_DEV_MODE=true\nALLOWED_ORIGINS=http://localhost:4173\n`
}
