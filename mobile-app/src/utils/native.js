/**
 * Native platform utilities — wraps Capacitor plugins with web fallbacks.
 * On native (Android/iOS): uses Capacitor plugins for better accuracy + permissions.
 * On web: falls back to browser APIs.
 */
import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'

export const isNative = Capacitor.isNativePlatform()

// ── GPS ──

/**
 * Get current position (one-shot).
 * Returns { latitude, longitude, accuracy }
 */
export async function getCurrentPosition(options = {}) {
  if (isNative) {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 15000,
      ...options,
    })
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    }
  }

  // Web fallback
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
 * Returns a watchId that can be cleared with clearWatch().
 * Calls onPosition({ latitude, longitude, accuracy }) on each update.
 */
export function watchPosition(onPosition, onError, options = {}) {
  if (isNative) {
    let callbackId = null
    Geolocation.watchPosition(
      { enableHighAccuracy: true, ...options },
      (pos, err) => {
        if (err) {
          onError?.(new Error(err.message || 'GPS error'))
          return
        }
        if (pos) {
          onPosition({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          })
        }
      }
    ).then((id) => { callbackId = id })

    // Return an object with a clear method
    return { clear: () => callbackId && Geolocation.clearWatch({ id: callbackId }) }
  }

  // Web fallback
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

// ── Camera ──

/**
 * Take a photo or pick from gallery.
 * Returns a File object that can be used with FormData.
 */
export async function pickPhoto(source = 'prompt') {
  if (isNative) {
    const cameraSource = source === 'camera' ? CameraSource.Camera
      : source === 'gallery' ? CameraSource.Photos
      : CameraSource.Prompt

    const photo = await Camera.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: CameraResultType.Uri,
      source: cameraSource,
    })

    // Convert to File for FormData upload
    const response = await fetch(photo.webPath)
    const blob = await response.blob()
    return new File([blob], `photo_${Date.now()}.${photo.format || 'jpg'}`, {
      type: `image/${photo.format || 'jpeg'}`,
    })
  }

  // Web fallback — use file input
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.capture = source === 'camera' ? 'environment' : undefined
    input.onchange = () => {
      if (input.files?.length) resolve(input.files[0])
      else reject(new Error('No file selected'))
    }
    input.click()
  })
}
