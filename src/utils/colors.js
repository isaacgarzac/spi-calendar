// Varied, pleasant palette for reservation chips. All tones read well with
// white text. A name always maps to the same color, so each person keeps a
// consistent color across the calendar.
const PALETTE = [
  '#2563eb', // azul
  '#16a34a', // verde
  '#f97316', // naranja
  '#db2777', // fucsia
  '#0ea5e9', // cyan
  '#eab308', // amarillo
  '#14b8a6', // teal
  '#ef4444', // rojo
  '#7c3aed', // violeta
  '#22c55e', // verde fuerte
  '#f43f5e', // rosa fuerte
  '#f59e0b', // ámbar
]

export function colorForName(name) {
  const key = (name || '').trim().toLowerCase()
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}
