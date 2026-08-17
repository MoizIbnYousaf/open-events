import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react'
import { hasPendingTourToggle, TOUR_TOGGLE_EVENT } from './tour-events'

const TOUR_CHUNK_RELOAD_KEY = 'open-events:tour-chunk-reload'

const ProductTour = lazy(async () => {
  try {
    const module = await import('./ProductTour')
    try {
      window.sessionStorage.removeItem(TOUR_CHUNK_RELOAD_KEY)
    } catch {
      // Storage can be denied; a successful import needs no recovery marker.
    }
    return { default: module.ProductTour }
  } catch (error) {
    let alreadyRetried = false
    try {
      alreadyRetried = window.sessionStorage.getItem(TOUR_CHUNK_RELOAD_KEY) === 'true'
      if (!alreadyRetried) window.sessionStorage.setItem(TOUR_CHUNK_RELOAD_KEY, 'true')
    } catch {
      // A storage-denied browser still gets one best-effort refresh.
    }
    if (!alreadyRetried) {
      window.location.reload()
      return new Promise<never>(() => undefined)
    }
    throw error
  }
})

interface LazyProductTourProps {
  readonly onNavigate: (route: string, params?: Readonly<Record<string, string>>) => void
  readonly onResume?: () => void
  readonly onAccessExit?: () => void
}

function hasInitialTourIntent(): boolean {
  if (hasPendingTourToggle()) return true
  try {
    return (
      new URLSearchParams(window.location.search).get('tour') === '1' ||
      window.sessionStorage.getItem('open-events:tour-active') === 'true'
    )
  } catch {
    return false
  }
}

/** Keeps the full tour overlay and narration out of the first-paint bundle. */
export default function LazyProductTour({
  onNavigate,
  onResume,
  onAccessExit,
}: LazyProductTourProps): ReactElement {
  const [mounted, setMounted] = useState(hasInitialTourIntent)
  useEffect(() => {
    const mount = () => setMounted(true)
    window.addEventListener(TOUR_TOGGLE_EVENT, mount)
    return () => window.removeEventListener(TOUR_TOGGLE_EVENT, mount)
  }, [])
  if (!mounted) return <></>
  return (
    <Suspense fallback={null}>
      <ProductTour onNavigate={onNavigate} onResume={onResume} onAccessExit={onAccessExit} />
    </Suspense>
  )
}
