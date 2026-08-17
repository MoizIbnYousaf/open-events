const VIEWPORT_MARGIN = 8
const TARGET_GAP = 12

export interface TourTargetRect {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

export interface TourBoxSize {
  readonly width: number
  readonly height: number
}

export interface TourViewportSize {
  readonly width: number
  readonly height: number
}

export interface TourPlacement {
  readonly mode: 'top' | 'bottom' | 'left' | 'right' | 'center' | 'dock'
  readonly top: number
  readonly left: number
  readonly width: number
  readonly maxHeight?: number
}

export function computeTourPlacement(
  rect: TourTargetRect | null,
  popover: TourBoxSize,
  viewport: TourViewportSize,
): TourPlacement {
  const width = Math.min(popover.width, Math.max(0, viewport.width - VIEWPORT_MARGIN * 2))
  if (rect === null) {
    const maxHeight = Math.max(0, viewport.height - VIEWPORT_MARGIN * 2)
    return {
      mode: 'center',
      top: Math.max(VIEWPORT_MARGIN, (viewport.height - Math.min(popover.height, maxHeight)) / 2),
      left: Math.max(VIEWPORT_MARGIN, (viewport.width - width) / 2),
      width,
      ...(popover.height > maxHeight ? { maxHeight } : {}),
    }
  }
  if (viewport.width < 480 || viewport.height < 520) {
    const maxHeight = Math.max(0, viewport.height - VIEWPORT_MARGIN * 2)
    return {
      mode: 'dock',
      top: Math.max(
        VIEWPORT_MARGIN,
        viewport.height - Math.min(popover.height, maxHeight) - VIEWPORT_MARGIN,
      ),
      left: VIEWPORT_MARGIN,
      width,
      maxHeight,
    }
  }
  const candidates: readonly TourPlacement[] = [
    { mode: 'bottom', top: rect.top + rect.height + TARGET_GAP, left: rect.left, width },
    { mode: 'top', top: rect.top - popover.height - TARGET_GAP, left: rect.left, width },
    { mode: 'right', top: rect.top, left: rect.left + rect.width + TARGET_GAP, width },
    { mode: 'left', top: rect.top, left: rect.left - width - TARGET_GAP, width },
  ]
  const fitting = candidates.find(
    (candidate) =>
      candidate.top >= VIEWPORT_MARGIN &&
      candidate.left >= VIEWPORT_MARGIN &&
      candidate.top + popover.height <= viewport.height - VIEWPORT_MARGIN &&
      candidate.left + width <= viewport.width - VIEWPORT_MARGIN,
  )
  if (fitting !== undefined) return fitting
  return {
    mode: 'center',
    top: Math.max(VIEWPORT_MARGIN, (viewport.height - popover.height) / 2),
    left: Math.max(VIEWPORT_MARGIN, (viewport.width - width) / 2),
    width,
    maxHeight: Math.max(0, viewport.height - VIEWPORT_MARGIN * 2),
  }
}
