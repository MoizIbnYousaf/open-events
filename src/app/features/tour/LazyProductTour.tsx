import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react'
import { hasPendingTourToggle, TOUR_TOGGLE_EVENT } from './tour-events'

const ProductTour = lazy(() =>
  import('./ProductTour').then((module) => ({ default: module.ProductTour })),
)

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
