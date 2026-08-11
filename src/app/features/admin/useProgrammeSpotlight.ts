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

  useEffect(() => {
    if (spotlightId !== null && !orderedIds.includes(spotlightId) && orderedIds[0] !== undefined) {
      setSpotlightId(orderedIds[0])
    }
  }, [orderedIds, spotlightId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const next = writeSpotlightSearch(window.location.search, spotlightId)
    if (next === window.location.search) return
    const url = `${window.location.pathname}${next}${window.location.hash}`
    window.history.replaceState(window.history.state, '', url)
  }, [spotlightId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreSpotlightKey(event.target)) return
      if (event.key !== 'j' && event.key !== 'k') return
      event.preventDefault()
      setSpotlightId((current) =>
        nextSpotlightId(orderedIds, current, event.key === 'j' ? 1 : -1),
      )
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [orderedIds])

  return { spotlightId, select: setSpotlightId }
}
