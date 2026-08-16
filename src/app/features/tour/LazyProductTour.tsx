import { lazy, Suspense, type ReactElement } from 'react'

const ProductTour = lazy(() =>
  import('./ProductTour').then((module) => ({ default: module.ProductTour })),
)

interface LazyProductTourProps {
  readonly onNavigate: (route: string, params?: Readonly<Record<string, string>>) => void
}

/** Keeps the full tour overlay and narration out of the first-paint bundle. */
export default function LazyProductTour({ onNavigate }: LazyProductTourProps): ReactElement {
  return (
    <Suspense fallback={null}>
      <ProductTour onNavigate={onNavigate} />
    </Suspense>
  )
}
