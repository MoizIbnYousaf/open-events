/** True when a keyboard event belongs to a native or content-editable field. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const editable = target.closest('[contenteditable]')?.getAttribute('contenteditable')
  if (editable !== null && editable !== undefined && editable !== 'false') return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
