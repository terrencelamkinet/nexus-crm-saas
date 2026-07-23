import { useRef, useCallback } from 'react'

type Lock = 'none' | 'x' | 'y'

interface AxisLockConfig {
  threshold?: number // px before lock engages (default 10)
}

/**
 * Axis lock for scrollable containers on mobile.
 * Once the user scrolls past `threshold` in one dominant axis,
 * locks that axis until touch ends.
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

    if (st.lock === 'none') {
      const dx = cx - st.startX
      const dy = cy - st.startY
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return
      st.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }

    if (st.lock === 'y') {
      el.scrollTop += cy - st.lastY
    }
    // When locked to x, we do nothing — native overflow-x handles it.
    // We just prevent default so the page doesn't also scroll y.

    st.lastX = cx
    st.lastY = cy

    if (st.lock === 'y') {
      e.preventDefault()
    }
  }, [threshold])

  return { ref, handlers: { onTouchStart, onTouchMove } }
}
