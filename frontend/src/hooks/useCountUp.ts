import { useEffect, useRef, useState } from 'react'

/**
 * Animate a number from its previous value up to `target` once, whenever
 * `target` changes. Used for the dashboard KPI figures — a short, controlled
 * count-up (₹0 → ₹2.84 Cr feel), never a flashy ticker.
 *
 * Design constraints honoured:
 *  - Respects `prefers-reduced-motion`: reduced-motion users get the final
 *    value immediately (no tween, no rAF).
 *  - Runs a SINGLE rAF tween per target change and cancels it on unmount /
 *    re-trigger — no persistent animation loop.
 *  - Duration is short and clamped; large deltas don't run longer.
 *
 * Returns the current (possibly mid-tween) value; the caller formats it
 * (toLocaleString etc.) exactly as before — this only changes the number, not
 * any data, formatting or business logic.
 */
export function useCountUp(target: number, durationMs = 750): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    // SSR / test guards and reduced-motion: jump straight to the final value.
    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (
      prefersReduced ||
      typeof requestAnimationFrame === 'undefined' ||
      !Number.isFinite(target) ||
      target === fromRef.current
    ) {
      fromRef.current = target
      setValue(target)
      return
    }

    const from = fromRef.current
    const delta = target - from
    const start = performance.now()
    // easeOutCubic — quick start, gentle settle.
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)

    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs)
      setValue(from + delta * ease(p))
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
        setValue(target)
        rafRef.current = null
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      // Remember where we were so an interrupted tween continues smoothly.
      fromRef.current = target
    }
  }, [target, durationMs])

  return value
}
