import { useEffect, useMemo, useState } from 'react'

import {
  nextSpotlightId,
  parseSpotlightSearch,
  shouldIgnoreSpotlightKey,
  writeSpotlightSearch,
} from './programme-spotlight'

function useOrderedSpotlightIds(ids: readonly string[]): readonly string[] {
  const idKey = ids.join('\0')
  return useMemo(() => idKey.split('\0').filter((id) => id.length > 0), [idKey])
}

function useSpotlightKeyboard(
  orderedIds: readonly string[],
  spotlightId: string | null,
  onSelect: (id: string | null) => void,
): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreSpotlightKey(event.target)) return
      if (event.key !== 'j' && event.key !== 'k') return
      event.preventDefault()
      onSelect(nextSpotlightId(orderedIds, spotlightId, event.key === 'j' ? 1 : -1))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onSelect, orderedIds, spotlightId])
}

export function useControlledProgrammeSpotlight(
  ids: readonly string[],
  requestedId: string | undefined,
  onSelect: (id: string | null) => void,
): {
  readonly spotlightId: string | null
  readonly select: (id: string | null) => void
} {
  const orderedIds = useOrderedSpotlightIds(ids)
  const resolvedSpotlightId =
    requestedId !== undefined && orderedIds.includes(requestedId)
      ? requestedId
      : (orderedIds[0] ?? null)

  useEffect(() => {
    if ((requestedId ?? null) !== resolvedSpotlightId) onSelect(resolvedSpotlightId)
  }, [onSelect, requestedId, resolvedSpotlightId])

  useSpotlightKeyboard(orderedIds, resolvedSpotlightId, onSelect)

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
  const orderedIds = useOrderedSpotlightIds(ids)
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

  useSpotlightKeyboard(orderedIds, resolvedSpotlightId, setSpotlightId)

  return { spotlightId: resolvedSpotlightId, select: setSpotlightId }
}
