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
import { colorForName, tintForName } from './utils/colors'
import './App.css'

// Rotation owners shown as one-tap name chips in the booking sheet.
const QUICK_NAMES = ['Nana', 'Jaime', 'Javier', 'Ale']

function isQuickName(name) {
  const key = (name || '').trim().toLowerCase()
  return QUICK_NAMES.some((n) => n.toLowerCase() === key)
}

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
  const [otherMode, setOtherMode] = useState(false)
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
    setOtherMode(false)
    setEditingId(null)
    setError('')
  }

  function startEditing(res) {
    setError('')
    setEditingId(res.id)
    setGuestName(res.guest_name)
    setOtherMode(!isQuickName(res.guest_name))
    setSelection({ start: res.start_date, end: res.end_date })
  }

  function pickName(name) {
    setGuestName(name)
    setOtherMode(false)
    setError('')
  }

  function pickOther() {
    if (!otherMode && isQuickName(guestName)) setGuestName('')
    setOtherMode(true)
    setError('')
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

  const todayISO = toISODate(new Date())
  const sortedReservations = [...reservations].sort((a, b) =>
    a.start_date.localeCompare(b.start_date),
  )
  const sheetOpen = editMode && Boolean(selection.start)

  let sheetHint = ''
  if (sheetOpen && !selection.end) {
    sheetHint = 'Toca el día de salida, o reserva solo este día.'
  } else if (sheetOpen && editingId) {
    sheetHint = 'Toca un día del calendario para escoger fechas nuevas.'
  }

  return (
    <div className="app">
      <PostalHeader
        editMode={editMode}
        badge={editMode ? '¡Bienvenida, Adriana!' : null}
        onLogout={handleLogout}
      />

      <main className={`app-body${sheetOpen ? ' with-sheet' : ''}`}>
        <div className="month-nav">
          <button
            className="nav-btn"
            onClick={() => changeMonth(-1)}
            disabled={atMin}
            aria-label="Mes anterior"
          >
            <ChevronIcon dir="left" />
          </button>
          <span className="month-label">{monthLabel(year, month)}</span>
          <button
            className="nav-btn"
            onClick={() => changeMonth(1)}
            disabled={atMax}
            aria-label="Mes siguiente"
          >
            <ChevronIcon dir="right" />
          </button>
        </div>

        <div className="cal-grid">
          {WEEKDAYS_ES.map((d, i) => (
            <span key={`wd-${i}`} className="weekday">{d}</span>
          ))}
          {cells.map((iso, i) => {
            if (!iso) return <div key={`blank-${i}`} className="day empty" />
            const resForDay = bookedByDay.get(iso) || []
            const dayNum = Number(iso.split('-')[2])
            const hasSplit = resForDay.length === 2
            const classes = [
              'day',
              isSelected(iso) ? 'selected' : '',
              iso === todayISO ? 'today' : '',
              editMode ? '' : 'readonly',
            ].filter(Boolean).join(' ')

            let style
            if (hasSplit) {
              const a = tintForName(resForDay[0].guest_name)
              const b = tintForName(resForDay[1].guest_name)
              style = {
                background: `linear-gradient(135deg, ${a.bg} 50%, ${b.bg} 50%)`,
                color: 'var(--ink)',
              }
            } else if (resForDay.length === 1) {
              const t = tintForName(resForDay[0].guest_name)
              style = { background: t.bg, color: t.fg }
            }

            const guestLabel = hasSplit
              ? `${resForDay[0].guest_name} / ${resForDay[1].guest_name}`
              : resForDay[0]?.guest_name

            return (
              <button
                key={iso}
                className={classes}
                onClick={editMode ? () => handleDayClick(iso) : undefined}
                style={style}
                aria-label={guestLabel ? `${dayNum}, ${guestLabel}` : `${dayNum}, libre`}
              >
                <span className="num">{dayNum}</span>
                <span className="who">
                  {guestLabel || (editMode && isSelected(iso) ? 'libre' : '')}
                </span>
              </button>
            )
          })}
        </div>

        {error && !sheetOpen && <p className="error">{error}</p>}

        <h2 className="section-title">RESERVAS DEL MES</h2>
        {sortedReservations.length === 0 ? (
          <p className="empty-list">No hay reservas este mes.</p>
        ) : (
          <ul className="res-list">
            {sortedReservations.map((res) => {
              const tint = tintForName(res.guest_name)
              return (
                <li key={res.id} className="res-row">
                  <span className="res-avatar" style={{ background: tint.bg, color: tint.fg }}>
                    {(res.guest_name || '?').trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="res-info">
                    <div className="res-name">
                      {res.guest_name}
                      {res.locked && (
                        <span className="res-lock" title="Rotación fija">
                          <LockIcon />
                        </span>
                      )}
                    </div>
                    <div className="res-range">{formatRangeES(res.start_date, res.end_date)}</div>
                  </div>
                  {editMode && (
                    <div className="res-actions">
                      <button className="res-btn res-move" onClick={() => startEditing(res)}>
                        <MoveIcon />
                        Mover fechas
                      </button>
                      <button
                        className="res-btn res-delete"
                        onClick={() => handleDelete(res)}
                        aria-label={`Borrar reserva de ${res.guest_name}`}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </main>

      {sheetOpen && (
        <section className="sheet" aria-label={editingId ? 'Mover reserva' : 'Nueva reserva'}>
          <div className="sheet-handle" />
          <div>
            <h2 className="sheet-title">{editingId ? 'Mover reserva' : 'Nueva reserva'}</h2>
            <p className="sheet-range">
              {formatRangeES(selection.start, selection.end || selection.start)}
            </p>
            {sheetHint && <p className="sheet-hint">{sheetHint}</p>}
          </div>

          <div>
            <div className="sheet-label">¿QUIÉN SE QUEDA?</div>
            <div className="chips">
              {QUICK_NAMES.map((n) => {
                const active = !otherMode && guestName.trim().toLowerCase() === n.toLowerCase()
                return (
                  <button
                    key={n}
                    className={`chip${active ? ' active' : ''}`}
                    aria-pressed={active}
                    onClick={() => pickName(n)}
                  >
                    {active && <CheckIcon />}
                    {n}
                  </button>
                )
              })}
              <button
                className={`chip other${otherMode ? ' active' : ''}`}
                aria-pressed={otherMode}
                onClick={pickOther}
              >
                Otro…
              </button>
            </div>
            {otherMode && (
              <input
                className="booking-input"
                type="text"
                autoFocus
                placeholder="Escribe el nombre"
                aria-label="Nombre de quien se queda"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              />
            )}
          </div>

          {error && <p className="error">{error}</p>}

          <div className="sheet-actions">
            <button className="btn btn-ghost" onClick={cancelSelection} disabled={saving}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando…' : editingId ? 'Guardar' : 'Reservar'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

function PostalHeader({ editMode = false, badge, onLogout }) {
  return (
    <header className="postal-header">
      <svg
        className="postal-palms"
        width="130"
        height="196"
        viewBox="260 0 130 196"
        aria-hidden="true"
      >
        <path d="M300 196 C304 150 312 110 326 70" stroke="#14324F" strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M326 70 c-20 -10 -40 -6 -54 8 M326 70 c-14 -18 -34 -24 -52 -18 M326 70 c4 -22 18 -34 38 -38 M326 70 c18 -8 38 -4 52 10 M326 70 c10 10 14 26 10 42" stroke="#14324F" strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M352 196 C354 166 358 140 366 116" stroke="#14324F" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M366 116 c-14 -8 -28 -4 -38 6 M366 116 c-8 -14 -22 -18 -36 -14 M366 116 c4 -16 14 -24 28 -26 M366 116 c12 -4 24 0 32 10" stroke="#14324F" strokeWidth="4" fill="none" strokeLinecap="round" />
      </svg>
      <div className="postal-sand" />

      <div className="postal-top">
        {badge ? <span className="postal-badge">{badge}</span> : <span />}
        {editMode && onLogout && (
          <button className="icon-btn-light" onClick={onLogout} aria-label="Salir del editor">
            <LogoutIcon />
          </button>
        )}
      </div>

      <div className="postal-brand">
        <svg className="postal-umbrellas" width="88" height="26" viewBox="0 0 88 26" aria-hidden="true">
          {[
            ['#6CCBC6', 2, 4],
            ['#F097C0', 31, 2],
            ['#FFE21A', 60, 4],
          ].map(([color, x, y]) => (
            <g key={color} transform={`translate(${x} ${y}) rotate(-10 13 12)`}>
              <path d="M0 13 Q13 -3 26 13 Q19.5 9.5 13 13 Q6.5 9.5 0 13 Z" fill={color} />
              <path d="M13 12 L15 24" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
            </g>
          ))}
        </svg>
        <span className="postal-script">South Padre</span>
        <span className="postal-sign">LOS CORALES · 301 S</span>
      </div>
    </header>
  )
}

function Icon({ children, size = 20, strokeWidth = 2.2 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

function ChevronIcon({ dir }) {
  return (
    <Icon strokeWidth={2.4}>
      <path d={dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
    </Icon>
  )
}

function LogoutIcon() {
  return (
    <Icon strokeWidth={2}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </Icon>
  )
}

function CheckIcon() {
  return (
    <Icon size={16} strokeWidth={3}>
      <path d="M5 12l5 5 9-10" />
    </Icon>
  )
}

function MoveIcon() {
  return (
    <Icon size={18}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
      <path d="M10 15h6M13 12l3 3-3 3" />
    </Icon>
  )
}

function TrashIcon() {
  return (
    <Icon size={20}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </Icon>
  )
}

function LockIcon() {
  return (
    <Icon size={14} strokeWidth={2.4}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Icon>
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
      <PostalHeader badge="EDITOR" />
      <main className="app-body">
        <div className="card">
          <div className="card-title">Ingresa la contraseña del editor</div>
          <input
            className="booking-input"
            type="password"
            autoFocus
            placeholder="Contraseña"
            aria-label="Contraseña"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <button className="btn btn-blue" onClick={submit} disabled={checking}>
            {checking ? 'Verificando…' : 'Entrar'}
          </button>
          {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
        </div>
        <p className="empty-list" style={{ marginTop: 16 }}>
          Para solo ver el calendario, usa el enlace público:{' '}
          <code>#/{PUBLIC_SLUG}</code>
        </p>
      </main>
    </div>
  )
}

function SetupNotice() {
  return (
    <div className="app">
      <PostalHeader />
      <main className="app-body">
        <div className="card">
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
