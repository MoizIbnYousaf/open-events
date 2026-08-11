/**
 * The one absolute-instant formatter the organizer surfaces share.
 *
 * A machine timestamp is not something a person reads: an ISO-8601 string with
 * a `T`, a fractional second and a `Z` is the wire's version of the truth, and
 * the send history was printing it verbatim beside the subject line an
 * organizer had just mailed.
 *
 * The formatted form is deliberately ABSOLUTE and never relative. This product
 * is read from a seeded dataset — every row of an acceptance history would say
 * "less than a minute ago" — and a relative string also throws the exact
 * instant away, which is the one thing a send history exists to keep. Callers
 * keep the ISO value on the element's `dateTime` attribute, so the machine
 * truth stays recoverable beside the human one.
 *
 * UTC, said once: three surfaces rendering the same instant in three
 * viewer-local zones would contradict each other on one screen.
 *
 * PLACEMENT, and it is load-bearing twice over.
 *
 * Reachable from `main.tsx`, `__root` or `AppShell`, this module would join the
 * eager closure, which is metered against a budget, instead of a route chunk
 * with kilobytes to spare.
 *
 * And its importers must all live in ONE route chunk — today the submission
 * detail's, which is where `SubmissionDetail` and the `CommunicationsPanel` it
 * renders both sit. A module imported from two lazy chunks is emitted as a
 * third chunk of its own, whose filename then has to be listed in the entry's
 * preload map: measured, that costs entry bytes from a budget with tens of
 * them left, to save ten lines. The submissions list therefore keeps its own
 * copy of this formatter rather than importing this one, and the two are kept
 * in step by hand.
 */
const instantFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

/**
 * A value the runtime cannot read as a date is returned unchanged rather than
 * rendered as "Invalid Date": the raw instant is at least still the truth.
 */
export function formatInstant(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : instantFormatter.format(date)
}
