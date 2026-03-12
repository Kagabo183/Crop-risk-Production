/**
 * Client-side image compression utility.
 *
 * Why this matters for African farmers:
 *   - A standard Android phone photo is 3–8 MB
 *   - A compressed version suitable for EfficientNet-B0 is ~150–350 KB
 *   - That is a 10–20× reduction in mobile data used per scan
 *   - On a 100 MB/month data plan, this is the difference between
 *     10 scans and 200 scans
 *
 * Implementation uses the Canvas API (no dependencies, works in any browser
 * and in Capacitor WebView on Android/iOS).
 */

/** Default compression settings — calibrated for disease classification. */
const DEFAULTS = {
  maxWidth: 800,          // EfficientNet input is 224px; 800px is generous headroom
  maxHeight: 800,
  quality: 0.82,          // JPEG quality — high enough for leaf texture detail
  maxSizeKB: 400,         // Target ceiling; stop compressing once under this
  outputFormat: 'image/jpeg',
}

/**
 * Compress an image File or Blob before uploading.
 *
 * Automatically skips compression when the file is already under maxSizeKB.
 * Preserves aspect ratio. Returns a File object with the same interface
 * as the original so it is a drop-in replacement anywhere a File is expected.
 *
 * @param {File|Blob} file    - Original image from <input type="file"> or camera
 * @param {object}    options - Optional overrides for DEFAULTS
 * @returns {Promise<File>}   - Compressed File (or original if already small)
 */
export async function compressImage(file, options = {}) {
  const opts = { ...DEFAULTS, ...options }

  // Already small enough — skip the canvas round-trip
  if (file.size <= opts.maxSizeKB * 1024) {
    return file
  }

  return new Promise((resolve) => {
    const reader = new FileReader()

    reader.onload = (readerEvent) => {
      const img = new Image()

      img.onload = () => {
        // Calculate new dimensions preserving aspect ratio
        let { width, height } = img

        if (width > opts.maxWidth || height > opts.maxHeight) {
          const ratio = Math.min(opts.maxWidth / width, opts.maxHeight / height)
          width = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }

        // Draw onto canvas
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        // White background prevents transparent PNG → black JPEG artefact
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)

        // Encode as JPEG
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              // Canvas encode failed — return original unchanged
              resolve(file)
              return
            }
            // Wrap blob as File to keep the filename and MIME type clean
            const originalName = file.name || 'image.jpg'
            const compressed = new File(
              [blob],
              originalName.replace(/\.[^/.]+$/, '.jpg'),
              { type: 'image/jpeg', lastModified: Date.now() }
            )
            resolve(compressed)
          },
          opts.outputFormat,
          opts.quality
        )
      }

      img.onerror = () => resolve(file)       // Decode failed — use original
      img.src = readerEvent.target.result
    }

    reader.onerror = () => resolve(file)      // Read failed — use original
    reader.readAsDataURL(file)
  })
}

/**
 * Format a byte count as a human-readable string.
 * @param {number} bytes
 * @returns {string}  e.g. "1.4 MB" or "320 KB"
 */
export function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/**
 * Get a compression summary string for display in the UI.
 * e.g.  "Compressed: 4.2 MB → 310 KB (saved 93%)"
 *
 * @param {number} originalBytes
 * @param {number} compressedBytes
 * @returns {string}
 */
export function compressionSummary(originalBytes, compressedBytes) {
  if (!originalBytes || !compressedBytes) return ''
  const saved = Math.round((1 - compressedBytes / originalBytes) * 100)
  return `${formatFileSize(originalBytes)} → ${formatFileSize(compressedBytes)} (saved ${saved}%)`
}
