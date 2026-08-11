/**
 * One published bit: "the product tour is narrating right now".
 *
 * It lives on the document element rather than in React state because its only
 * consumer is a surface the tour navigates *into* — a route component in a
 * different subtree, mounted after the tour opened, which must decide during
 * its own first effect whether it may take focus. A context would have to reach
 * across the router boundary and would still be a frame late; an attribute is
 * readable synchronously by anyone, in any tree, and it is the same additive
 * door the tour already uses for its toggle event.
 *
 * It is a UI-activity flag, never an authorization or session signal.
 */
export const TOUR_ACTIVE_ATTRIBUTE = 'data-tour-active'

export function setTourActive(active: boolean): void {
  const root = document.documentElement
  if (active) root.setAttribute(TOUR_ACTIVE_ATTRIBUTE, 'true')
  else root.removeAttribute(TOUR_ACTIVE_ATTRIBUTE)
}

export function isTourActive(): boolean {
  return document.documentElement.hasAttribute(TOUR_ACTIVE_ATTRIBUTE)
}
