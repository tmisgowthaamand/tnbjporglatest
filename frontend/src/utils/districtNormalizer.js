export const TN_38_DISTRICTS = [
  'Ariyalur',
  'Chengalpattu',
  'Chennai',
  'Coimbatore',
  'Cuddalore',
  'Dharmapuri',
  'Dindigul',
  'Erode',
  'Kallakurichi',
  'Kancheepuram',
  'Kanniyakumari',
  'Karur',
  'Krishnagiri',
  'Madurai',
  'Mayiladuthurai',
  'Nagapattinam',
  'Namakkal',
  'Nilgiris',
  'Perambalur',
  'Pudukkottai',
  'Ramanathapuram',
  'Ranipet',
  'Salem',
  'Sivagangai',
  'Tenkasi',
  'Thanjavur',
  'Theni',
  'Thiruvallur',
  'Thiruvarur',
  'Thoothukudi',
  'Tiruchirappalli',
  'Tirunelveli',
  'Tirupathur',
  'Tiruppur',
  'Tiruvannamalai',
  'Vellore',
  'Villupuram',
  'Virudhunagar',
]

const ALIAS_MAP = {
  tiruvallur: 'Thiruvallur',
  thiruvallur: 'Thiruvallur',
  kanchipuram: 'Kancheepuram',
  kanchee: 'Kancheepuram',
  viluppuram: 'Villupuram',
  trichy: 'Tiruchirappalli',
  tiruchirapalli: 'Tiruchirappalli',
  tiruchchirappalli: 'Tiruchirappalli',
  'the nilgiris': 'Nilgiris',
  nilgiri: 'Nilgiris',
  'n|lgiris': 'Nilgiris',
  'nlgiris': 'Nilgiris',
  sivaganga: 'Sivagangai',
  kanyakumari: 'Kanniyakumari',
  tuticorin: 'Thoothukudi',
  thoothukkudi: 'Thoothukudi',
  mayiladuthurai: 'Mayiladuthurai',
  mayiladuthurai_rural: 'Mayiladuthurai',
  mayiladuturai: 'Mayiladuthurai',
  ranippettai: 'Ranipet',
  tiruppattur: 'Tirupathur',
  kallakkurichi: 'Kallakurichi',
  teni: 'Theni',
  thiruvarur: 'Thiruvarur',
  tiruvarur: 'Thiruvarur',
}

export function normalizeDistrictName(rawDistrict) {
  if (!rawDistrict || typeof rawDistrict !== 'string') return ''
  const clean = rawDistrict.trim().toLowerCase()
  if (!clean) return ''

  if (ALIAS_MAP[clean]) return ALIAS_MAP[clean]

  const matched = TN_38_DISTRICTS.find((d) => d.toLowerCase() === clean)
  if (matched) return matched

  return clean.replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getDistrictNumber(rawDistrict) {
  const norm = normalizeDistrictName(rawDistrict)
  const idx = TN_38_DISTRICTS.indexOf(norm)
  return idx !== -1 ? idx + 1 : null
}

export function getDistrictColorIntensity(count, maxCount) {
  if (!count || count <= 0) return '#FFFFFF'
  if (!maxCount || maxCount <= 0) return '#FEF3C7'

  const ratio = count / maxCount
  if (ratio < 0.25) return '#FDE68A'
  if (ratio < 0.6) return '#F59E0B'
  return '#DC2626'
}
