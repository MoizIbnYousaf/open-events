import { useEffect, useMemo, useState } from 'react'

import {
  nextSpotlightId,
  parseSpotlightSearch,
  shouldIgnoreSpotlightKey,
  writeSpotlightSearch,
} from './programme-spotlight'

export function useControlledProgrammeSpotlight(
  ids: readonly string[],
  requestedId: string | undefined,
  onSelect: (id: string | null) => void,
): {
  readonly spotlightId: string | null
  readonly select: (id: string | null) => void
} {
  const idKey = ids.join('\0')
  const orderedIds = useMemo(() => idKey.split('\0').filter((id) => id.length > 0), [idKey])
  const resolvedSpotlightId =
    requestedId !== undefined && orderedIds.includes(requestedId)
      ? requestedId
      : (orderedIds[0] ?? null)

  useEffect(() => {
    if ((requestedId ?? null) !== resolvedSpotlightId) onSelect(resolvedSpotlightId)
  }, [onSelect, requestedId, resolvedSpotlightId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreSpotlightKey(event.target)) return
      if (event.key !== 'j' && event.key !== 'k') return
      event.preventDefault()
      onSelect(nextSpotlightId(orderedIds, resolvedSpotlightId, event.key === 'j' ? 1 : -1))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onSelect, orderedIds, resolvedSpotlightId])

  return { spotlightId: resolvedSpotlightId, select: onSelect }
}

/** Legacy URL owner for organizer desks not yet routed through typed search state. */
export function useProgrammeSpotlight(ids: readonly string[]): {
  readonly spotlightId: string | null
  readonly select: (id: string | null) => void
} {
  const [spotlightId, setSpotlightId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : parseSpotlightSearch(window.location.search),
  )
  const idKey = ids.join('\0')
  const orderedIds = useMemo(() => idKey.split('\0').filter((id) => id.length > 0), [idKey])
  const resolvedSpotlightId =
    spotlightId !== null && orderedIds.includes(spotlightId) ? spotlightId : (orderedIds[0] ?? null)
  if (spotlightId !== resolvedSpotlightId) setSpotlightId(resolvedSpotlightId)

  useEffect(() => {
    const next = writeSpotlightSearch(window.location.search, resolvedSpotlightId)
    if (next === window.location.search) return
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${next}${window.location.hash}`,
    )
  }, [resolvedSpotlightId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreSpotlightKey(event.target)) return
      if (event.key !== 'j' && event.key !== 'k') return
      event.preventDefault()
      setSpotlightId(nextSpotlightId(orderedIds, resolvedSpotlightId, event.key === 'j' ? 1 : -1))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [orderedIds, resolvedSpotlightId])

  return { spotlightId: resolvedSpotlightId, select: setSpotlightId }
}
