// Date helpers for the calendar. Dates are handled as local 'YYYY-MM-DD'
// strings so they match the Postgres `date` columns without timezone drift.

export const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const SHORT_MONTHS_ES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
]

// Monday-first weekday headers: Lunes…Domingo.
export const WEEKDAYS_ES = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

const pad = (n) => String(n).padStart(2, '0')

export function toISODate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function getOccupiedDays(startISO, endISO) {
  const start = new Date(startISO + 'T00:00:00')
  const end = new Date(endISO + 'T00:00:00')

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return []
  }

  const days = []
  let cursor = new Date(start)
  while (cursor <= end) {
    days.push(toISODate(cursor))
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
  }
  return days
}

export function hasConflict(startISO, endISO, reservations) {
  const start = new Date(startISO + 'T00:00:00')
  const end = new Date(endISO + 'T00:00:00')

  return reservations.some((reservation) => {
    const resStart = new Date(reservation.start_date + 'T00:00:00')
    const resEnd = new Date(reservation.end_date + 'T00:00:00')

    if (resEnd < start || resStart > end) return false

    const overlapStart = new Date(Math.max(start.getTime(), resStart.getTime()))
    const overlapEnd = new Date(Math.min(end.getTime(), resEnd.getTime()))
    const overlapDays = Math.round((overlapEnd - overlapStart) / 86400000) + 1
    return overlapDays > 1
  })
}

export function monthLabel(year, month) {
  return `${MONTHS_ES[month]} ${year}`
}

export function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

// Number of empty leading cells before day 1, with Monday as column 0.
export function leadingOffset(year, month) {
  const firstDay = new Date(year, month, 1).getDay() // Sun=0..Sat=6
  return (firstDay + 6) % 7
}

// "12 Jun → 16 Jun", or "12 Jun" for a single-day reservation.
export function formatRangeES(startISO, endISO) {
  const fmt = (iso) => {
    const [, m, d] = iso.split('-').map(Number)
    return `${d} ${SHORT_MONTHS_ES[m - 1]}`
  }
  return startISO === endISO ? fmt(startISO) : `${fmt(startISO)} → ${fmt(endISO)}`
}
