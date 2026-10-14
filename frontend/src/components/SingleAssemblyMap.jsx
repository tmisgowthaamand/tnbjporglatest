import React, { useState, useEffect, useMemo } from 'react'
import '../styles/tn-map.css'

function getFirstRing(geometry) {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return geometry.coordinates?.[0] || []
  if (geometry.type === 'MultiPolygon') return geometry.coordinates?.[0]?.[0] || []
  return []
}

function projectCoords(coords, bbox, width = 480, height = 400) {
  const { minLng, maxLng, minLat, maxLat } = bbox
  const rangeX = maxLng - minLng || 1
  const rangeY = maxLat - minLat || 1
  return coords.map(([lng, lat]) => {
    const x = ((lng - minLng) / rangeX) * (width - 80) + 40
    const y = height - (((lat - minLat) / rangeY) * (height - 80) + 40)
    return { x: parseFloat(x.toFixed(1)), y: parseFloat(y.toFixed(1)) }
  })
}

function coordsToPoints(pts) {
  return pts.map(p => `${p.x},${p.y}`).join(' ')
}

function getBbox(coords) {
  let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90
  coords.forEach(([lng, lat]) => {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  })
  return { minLng, maxLng, minLat, maxLat }
}

export default function SingleAssemblyMap({ assemblyName, statsData }) {
  const [geoJson, setGeoJson] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch('/tn-assemblies.geojson')
      .then(r => r.json())
      .then(data => { setGeoJson(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const feature = useMemo(() => {
    if (!geoJson?.features || !assemblyName) return null
    const lower = assemblyName.trim().toLowerCase()
    return geoJson.features.find(f =>
      (f.properties?.AC_NAME || '').trim().toLowerCase() === lower
    ) || null
  }, [geoJson, assemblyName])

  const { projected, bbox } = useMemo(() => {
    if (!feature) return { projected: [], bbox: null }
    const ring = getFirstRing(feature.geometry)
    const b = getBbox(ring)
    return { projected: projectCoords(ring, b, 480, 400), bbox: b }
  }, [feature])

  const total = statsData?.overview?.totalApplications || 0
  const approved = statsData?.overview?.statusBreakdown?.Approved || 0
  const pending = total - approved

  if (!assemblyName) return null

  return (
    <div style={{ marginBottom: 24, padding: '24px 28px', background: '#FFFFFF', borderRadius: 24, border: '1px solid #E2E8F0', boxShadow: '0 8px 30px -6px rgba(15,23,42,0.06)' }}>
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#D97706', background: '#FEF3C7', padding: '4px 12px', borderRadius: 8 }}>
          Assembly Constituency
        </span>
        <h2 style={{ margin: '6px 0 0 0', fontSize: 22, fontWeight: 900, color: '#0F172A', fontFamily: 'Outfit, sans-serif' }}>
          {assemblyName.toUpperCase()}
        </h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Applications', value: total, color: '#0F172A', note: '✓ Live DB', noteColor: '#059669' },
          { label: 'Approved', value: approved, color: '#059669', note: 'Benefit Directives', noteColor: '#64748B' },
          { label: 'Pending', value: pending, color: '#D97706', note: 'Awaiting Processing', noteColor: '#64748B' },
        ].map(({ label, value, color, note, noteColor }) => (
          <div key={label} style={{ padding: '12px', borderRadius: 14, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#64748B', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 900, color, fontFamily: 'Outfit, sans-serif', marginTop: 4, lineHeight: 1.1 }}>{value.toLocaleString()}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: noteColor, marginTop: 4 }}>{note}</div>
          </div>
        ))}
      </div>

      <div style={{ position: 'relative', background: '#F8FAFC', borderRadius: 20, border: '1.5px solid #E2E8F0', padding: 24, paddingBottom: 52, overflow: 'hidden' }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, gap: 10, color: '#64748B', fontSize: 13, fontWeight: 700 }}>
            <div className="tn-map-spinner" />
            Loading map...
          </div>
        )}

        {!loading && !feature && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#94A3B8', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
            Map boundary not found for {assemblyName}
          </div>
        )}

        {!loading && feature && projected.length > 0 && (
          <div style={{ width: '100%', maxWidth: 520, margin: '0 auto' }}>
            <svg viewBox="0 0 480 400" style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
              <defs>
                <filter id="singleGlow" x="-15%" y="-15%" width="130%" height="130%">
                  <feDropShadow dx="0" dy="8" stdDeviation="14" floodColor="#0F172A" floodOpacity="0.18" />
                </filter>
                <filter id="singleHover" x="-10%" y="-10%" width="120%" height="120%">
                  <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor="#FF671F" floodOpacity="0.5" />
                </filter>
              </defs>
              <polygon
                points={coordsToPoints(projected)}
                fill={hovered ? '#FF671F' : '#F76201'}
                stroke="#1a1a1a"
                strokeWidth="1.5"
                strokeLinejoin="round"
                filter={hovered ? 'url(#singleHover)' : 'url(#singleGlow)'}
                style={{ transition: 'fill 0.2s ease', cursor: 'default' }}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
              />
              <text
                x="240"
                y="200"
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize="16"
                fontWeight="900"
                fontFamily="Outfit, sans-serif"
                style={{ pointerEvents: 'none' }}
              >
                {assemblyName}
              </text>
              <text
                x="240"
                y="222"
                textAnchor="middle"
                fill="rgba(255,255,255,0.85)"
                fontSize="11"
                fontWeight="700"
                fontFamily="JetBrains Mono, monospace"
                style={{ pointerEvents: 'none' }}
              >
                {total} applications
              </text>
            </svg>
          </div>
        )}

        <div className="tn-map-infobar">
          {hovered ? (
            <>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#60A5FA', fontFamily: 'Outfit, sans-serif' }}>
                {assemblyName}
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                <span style={{ fontSize: 18, fontWeight: 900, color: '#F59E0B', fontFamily: 'JetBrains Mono, monospace' }}>{total.toLocaleString()}</span>
                <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>applications</span>
              </div>
            </>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.03em' }}>
              Your assembly boundary — hover to see count
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
