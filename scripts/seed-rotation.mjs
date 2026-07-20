// Re-siembra la rotación semanal Lun→Dom usando las funciones admin_* de Supabase.
// Borra toda la rotación existente (locked=true, desde 2026-11-01) y la vuelve a
// crear limpia. Es idempotente: se puede correr las veces que quieras.
//
// Uso:  node --env-file=.env scripts/seed-rotation.mjs
// Requiere en .env:  VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ADMIN_PASSWORD
import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
const password = process.env.ADMIN_PASSWORD

if (!url || !key) {
  console.error('❌ Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en .env')
  process.exit(1)
}
if (!password) {
  console.error('❌ Falta ADMIN_PASSWORD en .env (tu password de admin).')
  process.exit(1)
}

// --- Configuración de la rotación ---
const OWNERS = ['Nana', 'Jaime', 'Javier', 'Ale'] // orden cíclico
const START = '2026-11-02' // lunes (el domingo 1-nov queda vacío)
const WEEKS = 61 // cubre hasta dic-2027 (última semana 27-dic → 2-ene-2028)

// Suma días en UTC para evitar corrimientos por zona horaria.
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

const supabase = createClient(url, key)

async function main() {
  // 1) Borrar la rotación existente.
  const { data: existing, error: selErr } = await supabase
    .from('reservations')
    .select('id')
    .eq('locked', true)
    .gte('start_date', '2026-11-01')
  if (selErr) throw selErr

  for (const row of existing) {
    const { error } = await supabase.rpc('admin_delete_reservation', {
      p_password: password,
      p_id: row.id,
    })
    if (error) throw error
  }
  console.log(`🗑️  Borradas ${existing.length} semanas previas.`)

  // 2) Crear 61 semanas Lun→Dom.
  for (let n = 0; n < WEEKS; n++) {
    const start = addDays(START, n * 7)
    const end = addDays(START, n * 7 + 6)
    const guest = OWNERS[n % OWNERS.length]
    const { error } = await supabase.rpc('admin_create_reservation', {
      p_password: password,
      p_guest_name: guest,
      p_start_date: start,
      p_end_date: end,
      p_locked: true,
    })
    if (error) throw error
  }
  console.log(`✅ Creadas ${WEEKS} semanas Lun→Dom desde ${START} (Nana → Jaime → Javier → Ale).`)
}

main().catch((err) => {
  console.error('❌ Error:', err.message || err)
  process.exit(1)
})
