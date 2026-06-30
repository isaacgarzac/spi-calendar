// Varied, pleasant palette for reservation chips. All tones read well with
// white text. A name always maps to the same color, so each person keeps a
// consistent color across the calendar.
const PALETTE = [
  '#3b82f6', // azul
  '#10b981', // verde esmeralda
  '#f97316', // naranja
  '#8b5cf6', // morado
  '#ec4899', // rosa
  '#14b8a6', // turquesa
  '#ef4444', // rojo
  '#6366f1', // índigo
  '#0ea5e9', // celeste
  '#d97706', // ámbar
]

export function colorForName(name) {
  const key = (name || '').trim().toLowerCase()
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}
