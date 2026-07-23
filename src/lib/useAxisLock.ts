import { useRef, useCallback } from 'react'

type Lock = 'none' | 'x' | 'y'

interface AxisLockConfig {
  threshold?: number // px before lock engages (default 10)
}

/**
 * Axis lock for horizontally-scrollable containers on mobile.
 *
 * How it works:
 * - The container element has overflow-x:auto (handles horizontal scroll).
 * - Vertical scroll is handled by the PAGE / parent, NOT by this element.
 * - Axis lock prevents diagonal: dominant axis wins, other axis is suppressed.
 *
 * Locked to Y (vertical):  Let native page scroll through, do NOT preventDefault.
 * Locked to X (horizontal): preventDefault to stop page scroll, manually set scrollLeft.
 */
export function useAxisLock<T extends HTMLElement>(
  config: AxisLockConfig = {}
) {
  const { threshold = 10 } = config

  const s = useRef<{
    lock: Lock
    startX: number
    startY: number
    lastX: number
    lastY: number
  }>({ lock: 'none', startX: 0, startY: 0, lastX: 0, lastY: 0 })

  const ref = useRef<T>(null)

  const onTouchStart = useCallback((e: React.TouchEvent<T>) => {
    const t = e.touches[0]
    s.current = {
      lock: 'none',
      startX: t.clientX,
      startY: t.clientY,
      lastX: t.clientX,
      lastY: t.clientY,
    }
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent<T>) => {
    const el = ref.current
    if (!el) return

    const cx = e.touches[0].clientX
    const cy = e.touches[0].clientY
    const st = s.current

    const dx = cx - st.startX
    const dy = cy - st.startY

    // Determine lock axis if not yet locked
    if (st.lock === 'none') {
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return
      st.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }

    if (st.lock === 'x') {
      // Horizontal lock: manually scroll the container, prevent page scroll
      el.scrollLeft += cx - st.lastX
      e.preventDefault()
    }
    // Vertical lock: do nothing — let native page scroll handle it.
    // No preventDefault, no scrollTop manipulation.

    st.lastX = cx
    st.lastY = cy
  }, [threshold])

  return { ref, handlers: { onTouchStart, onTouchMove } }
}
