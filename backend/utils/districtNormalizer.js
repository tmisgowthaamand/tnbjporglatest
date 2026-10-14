// Backend copy of frontend/src/utils/districtNormalizer.js — keep the two in sync.
// Maps the many spellings stored in the DB (e.g. VILUPPURAM, SIVAGANGA) onto the
// 38 canonical Tamil Nadu district names used by the admin maps.

const TN_38_DISTRICTS = [
  'Ariyalur', 'Chengalpattu', 'Chennai', 'Coimbatore', 'Cuddalore', 'Dharmapuri',
  'Dindigul', 'Erode', 'Kallakurichi', 'Kancheepuram', 'Kanniyakumari', 'Karur',
  'Krishnagiri', 'Madurai', 'Mayiladuthurai', 'Nagapattinam', 'Namakkal', 'Nilgiris',
  'Perambalur', 'Pudukkottai', 'Ramanathapuram', 'Ranipet', 'Salem', 'Sivagangai',
  'Tenkasi', 'Thanjavur', 'Theni', 'Thiruvallur', 'Thiruvarur', 'Thoothukudi',
  'Tiruchirappalli', 'Tirunelveli', 'Tirupathur', 'Tiruppur', 'Tiruvannamalai',
  'Vellore', 'Villupuram', 'Virudhunagar'
];

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
  nlgiris: 'Nilgiris',
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
  tiruvarur: 'Thiruvarur'
};

const normalizeDistrictName = (rawDistrict) => {
  if (!rawDistrict || typeof rawDistrict !== 'string') return '';
  const clean = rawDistrict.trim().toLowerCase();
  if (!clean) return '';
  if (ALIAS_MAP[clean]) return ALIAS_MAP[clean];
  const matched = TN_38_DISTRICTS.find((d) => d.toLowerCase() === clean);
  if (matched) return matched;
  return clean.replace(/\b\w/g, (c) => c.toUpperCase());
};

// Mongo filter value matching every stored spelling of the same district.
// `storedNames` is the list of distinct district values in the collection.
const districtSpellingsFilter = (requested, storedNames) => {
  const target = normalizeDistrictName(requested);
  const spellings = storedNames.filter((d) => d && normalizeDistrictName(d) === target);
  if (spellings.length) return { $in: spellings };
  const escaped = String(requested).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}$`, 'i');
};

module.exports = { TN_38_DISTRICTS, normalizeDistrictName, districtSpellingsFilter };
