/**
 * Whether Send acceptance should stay disabled.
 *
 * A single acceptance row in history used to lock the button forever, even
 * when other audience members had not been sent. The preview's `alreadySent`
 * is true only once every recipient has a stored row.
 */
export function acceptanceSendComplete(
  preview: { readonly alreadySent?: boolean } | undefined,
): boolean {
  return preview?.alreadySent === true
}
