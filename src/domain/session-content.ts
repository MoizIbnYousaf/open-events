/**
 * Last-approved session copy stays on the public programme while a speaker
 * (or organizer) edit sits in draft. The live row may already hold the
 * pending title; public surfaces must not leak it until approval.
 */

export interface ApprovedSessionCopy {
  readonly title: string
  readonly abstract: string
}

export interface PublicSessionCopy {
  readonly visible: boolean
  readonly title: string
  readonly abstract: string
}

export function publicSessionCopy(input: {
  readonly contentStatus: string
  readonly liveTitle: string
  readonly liveAbstract: string
  readonly lastApproved: ApprovedSessionCopy | null
}): PublicSessionCopy {
  if (input.contentStatus === 'approved') {
    return { visible: true, title: input.liveTitle, abstract: input.liveAbstract }
  }
  if (input.lastApproved !== null) {
    return {
      visible: true,
      title: input.lastApproved.title,
      abstract: input.lastApproved.abstract,
    }
  }
  return { visible: false, title: '', abstract: '' }
}

export function sessionHasApprovedSnapshot(
  contentStatus: string,
  lastApproved: ApprovedSessionCopy | null,
): boolean {
  return publicSessionCopy({
    contentStatus,
    liveTitle: '',
    liveAbstract: '',
    lastApproved,
  }).visible
}

/** Snapshot the live row only when leaving an approved state. A second draft edit must not overwrite that copy. */
export function shouldSnapshotApprovedCopy(status: string): boolean {
  return status !== 'draft'
}

export function latestApprovedSnapshot(
  revisions: readonly ApprovedSessionCopy[],
): ApprovedSessionCopy | null {
  const last = revisions.at(-1)
  return last === undefined ? null : { title: last.title, abstract: last.abstract }
}
