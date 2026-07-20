import { supabase } from '../supabaseClient'

// Data access for the shared `reservations` table.
//
// Reads use the anon key directly (RLS allows public SELECT).
// Writes go through SECURITY DEFINER RPCs that validate the admin password
// server-side — direct writes with the anon key are blocked by RLS. Every
// write function therefore takes the admin `password` as its first argument.
// All functions throw on error so callers can try/catch.

const TABLE = 'reservations'

// Fetch every reservation that overlaps the [fromISO, toISO] window
// (date strings 'YYYY-MM-DD'). Used to load the visible month.
export async function listReservationsInRange(fromISO, toISO) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .lte('start_date', toISO)
    .gte('end_date', fromISO)
    .order('start_date', { ascending: true })

  if (error) throw error
  return data
}

// Validate the admin password against the server. Returns true/false.
export async function adminLogin(password) {
  const { data, error } = await supabase.rpc('admin_login', { p_password: password })
  if (error) throw error
  return data === true
}

// Create a reservation: { guest_name, start_date, end_date, color, locked }.
// The DB overlap trigger raises if it conflicts by more than the changeover day.
export async function createReservation(password, reservation) {
  const { guest_name, start_date, end_date, color, locked = false } = reservation
  const { data, error } = await supabase.rpc('admin_create_reservation', {
    p_password: password,
    p_guest_name: guest_name,
    p_start_date: start_date,
    p_end_date: end_date,
    p_color: color,
    p_locked: locked,
  })
  if (error) throw error
  return data
}

// Move / rename an existing reservation.
export async function updateReservation(password, id, { guest_name, start_date, end_date }) {
  const { data, error } = await supabase.rpc('admin_update_reservation', {
    p_password: password,
    p_id: id,
    p_guest_name: guest_name,
    p_start_date: start_date,
    p_end_date: end_date,
  })
  if (error) throw error
  return data
}

export async function deleteReservation(password, id) {
  const { error } = await supabase.rpc('admin_delete_reservation', {
    p_password: password,
    p_id: id,
  })
  if (error) throw error
}

// Subscribe to realtime changes so the shared/team view stays in sync.
// Returns an unsubscribe function.
export function subscribeToReservations(onChange) {
  const channel = supabase
    .channel('reservations-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE },
      (payload) => onChange(payload)
    )
    .subscribe()

  return () => supabase.removeChannel(channel)
}
