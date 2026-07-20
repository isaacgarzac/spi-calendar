import { useCallback, useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured } from './supabaseClient'
import {
  listReservationsInRange,
  createReservation,
  updateReservation,
  deleteReservation,
  subscribeToReservations,
  adminLogin,
} from './services/reservations'
import {
  getAdminPassword,
  setAdminPassword as persistAdminPassword,
  clearAdminPassword,
} from './utils/adminSession'
import {
  WEEKDAYS_ES,
  monthLabel,
  daysInMonth,
  leadingOffset,
  toISODate,
  formatRangeES,
  getOccupiedDays,
  hasConflict,
} from './utils/dates'
import { colorForName } from './utils/colors'
import './App.css'

// Navigation bounds: from the current month up to December 2029.
const MAX_MONTH = { year: 2029, month: 11 } // Diciembre 2029
const today = new Date()
const MIN_MONTH = { year: today.getFullYear(), month: today.getMonth() }

// New shareable public link: <origin>/#/corales-301  (read-only, no controls).
// Admin entry: <origin>/#/admin
const PUBLIC_SLUG = 'corales-301'

// Compare two {year, month} objects: negative if a < b, etc.
function compareMonth(a, b) {
  return a.year - b.year || a.month - b.month
}

// Derive the route from the URL hash. Only '#/admin' unlocks the edit gate;
// everything else (empty, '#/corales-301', old link) is the public view.
function routeFromHash() {
  const h = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase()
  return h === 'admin' ? 'admin' : 'public'
}

function friendlyError(err) {
  const m = err?.message || ''
  if (/autoriz/i.test(m) || err?.code === '42501') {
    return 'Password incorrecta o la sesión expiró. Vuelve a entrar en modo edición.'
  }
  if (/superposi/i.test(m) || /overlap/i.test(m) || err?.code === '23P01') {
    return 'Esas fechas chocan con otra reserva 🚫'
  }
  return m
}

export default function App() {
  const [route, setRoute] = useState(routeFromHash())
  const [adminPassword, setAdminPassword] = useState(getAdminPassword())

  const [view, setView] = useState({ ...MIN_MONTH })
  const [reservations, setReservations] = useState([])
  const [selection, setSelection] = useState({ start: null, end: null })
  const [guestName, setGuestName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Edit controls are visible only on the admin route WITH a valid session.
  const editMode = route === 'admin' && Boolean(adminPassword)

  const { year, month } = view

  const monthStart = toISODate(new Date(year, month, 1))
  const monthEnd = toISODate(new Date(year, month, daysInMonth(year, month)))

  // Keep route in sync with the URL hash.
  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

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

  // Map every booked day in the visible month to its reservation(s).
  // A day may belong to two reservations only when it is the shared changeover day.
  const bookedByDay = useMemo(() => {
    const map = new Map()
    for (const res of reservations) {
      for (const day of getOccupiedDays(res.start_date, res.end_date)) {
        map.set(day, [...(map.get(day) || []), res])
      }
    }
    return map
  }, [reservations])

  function rangeHasConflict(startISO, endISO) {
    // When editing, ignore the reservation being moved so it doesn't clash with itself.
    const others = editingId
      ? reservations.filter((r) => r.id !== editingId)
      : reservations
    return hasConflict(startISO, endISO, others)
  }

  function isSelected(iso) {
    if (!selection.start) return false
    const end = selection.end || selection.start
    const lo = selection.start < end ? selection.start : end
    const hi = selection.start < end ? end : selection.start
    return iso >= lo && iso <= hi
  }

  function handleDayClick(iso) {
    if (!editMode) return
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
    setEditingId(null)
    setError('')
  }

  function startEditing(res) {
    setError('')
    setEditingId(res.id)
    setGuestName(res.guest_name)
    setSelection({ start: res.start_date, end: res.end_date })
  }

  async function handleSave() {
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
      if (editingId) {
        await updateReservation(adminPassword, editingId, {
          guest_name: name,
          start_date: start,
          end_date: end,
        })
      } else {
        await createReservation(adminPassword, {
          guest_name: name,
          start_date: start,
          end_date: end,
          color: colorForName(name),
        })
      }
      cancelSelection()
      await loadMonth()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(res) {
    const label = res.locked ? `${res.guest_name} (bloqueada 🔒)` : res.guest_name
    if (!window.confirm(`¿Borrar la reserva de ${label}?`)) return
    try {
      await deleteReservation(adminPassword, res.id)
      if (editingId === res.id) cancelSelection()
      await loadMonth()
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  function handleLogout() {
    clearAdminPassword()
    setAdminPassword(null)
    cancelSelection()
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

  // Admin route without a valid session → show the login gate.
  if (route === 'admin' && !adminPassword) {
    return (
      <AdminLogin
        onSuccess={(pw) => {
          persistAdminPassword(pw)
          setAdminPassword(pw)
        }}
      />
    )
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
        <p className="app-subtitle">
          {editMode ? 'Modo edición activo' : 'Calendario de la familia'}
        </p>
      </header>

      {editMode && (
        <div className="admin-bar">
          <span className="admin-badge">✏️ Modo edición</span>
          <button className="admin-logout" onClick={handleLogout}>
            Salir
          </button>
        </div>
      )}

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
            const reservationsForDay = bookedByDay.get(iso) || []
            const dayNum = Number(iso.split('-')[2])
            const hasSplit = reservationsForDay.length === 2
            const classes = [
              'day',
              reservationsForDay.length > 0 ? (hasSplit ? 'booked-split' : 'booked') : '',
              isSelected(iso) ? 'selected' : '',
              editMode ? '' : 'readonly',
            ].filter(Boolean).join(' ')
            const style = hasSplit
              ? {
                  background: `linear-gradient(90deg, ${colorForName(reservationsForDay[0].guest_name)} 50%, ${colorForName(reservationsForDay[1].guest_name)} 50%)`,
                  borderColor: colorForName(reservationsForDay[0].guest_name),
                }
              : reservationsForDay.length === 1
              ? {
                  background: colorForName(reservationsForDay[0].guest_name),
                  borderColor: colorForName(reservationsForDay[0].guest_name),
                }
              : undefined
            const guestLabel = hasSplit
              ? `${reservationsForDay[0].guest_name} / ${reservationsForDay[1].guest_name}`
              : reservationsForDay[0]?.guest_name
            return (
              <button
                key={iso}
                className={classes}
                onClick={editMode ? () => handleDayClick(iso) : undefined}
                style={style}
              >
                <span className="num">{dayNum}</span>
                {reservationsForDay.length > 0 && <span className="who">{guestLabel}</span>}
              </button>
            )
          })}
        </div>

        {editMode && selection.start && (
          <div className="booking-bar">
            <div className="booking-range">
              {editingId ? 'Editando: ' : ''}
              {formatRangeES(selection.start, selection.end || selection.start)}
            </div>
            <input
              className="booking-input"
              type="text"
              placeholder="¿Quién se queda? (ej. Mamá)"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
            <div className="booking-actions">
              <button className="btn btn-ghost" onClick={cancelSelection} disabled={saving}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Reservar'}
              </button>
            </div>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <h2 className="section-title">RESERVAS DEL MES</h2>
        {sortedReservations.length === 0 ? (
          <p className="empty-list">No hay reservas este mes.</p>
        ) : (
          <ul className="res-list">
            {sortedReservations.map((res) => (
              <li key={res.id} className="res-row">
                <span className="res-dot" style={{ background: colorForName(res.guest_name) }} />
                <div className="res-info">
                  <div className="res-name">
                    {res.guest_name}
                    {res.locked && <span className="res-lock" title="Bloqueada">🔒</span>}
                  </div>
                  <div className="res-range">{formatRangeES(res.start_date, res.end_date)}</div>
                </div>
                {editMode && (
                  <div className="res-actions">
                    <button className="res-edit" onClick={() => startEditing(res)}>
                      Editar
                    </button>
                    <button className="res-delete" onClick={() => handleDelete(res)}>
                      Borrar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function AdminLogin({ onSuccess }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  async function submit() {
    const value = pw.trim()
    if (!value) return
    setChecking(true)
    setError('')
    try {
      const ok = await adminLogin(value)
      if (ok) {
        onSuccess(value)
      } else {
        setError('Password incorrecta.')
      }
    } catch (err) {
      setError('No se pudo verificar: ' + err.message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <p className="app-eyebrow">CALENDARIO SPI</p>
        <h1 className="app-title">Los Corales 301 S 🦢</h1>
        <p className="app-subtitle">Modo edición</p>
      </header>
      <main className="app-body">
        <div className="booking-bar" style={{ position: 'static' }}>
          <div className="booking-range">Ingresa la password de admin</div>
          <input
            className="booking-input"
            type="password"
            autoFocus
            placeholder="Password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <div className="booking-actions">
            <button className="btn btn-primary" onClick={submit} disabled={checking}>
              {checking ? 'Verificando…' : 'Entrar'}
            </button>
          </div>
          {error && <p className="error" style={{ marginBottom: 0 }}>{error}</p>}
        </div>
        <p className="empty-list" style={{ marginTop: 16 }}>
          Para ver el calendario, usa el enlace público:{' '}
          <code>#/{PUBLIC_SLUG}</code>
        </p>
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
