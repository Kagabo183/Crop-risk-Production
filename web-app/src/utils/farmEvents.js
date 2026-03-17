/**
 * Lightweight cross-page event bus for farm data updates.
 *
 * When any page triggers a satellite scan or risk analysis, it calls
 * `emitFarmDataUpdated()`. Every other mounted page that called
 * `useFarmDataListener(callback)` will re-fetch its data automatically.
 */
import { useEffect } from 'react'

const EVENT_NAME = 'farm-data-updated'

/** Fire after a scan / risk analysis / any data mutation */
export function emitFarmDataUpdated(farmId) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { farmId, ts: Date.now() } }))
}

/** React hook — calls `callback` whenever any page emits the event */
export function useFarmDataListener(callback) {
  useEffect(() => {
    const handler = (e) => callback(e.detail)
    window.addEventListener(EVENT_NAME, handler)
    return () => window.removeEventListener(EVENT_NAME, handler)
  }, [callback])
}
