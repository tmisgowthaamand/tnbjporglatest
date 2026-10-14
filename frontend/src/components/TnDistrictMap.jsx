import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import API from '../utils/api'
import { normalizeDistrictName, getDistrictNumber, TN_38_DISTRICTS } from '../utils/districtNormalizer'
import '../styles/tn-map.css'

export function LocationPinIcon({ size = 16, color = '#2563EB', fill = '#2563EB', style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'inline-block', verticalAlign: '-3px', ...style }}>
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill={fill} stroke="#FFFFFF" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="12" cy="9" r="2.5" fill="#FFFFFF" />
    </svg>
  )
}

function getSaffronIntensity(count, maxCount) {
  if (!count || count === 0) return '#E8ECF0'
  const ratio = Math.min(count / Math.max(maxCount, 1), 1)
  if (ratio < 0.10) return '#FEE0C8'
  if (ratio < 0.25) return '#FDC09A'
  if (ratio < 0.45) return '#FB9A5E'
  if (ratio < 0.65) return '#F76201'
  if (ratio < 0.85) return '#D94E00'
  return '#B83D00'
}

function projectCoordsDynamic(coords, bbox, width = 540, height = 660) {
  const { minLng, maxLng, minLat, maxLat } = bbox
  return coords.map(([lng, lat]) => {
    const x = ((lng - minLng) / (maxLng - minLng)) * (width - 70) + 35
    const y = height - (((lat - minLat) / (maxLat - minLat)) * (height - 70) + 35)
    return { x: parseFloat(x.toFixed(1)), y: parseFloat(y.toFixed(1)) }
  })
}

function coordsToPoints(pointsArr) {
  return pointsArr.map((p) => `${p.x},${p.y}`).join(' ')
}

function getCentroid(pointsArr) {
  let cx = 0, cy = 0
  pointsArr.forEach((p) => { cx += p.x; cy += p.y })
  return { x: cx / pointsArr.length, y: cy / pointsArr.length }
}

// Wording for the default (scheme applications) map; other pages pass their own `metric`.
const APPLICATIONS_METRIC = {
  title: 'Applications',
  plural: 'applications',
  activeNote: 'With Submissions',
  directory: 'DISTRICT APPLICATION DIRECTORY',
}

// With no `districtStats` prop the map loads scheme-application counts itself
// (dashboard behaviour). Pass `districtStats` ([{ _id: district, total }]) to show
// any other per-district count, e.g. referrals or volunteer requests.
export default function TnDistrictMap({
  onSelectDistrict,
  selectedDistrict = '',
  districtStats = null,
  metric = APPLICATIONS_METRIC,
  title = 'TAMIL NADU 38-DISTRICT INTERACTIVE MAP',
  hoverDetail = null,
}) {
  const [geoJson, setGeoJson] = useState(null)
  const [fetchedCounts, setFetchedCounts] = useState({})
  const [userRole, setUserRole] = useState('SUPER_ADMIN')
  const [hoveredDistrict, setHoveredDistrict] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isPlayingAnimation, setIsPlayingAnimation] = useState(false)
  const [animatedIndex, setAnimatedIndex] = useState(0)
  const timerRef = useRef(null)
  const usesProvidedStats = districtStats !== null

  // On narrow screens the 38-district map is ~280px wide: in-map labels would
  // render at ~4px, so they are hidden there and the info bar + directory carry
  // the names/counts. Touch screens can't hover, so the hint says "Tap".
  // Callback ref: re-attaches the observer whenever React swaps the <svg> node.
  const [mapWidth, setMapWidth] = useState(540)
  const resizeObserverRef = useRef(null)
  const svgRef = useCallback((el) => {
    if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null }
    if (!el) return
    const initial = el.getBoundingClientRect().width
    if (initial) setMapWidth(initial)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => { if (entry.contentRect.width) setMapWidth(entry.contentRect.width) })
    ro.observe(el)
    resizeObserverRef.current = ro
  }, [])
  const compactMap = mapWidth < 420
  const isTouch = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: none)').matches

  useEffect(() => {
    setLoading(true); setError(null)
    Promise.allSettled([
      fetch('/tn-districts.geojson?v=38').then((r) => r.json()),
      usesProvidedStats ? Promise.resolve(null) : API.get('/admin/map-analytics'),
    ]).then(([geoRes, statsRes]) => {
      if (geoRes.status === 'fulfilled') setGeoJson(geoRes.value)
      if (usesProvidedStats) return
      if (statsRes.status === 'fulfilled') {
        const data = statsRes.value?.data || {}
        const counts = {}
        ;(data.districtStats || []).forEach((d) => { if (d._id) counts[d._id] = d.total })
        setFetchedCounts(counts)
        setUserRole(data.role || 'SUPER_ADMIN')
      } else {
        setError('Could not fetch application data from server.')
      }
    }).finally(() => setLoading(false))
  }, [usesProvidedStats])

  const rawCounts = useMemo(() => {
    if (!usesProvidedStats) return fetchedCounts
    const counts = {}
    districtStats.forEach((d) => { if (d._id) counts[d._id] = (counts[d._id] || 0) + (Number(d.total) || 0) })
    return counts
  }, [usesProvidedStats, districtStats, fetchedCounts])

  useEffect(() => {
    if (isPlayingAnimation) {
      timerRef.current = setInterval(() => {
        setAnimatedIndex((prev) => (prev + 1) % TN_38_DISTRICTS.length)
      }, 1200)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [isPlayingAnimation])

  const currentAnimDistrict = useMemo(() => {
    if (!isPlayingAnimation) return null
    return TN_38_DISTRICTS[animatedIndex]
  }, [isPlayingAnimation, animatedIndex])

  const normalizedCounts = useMemo(() => {
    const map = {}
    TN_38_DISTRICTS.forEach((d) => { map[d] = 0 })
    Object.entries(rawCounts).forEach(([key, val]) => {
      const norm = normalizeDistrictName(key)
      if (norm) map[norm] = (map[norm] || 0) + (Number(val) || 0)
    })
    return map
  }, [rawCounts])

  const maxCount = useMemo(() => Math.max(...Object.values(normalizedCounts), 1), [normalizedCounts])
  const totalApps = useMemo(() => Object.values(normalizedCounts).reduce((a, b) => a + (Number(b) || 0), 0), [normalizedCounts])
  const activeDistrictsCount = useMemo(() => Object.values(normalizedCounts).filter((c) => c > 0).length, [normalizedCounts])

  const geoBbox = useMemo(() => {
    if (!geoJson?.features) return { minLng: 76.0, maxLng: 80.6, minLat: 8.0, maxLat: 13.6 }
    let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90
    geoJson.features.forEach((feat) => {
      const rawCoords = feat.geometry?.coordinates?.[0] || []
      rawCoords.forEach(([lng, lat]) => {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      })
    })
    return { minLng, maxLng, minLat, maxLat }
  }, [geoJson])

  const handleMouseEnter = (name) => setHoveredDistrict(name)

  const isDistrictAdmin = userRole === 'DISTRICT_ADMIN'
  const features = geoJson?.features || []

  const featurePointsList = useMemo(() => {
    return features.map((feat) => {
      const rawName = feat.properties?.district || feat.properties?.name || 'District'
      const normName = normalizeDistrictName(rawName)
      const rawCoords = feat.geometry?.coordinates?.[0] || []
      const projected = projectCoordsDynamic(rawCoords, geoBbox, 540, 660)
      return { feat, normName, projected }
    })
  }, [features, geoBbox])

  return (
    <div className="admin-card mb-4" style={{ padding: '26px 32px', background: '#FFFFFF', borderRadius: 24, border: '1px solid #E2E8F0', boxShadow: '0 8px 30px -6px rgba(15,23,42,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: isDistrictAdmin ? '#D97706' : '#2563EB', background: isDistrictAdmin ? '#FEF3C7' : '#EFF6FF', padding: '4px 12px', borderRadius: 8 }}>
            {isDistrictAdmin ? 'District Admin (Read Only — All 38 Districts)' : 'All 38 Districts Active'}
          </span>
          <h2 style={{ margin: '6px 0 0 0', fontSize: 24, fontWeight: 900, color: '#0F172A', fontFamily: 'Outfit, sans-serif' }}>
            {title}
          </h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => setIsPlayingAnimation(!isPlayingAnimation)} style={{ background: isPlayingAnimation ? '#DC2626' : '#2563EB', color: '#FFFFFF', border: 'none', borderRadius: 12, padding: '8px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.25)', transition: 'all 0.15s ease' }}>
            {isPlayingAnimation ? '⏸ Pause Tour' : '▶ Play 38-District Tour'}
          </button>

          {selectedDistrict && (
            <button onClick={() => onSelectDistrict && onSelectDistrict('')} style={{ background: '#FEF2F2', color: '#DC2626', border: '1.5px solid #FCA5A5', borderRadius: 12, padding: '8px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
              Clear Filter ({selectedDistrict}) ✕
            </button>
          )}
        </div>
      </div>

      {selectedDistrict && (
        <div style={{ marginBottom: 20, padding: '16px 24px', borderRadius: 18, background: 'linear-gradient(135deg, #1E4ED8, #2563EB)', color: '#FFFFFF', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14, boxShadow: '0 8px 24px rgba(37,99,235,0.25)', border: '1px solid rgba(255,255,255,0.2)' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#93C5FD', display: 'flex', alignItems: 'center', gap: 6 }}>
              <LocationPinIcon size={14} color="#93C5FD" fill="#93C5FD" />
              <span>Selected District</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, fontFamily: 'Outfit, sans-serif', marginTop: 2 }}>
              DISTRICT #{getDistrictNumber(selectedDistrict)} — {selectedDistrict.toUpperCase()}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#E0E7FF', marginTop: 2 }}>
              {metric.title}: <strong style={{ color: '#FFFFFF', fontSize: 15 }}>{normalizedCounts[selectedDistrict] || 0}</strong>
              {hoverDetail && hoverDetail(selectedDistrict) && <span style={{ marginLeft: 10, color: '#E0E7FF' }}>({hoverDetail(selectedDistrict)})</span>}
            </div>
          </div>
          <button onClick={() => onSelectDistrict && onSelectDistrict('')} style={{ background: 'rgba(255,255,255,0.2)', color: '#FFFFFF', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 12, padding: '10px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }} title="Clear District Filter">
            ✕ Clear
          </button>
        </div>
      )}

      {isPlayingAnimation && (
        <div style={{ marginBottom: 18, padding: '10px 18px', borderRadius: 14, background: '#EFF6FF', border: '1.5px solid #60A5FA', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#2563EB', display: 'inline-block', animation: 'pulse 1s infinite' }} />
            <span style={{ fontSize: 13, fontWeight: 800, color: '#1E4ED8' }}>
              District {animatedIndex + 1} of 38: <strong>#{animatedIndex + 1} {currentAnimDistrict}</strong>
            </span>
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#2563EB' }}>{metric.title}: {normalizedCounts[currentAnimDistrict] || 0}</span>
        </div>
      )}

      <div className="tn-kpi-cards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24, width: '100%', boxSizing: 'border-box' }}>
        {[
          { label: `Total ${metric.title}`, value: totalApps, color: '#0F172A', note: '✓ Live DB', noteColor: '#059669' },
          { label: 'Active Districts', value: `${activeDistrictsCount} / 38`, color: '#2563EB', note: metric.activeNote, noteColor: '#64748B' },
          { label: 'Peak Density', value: maxCount, color: '#DC2626', note: 'Max in one district', noteColor: '#64748B' },
        ].map(({ label, value, color, note, noteColor }) => (
          <div key={label} style={{ padding: '14px 12px', borderRadius: 16, background: '#F8FAFC', border: '1px solid #E2E8F0', boxSizing: 'border-box', minWidth: 0, overflow: 'hidden' }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: '#64748B', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 900, color, fontFamily: 'Outfit, sans-serif', marginTop: 4, lineHeight: 1.1 }}>{value}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: noteColor, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{note}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, alignItems: 'start' }}>
        <div style={{ position: 'relative', background: '#F8FAFC', borderRadius: 24, border: '1.5px solid #E2E8F0', padding: 24, paddingBottom: 58, boxShadow: '0 10px 30px -5px rgba(15,23,42,0.06)', overflow: 'visible' }}>
          {loading && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10 }}>
              <div className="spinner-border text-primary" role="status" />
              <div style={{ marginTop: 8, fontSize: 12, fontWeight: 800, color: '#2563EB' }}>Loading Map...</div>
            </div>
          )}

          {error && (
            <div style={{ position: 'absolute', inset: 16, background: 'rgba(255,255,255,0.95)', borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 10, textAlign: 'center' }}>
              <div style={{ color: '#DC2626', fontSize: 14, fontWeight: 900 }}>⚠️ {error}</div>
              <button onClick={() => window.location.reload()} style={{ marginTop: 12, padding: '6px 16px', background: '#2563EB', color: '#FFF', borderRadius: 8, border: 'none', fontWeight: 800, cursor: 'pointer' }}>
                Retry
              </button>
            </div>
          )}

          <div style={{ width: '100%', height: 'auto' }}>
            <svg ref={svgRef} viewBox="0 0 540 660" style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
              <defs>
                <filter id="stateSoftShadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#0F172A" floodOpacity="0.22" />
                </filter>
                <filter id="districtHighlightGlow" x="-10%" y="-10%" width="120%" height="120%">
                  <feDropShadow dx="0" dy="3" stdDeviation="6" floodColor="#000000" floodOpacity="0.4" />
                </filter>
              </defs>

              <g filter="url(#stateSoftShadow)">
                {featurePointsList.map(({ normName, projected }) => {
                  if (!projected.length) return null
                  const pointsStr = coordsToPoints(projected)
                  const centroid = getCentroid(projected)
                  const count = Number(normalizedCounts[normName]) || 0
                  const isSelected = selectedDistrict && selectedDistrict.toLowerCase() === normName.toLowerCase()
                  const isHovered = hoveredDistrict === normName
                  const isAnimatedActive = currentAnimDistrict === normName
                  const lx = centroid.x
                  const ly = centroid.y
                  const fillColor = isAnimatedActive ? '#F59E0B' : isSelected ? '#1E40AF' : isHovered ? '#FF671F' : getSaffronIntensity(count, maxCount)
                  const lightFill = fillColor === '#E8ECF0' || fillColor === '#FEE0C8' || fillColor === '#FDC09A' || fillColor === '#F59E0B'
                  const textFill = lightFill ? '#1E293B' : '#FFFFFF'

                  const badgeW = Math.max(22, count.toString().length * 7 + 10)

                  return (
                    <g key={normName} style={{ cursor: 'pointer' }} onMouseEnter={() => handleMouseEnter(normName)} onMouseLeave={() => setHoveredDistrict(null)} onClick={() => onSelectDistrict && onSelectDistrict(isSelected ? '' : normName)}>
                      <polygon points={pointsStr} fill={fillColor} stroke="#1a1a1a" strokeWidth={isAnimatedActive || isSelected ? '2' : '0.8'} strokeLinejoin="round" filter={isAnimatedActive || isHovered || isSelected ? 'url(#districtHighlightGlow)' : undefined} style={{ transition: 'fill 0.25s ease, stroke 0.25s ease', opacity: 1 }} />
                      {!compactMap && (
                        <text x={lx} y={count > 0 ? ly - 5 : ly} textAnchor="middle" fill={textFill} fontSize={normName.length > 12 ? '8.5' : normName.length > 9 ? '9.5' : '11.5'} fontWeight="800" fontFamily="Outfit, sans-serif" style={{ pointerEvents: 'none' }}>
                          {normName}
                        </text>
                      )}
                      {!compactMap && count > 0 && (
                        <g transform={`translate(${lx - badgeW / 2}, ${ly + 1})`}>
                          <rect width={badgeW} height="13" rx="3" fill="#0F172A" stroke="#FFFFFF" strokeWidth="1" />
                          <text x={badgeW / 2} y="10" textAnchor="middle" fill="#FFFFFF" fontSize="9.5" fontWeight="900" fontFamily="JetBrains Mono, monospace" style={{ pointerEvents: 'none' }}>{count}</text>
                        </g>
                      )}
                    </g>
                  )
                })}
              </g>
            </svg>
          </div>

          <div className="tn-map-infobar">
            {hoveredDistrict ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <LocationPinIcon size={15} color="#60A5FA" fill="#60A5FA" />
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#60A5FA', fontFamily: 'Outfit, sans-serif' }}>{hoveredDistrict}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                  <span style={{ fontSize: 18, fontWeight: 900, color: '#F59E0B', fontFamily: 'JetBrains Mono, monospace' }}>{(normalizedCounts[hoveredDistrict] || 0).toLocaleString()}</span>
                  <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>{metric.plural}</span>
                </div>
                {hoverDetail && hoverDetail(hoveredDistrict) && (
                  <span style={{ fontSize: 11, color: '#CBD5E1', fontWeight: 700 }}>{hoverDetail(hoveredDistrict)}</span>
                )}
              </>
            ) : (
              <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.03em' }}>
                {isTouch ? '38 Districts • Tap a district to see its count & filter' : '38 Districts • Hover to see count • Click to filter'}
              </span>
            )}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 900, color: '#0F172A', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{metric.directory}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#2563EB' }}>Total: {totalApps}</span>
          </div>

          <div style={{ maxHeight: 540, overflowY: 'auto', paddingRight: 6 }}>
            <div className="tn-district-directory-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {TN_38_DISTRICTS.map((name, idx) => {
                const count = Number(normalizedCounts[name]) || 0
                const distNum = idx + 1
                const isSelected = selectedDistrict && selectedDistrict.toLowerCase() === name.toLowerCase()
                const isAnimatedActive = currentAnimDistrict === name
                const pct = totalApps ? Math.round((count / totalApps) * 100) : 0
                const fontSize = name.length > 14 ? 12 : 13

                return (
                  <div key={name} onClick={() => { setIsPlayingAnimation(false); onSelectDistrict && onSelectDistrict(isSelected ? '' : name) }} style={{ padding: '9px 10px', borderRadius: 14, cursor: 'pointer', background: isAnimatedActive ? '#FEF3C7' : isSelected ? '#2563EB' : count > 0 ? '#EFF6FF' : '#F8FAFC', color: isSelected ? '#FFFFFF' : '#0F172A', border: isAnimatedActive ? '2px solid #F59E0B' : isSelected ? '2px solid #1D4ED8' : count > 0 ? '1.5px solid #BFDBFE' : '1px solid #E2E8F0', transition: 'all 0.15s ease', boxShadow: isAnimatedActive ? '0 4px 12px rgba(245,158,11,0.3)' : isSelected ? '0 4px 12px rgba(37,99,235,0.25)' : 'none', minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, minWidth: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 900, background: isSelected ? 'rgba(255,255,255,0.25)' : '#E2E8F0', color: isSelected ? '#FFFFFF' : '#475569', padding: '1px 4px', borderRadius: 5, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>#{distNum}</span>
                      <LocationPinIcon size={11} color={isSelected ? '#FFFFFF' : count > 0 ? '#F76201' : '#94A3B8'} fill={isSelected ? '#FFFFFF' : count > 0 ? '#F76201' : '#94A3B8'} style={{ flexShrink: 0 }} />
                      <span title={name} style={{ fontSize, fontWeight: 800, fontFamily: 'Outfit, sans-serif', flex: 1, letterSpacing: name.length > 13 ? '-0.3px' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{name}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: isSelected ? 'rgba(255,255,255,0.9)' : '#64748B', whiteSpace: 'nowrap' }}>{pct}% share</span>
                      <span style={{ fontSize: 12, fontWeight: 900, padding: '2px 7px', borderRadius: 7, background: isSelected ? '#FFFFFF' : count > 0 ? '#2563EB' : '#E2E8F0', color: isSelected ? '#2563EB' : count > 0 ? '#FFFFFF' : '#475569', flexShrink: 0 }}>{count}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
