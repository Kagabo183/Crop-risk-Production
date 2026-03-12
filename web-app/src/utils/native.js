/**
 * Web-app native utilities — browser APIs only (no Capacitor).
 */

export const isNative = false

// ── GPS ──

/**
 * Get current position (one-shot).
 * Returns { latitude, longitude, accuracy }
 */
export async function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('GPS is not supported by your browser'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => {
        if (err.code === 1) reject(new Error('Location access denied. Please allow GPS.'))
        else if (err.code === 2) reject(new Error('GPS unavailable. Make sure location services are ON.'))
        else reject(new Error('GPS timed out. Try again.'))
      },
      { enableHighAccuracy: true, timeout: 15000, ...options }
    )
  })
}

/**
 * Watch position continuously.
 * Returns an object with a clear() method.
 */
export function watchPosition(onPosition, onError, options = {}) {
  if (!navigator.geolocation) {
    onError?.(new Error('GPS is not supported'))
    return { clear: () => {} }
  }

  const watchId = navigator.geolocation.watchPosition(
    (pos) => onPosition({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    }),
    (err) => {
      if (err.code === 1) onError?.(new Error('Location access denied.'))
      else if (err.code === 2) onError?.(new Error('GPS unavailable.'))
      else onError?.(new Error('GPS timed out.'))
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000, ...options }
  )

  return { clear: () => navigator.geolocation.clearWatch(watchId) }
}

// ── Camera / File picker ──

/**
 * Open file picker for image selection.
 * Returns a File object ready for FormData upload.
 */
export async function pickPhoto(source = 'prompt') {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    if (source === 'camera') input.capture = 'environment'
    input.onchange = () => {
      if (input.files?.length) resolve(input.files[0])
      else reject(new Error('No file selected'))
    }
    input.click()
  })
}
