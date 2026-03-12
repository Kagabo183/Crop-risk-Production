/**
 * Formats a date string/object to "MM/DD/YYYY HH:MM am/pm"
 * If the input has no time component, only "MM/DD/YYYY" is returned.
 * Returns the original string if parsing fails.
 */
export function formatDate(dateStr) {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr // fallback to raw string

    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const yyyy = d.getFullYear()

    // If the original string looks like a date-only value (YYYY-MM-DD), skip time
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr).trim())
    if (dateOnly) return `${mm}/${dd}/${yyyy}`

    let hours = d.getHours()
    const minutes = String(d.getMinutes()).padStart(2, '0')
    const ampm = hours >= 12 ? 'pm' : 'am'
    hours = hours % 12 || 12

    return `${mm}/${dd}/${yyyy} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`
}
