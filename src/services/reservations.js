import { supabase } from '../supabaseClient'
import { hasConflict } from '../utils/dates'

// Data access for the shared `reservations` table.
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

// Create a reservation: { guest_name, start_date, end_date, color }.
// Throws with code '23P01' if it overlaps an existing reservation.
export async function createReservation(reservation) {
  const { start_date, end_date } = reservation

  const { data: existing, error: existingError } = await supabase
    .from(TABLE)
    .select('start_date, end_date')
    .lte('start_date', end_date)
    .gte('end_date', start_date)

  if (existingError) throw existingError

  if (hasConflict(start_date, end_date, existing || [])) {
    const conflictError = new Error('No se permiten superposiciones de más de un día')
    conflictError.code = '23P01'
    throw conflictError
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert(reservation)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteReservation(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
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
