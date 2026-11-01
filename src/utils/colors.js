// Colors per guest. A name always maps to the same colors, so each person
// keeps a consistent look across the calendar.
//
// - colorForName: strong tone (list dots, stored `color` column).
// - tintForName: pastel background + dark text for calendar day cells.

const PALETTE = [
  { strong: '#1E5FA8', bg: '#D6E6F8', fg: '#163F6E' }, // azul
  { strong: '#2E8B57', bg: '#D4EFDD', fg: '#1D5A38' }, // verde
  { strong: '#E07B26', bg: '#FBE0C8', fg: '#7A3D0B' }, // naranja
  { strong: '#C2410C', bg: '#F9D6C8', fg: '#7A2A08' }, // terracota
  { strong: '#0E7490', bg: '#CDEBF2', fg: '#0B4F62' }, // cyan
  { strong: '#9D3FB0', bg: '#F0D9F5', fg: '#5E2069' }, // morado
  { strong: '#B42345', bg: '#F8D3DC', fg: '#701428' }, // rojo
  { strong: '#64748B', bg: '#E2E6EC', fg: '#334155' }, // gris
]

// Fixed colors for the rotation owners (case-insensitive), matching the
// postcard sign: pink, turquoise, yellow, lavender.
const FIXED = {
  nana: { strong: '#C7366B', bg: '#F9D3E2', fg: '#7A1D45' },
  jaime: { strong: '#0E7C78', bg: '#CDEDEA', fg: '#0B5653' },
  javier: { strong: '#D9A300', bg: '#FCE7A6', fg: '#5C4300' },
  ale: { strong: '#6A4BD1', bg: '#E1D8FA', fg: '#42288F' },
}

function toneForName(name) {
  const key = (name || '').trim().toLowerCase()
  if (FIXED[key]) return FIXED[key]
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}

export function colorForName(name) {
  return toneForName(name).strong
}

export function tintForName(name) {
  const { bg, fg } = toneForName(name)
  return { bg, fg }
}
