import { useEffect, useMemo, useState } from 'react'

import {
  nextSpotlightId,
  parseSpotlightSearch,
  shouldIgnoreSpotlightKey,
  writeSpotlightSearch,
} from './programme-spotlight'

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

  // React permits adjusting state during render when a changed input makes
  // the stored selection invalid. This keeps the actual state normalized
  // without adding a synchronization effect and its extra committed render.
  if (spotlightId !== resolvedSpotlightId) setSpotlightId(resolvedSpotlightId)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const next = writeSpotlightSearch(window.location.search, resolvedSpotlightId)
    if (next === window.location.search) return
    const url = `${window.location.pathname}${next}${window.location.hash}`
    window.history.replaceState(window.history.state, '', url)
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
