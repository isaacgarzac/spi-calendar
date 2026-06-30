import { useCallback, useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured } from './supabaseClient'
import {
  listReservationsInRange,
  createReservation,
  deleteReservation,
  subscribeToReservations,
} from './services/reservations'
import {
  WEEKDAYS_ES,
  monthLabel,
  daysInMonth,
  leadingOffset,
  toISODate,
  formatRangeES,
} from './utils/dates'
import { colorForName } from './utils/colors'
import './App.css'

// Navigation bounds: from the current month up to December 2029.
const MAX_MONTH = { year: 2029, month: 11 } // Diciembre 2029
const today = new Date()
const MIN_MONTH = { year: today.getFullYear(), month: today.getMonth() }

// Compare two {year, month} objects: negative if a < b, etc.
function compareMonth(a, b) {
  return a.year - b.year || a.month - b.month
}

export default function App() {
  const [view, setView] = useState({ ...MIN_MONTH })
  const [reservations, setReservations] = useState([])
  const [selection, setSelection] = useState({ start: null, end: null })
  const [guestName, setGuestName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const { year, month } = view

  const monthStart = toISODate(new Date(year, month, 1))
  const monthEnd = toISODate(new Date(year, month, daysInMonth(year, month)))

  const loadMonth = useCallback(async () => {
    try {
      const data = await listReservationsInRange(monthStart, monthEnd)
      setReservations(data)
    } catch (err) {
      setError('No se pudieron cargar las reservas: ' + err.message)
    }
  }, [monthStart, monthEnd])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    loadMonth()
    const unsubscribe = subscribeToReservations(() => loadMonth())
    return unsubscribe
  }, [loadMonth])

  // Map every booked day in the visible month to its reservation, so cells
  // can render the guest name. The DB constraint guarantees at most one
  // reservation per day.
  const bookedByDay = useMemo(() => {
    const map = new Map()
    for (const res of reservations) {
      let d = new Date(res.start_date + 'T00:00:00')
      const end = new Date(res.end_date + 'T00:00:00')
      while (d <= end) {
        map.set(toISODate(d), res)
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
      }
    }
    return map
  }, [reservations])

  function rangeHasConflict(startISO, endISO) {
    return reservations.some(
      (r) => r.start_date <= endISO && r.end_date >= startISO,
    )
  }

  function isSelected(iso) {
    if (!selection.start) return false
    const end = selection.end || selection.start
    const lo = selection.start < end ? selection.start : end
    const hi = selection.start < end ? end : selection.start
    return iso >= lo && iso <= hi
  }

  function handleDayClick(iso) {
    if (bookedByDay.has(iso)) return // can't book over an existing reservation
    setError('')

    if (!selection.start || selection.end) {
      // Start a fresh selection.
      setSelection({ start: iso, end: null })
      return
    }

    // Second click: complete the range.
    let start = selection.start
    let end = iso
    if (end < start) [start, end] = [end, start]

    if (rangeHasConflict(start, end)) {
      setError('Esas fechas chocan con otra reserva 🚫')
      setSelection({ start: null, end: null })
      return
    }
    setSelection({ start, end })
  }

  function cancelSelection() {
    setSelection({ start: null, end: null })
    setGuestName('')
    setError('')
  }

  async function handleReservar() {
    const name = guestName.trim()
    if (!name) {
      setError('Escribe un nombre para la reserva.')
      return
    }
    const start = selection.start
    const end = selection.end || selection.start

    if (rangeHasConflict(start, end)) {
      setError('Esas fechas chocan con otra reserva 🚫')
      return
    }

    try {
      setSaving(true)
      await createReservation({
        guest_name: name,
        start_date: start,
        end_date: end,
        color: colorForName(name),
      })
      cancelSelection()
      await loadMonth()
    } catch (err) {
      setError(
        err.code === '23P01' || /overlap/i.test(err.message || '')
          ? 'Esas fechas chocan con otra reserva 🚫'
          : 'No se pudo guardar: ' + err.message,
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(res) {
    if (!window.confirm(`¿Borrar la reserva de ${res.guest_name}?`)) return
    try {
      await deleteReservation(res.id)
      await loadMonth()
    } catch (err) {
      setError('No se pudo borrar: ' + err.message)
    }
  }

  function changeMonth(delta) {
    cancelSelection()
    setView(({ year, month }) => {
      const d = new Date(year, month + delta, 1)
      const next = { year: d.getFullYear(), month: d.getMonth() }
      // Clamp to [MIN_MONTH, MAX_MONTH].
      if (compareMonth(next, MIN_MONTH) < 0) return MIN_MONTH
      if (compareMonth(next, MAX_MONTH) > 0) return MAX_MONTH
      return next
    })
  }

  const atMin = compareMonth(view, MIN_MONTH) <= 0
  const atMax = compareMonth(view, MAX_MONTH) >= 0

  if (!isSupabaseConfigured) {
    return <SetupNotice />
  }

  // Build grid cells: leading blanks + each day of the month.
  const cells = []
  const offset = leadingOffset(year, month)
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    cells.push(toISODate(new Date(year, month, day)))
  }

  const sortedReservations = [...reservations].sort((a, b) =>
    a.start_date.localeCompare(b.start_date),
  )

  return (
    <div className="app">
      <header className="app-header">
        <p className="app-eyebrow">CALENDARIO SPI</p>
        <h1 className="app-title">Los Corales 301 S 🦢</h1>
        <p className="app-subtitle">Reserva tus días — sin choques</p>
      </header>

      <main className="app-body">
        <div className="month-nav">
          <button
            className="nav-btn"
            onClick={() => changeMonth(-1)}
            disabled={atMin}
            aria-label="Mes anterior"
          >
            ‹
          </button>
          <span className="month-label">{monthLabel(year, month)}</span>
          <button
            className="nav-btn"
            onClick={() => changeMonth(1)}
            disabled={atMax}
            aria-label="Mes siguiente"
          >
            ›
          </button>
        </div>

        <div className="weekday-row">
          {WEEKDAYS_ES.map((d, i) => (
            <span key={i} className="weekday">{d}</span>
          ))}
        </div>

        <div className="day-grid">
          {cells.map((iso, i) => {
            if (!iso) return <div key={`blank-${i}`} className="day empty" />
            const res = bookedByDay.get(iso)
            const dayNum = Number(iso.split('-')[2])
            const classes = [
              'day',
              res ? 'booked' : '',
              isSelected(iso) ? 'selected' : '',
            ].filter(Boolean).join(' ')
            const bookedColor = res ? colorForName(res.guest_name) : undefined
            return (
              <button
                key={iso}
                className={classes}
                onClick={() => handleDayClick(iso)}
                style={bookedColor ? { background: bookedColor, borderColor: bookedColor } : undefined}
              >
                <span className="num">{dayNum}</span>
                {res && <span className="who">{res.guest_name}</span>}
              </button>
            )
          })}
        </div>

        {selection.start && (
          <div className="booking-bar">
            <div className="booking-range">
              {formatRangeES(selection.start, selection.end || selection.start)}
            </div>
            <input
              className="booking-input"
              type="text"
              placeholder="¿Quién se queda? (ej. Mamá)"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleReservar()}
              autoFocus
            />
            <div className="booking-actions">
              <button className="btn btn-ghost" onClick={cancelSelection} disabled={saving}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleReservar} disabled={saving}>
                {saving ? 'Guardando…' : 'Reservar'}
              </button>
            </div>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <h2 className="section-title">RESERVAS DEL MES</h2>
        {sortedReservations.length === 0 ? (
          <p className="empty-list">Aún no hay reservas este mes.</p>
        ) : (
          <ul className="res-list">
            {sortedReservations.map((res) => (
              <li key={res.id} className="res-row">
                <span className="res-dot" style={{ background: colorForName(res.guest_name) }} />
                <div className="res-info">
                  <div className="res-name">{res.guest_name}</div>
                  <div className="res-range">{formatRangeES(res.start_date, res.end_date)}</div>
                </div>
                <button className="res-delete" onClick={() => handleDelete(res)}>
                  Borrar
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function SetupNotice() {
  return (
    <div className="app">
      <header className="app-header">
        <p className="app-eyebrow">CALENDARIO SPI</p>
        <h1 className="app-title">Los Corales 301 S 🦢</h1>
        <p className="app-subtitle">Configuración pendiente</p>
      </header>
      <main className="app-body">
        <div className="booking-bar">
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            Falta conectar Supabase. Copia tus credenciales en el archivo{' '}
            <code>.env</code> y reinicia el servidor:
          </p>
          <pre className="setup-pre">
{`VITE_SUPABASE_URL=https://tu-ref.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...`}
          </pre>
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            Y ejecuta <code>supabase/schema.sql</code> en el editor SQL de tu proyecto.
          </p>
        </div>
      </main>
    </div>
  )
}
