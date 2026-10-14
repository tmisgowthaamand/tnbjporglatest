import React, { useState, useEffect, useMemo } from 'react'
import '../styles/tn-map.css'

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

function getFirstRing(geometry) {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return geometry.coordinates?.[0] || []
  if (geometry.type === 'MultiPolygon') return geometry.coordinates?.[0]?.[0] || []
  return []
}

function getAllCoords(geometry) {
  if (!geometry) return []
  if (geometry.type === 'Polygon') {
    return (geometry.coordinates || []).flat()
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates || []).flat(2)
  }
  return []
}

function projectCoords(coords, bbox, width = 540, height = 520) {
  const { minLng, maxLng, minLat, maxLat } = bbox
  const rangeX = maxLng - minLng || 1
  const rangeY = maxLat - minLat || 1
  return coords.map(([lng, lat]) => {
    const x = ((lng - minLng) / rangeX) * (width - 60) + 30
    const y = height - (((lat - minLat) / rangeY) * (height - 60) + 30)
    return { x: parseFloat(x.toFixed(1)), y: parseFloat(y.toFixed(1)) }
  })
}

function coordsToPoints(pointsArr) {
  return pointsArr.map((p) => `${p.x},${p.y}`).join(' ')
}

function getCentroid(pointsArr) {
  if (!pointsArr.length) return { x: 0, y: 0 }
  let cx = 0, cy = 0
  pointsArr.forEach((p) => { cx += p.x; cy += p.y })
  return { x: cx / pointsArr.length, y: cy / pointsArr.length }
}

export default function AssemblyMap({ districtFilter, assemblyStats = [], onSelectAssembly, selectedAssembly = '' }) {
  const [geoJson, setGeoJson] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hoveredAssembly, setHoveredAssembly] = useState(null)

  useEffect(() => {
    setLoading(true)
    fetch('/tn-assemblies.geojson')
      .then((r) => r.json())
      .then((data) => { setGeoJson(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const districtFeatures = useMemo(() => {
    if (!geoJson?.features || !districtFilter) return []
    const filterUpper = districtFilter.toUpperCase()
    return geoJson.features.filter(
      (f) => (f.properties?.district || '').toUpperCase() === filterUpper
    )
  }, [geoJson, districtFilter])

  const assemblyCounts = useMemo(() => {
    const map = {}
    assemblyStats.forEach((d) => {
      const name = d._id?.assembly || d._id?.assemblyName
      const count = d.total ?? d.totalApps ?? 0
      if (name) map[name.trim().toLowerCase()] = count
    })
    return map
  }, [assemblyStats])

  const maxCount = useMemo(() => Math.max(...Object.values(assemblyCounts), 1), [assemblyCounts])
  const totalApps = useMemo(() => Object.values(assemblyCounts).reduce((a, b) => a + b, 0), [assemblyCounts])

  const geoBbox = useMemo(() => {
    if (!districtFeatures.length) return { minLng: 76.0, maxLng: 80.6, minLat: 8.0, maxLat: 13.6 }
    let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90
    districtFeatures.forEach((feat) => {
      getAllCoords(feat.geometry).forEach(([lng, lat]) => {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      })
    })
    return { minLng, maxLng, minLat, maxLat }
  }, [districtFeatures])

  const featurePointsList = useMemo(() => {
    return districtFeatures.map((feat) => {
      const name = feat.properties?.AC_NAME || 'Assembly'
      const rawCoords = getFirstRing(feat.geometry)
      const projected = projectCoords(rawCoords, geoBbox, 540, 520)
      return { name, projected, acNo: feat.properties?.AC_NO }
    })
  }, [districtFeatures, geoBbox])

  const activeCount = useMemo(() => Object.values(assemblyCounts).filter((c) => c > 0).length, [assemblyCounts])

  if (!districtFilter) return null

  return (
    <div style={{ marginBottom: 24, padding: '24px 28px', background: '#FFFFFF', borderRadius: 24, border: '1px solid #E2E8F0', boxShadow: '0 8px 30px -6px rgba(15,23,42,0.06)' }}>
      <div style={{ marginBottom: 18 }}>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#D97706', background: '#FEF3C7', padding: '4px 12px', borderRadius: 8 }}>
          District View
        </span>
        <h2 style={{ margin: '6px 0 0 0', fontSize: 22, fontWeight: 900, color: '#0F172A', fontFamily: 'Outfit, sans-serif' }}>
          {districtFilter} — ASSEMBLY MAP
        </h2>
        <div style={{ fontSize: 13, color: '#64748B', marginTop: 4, fontWeight: 600 }}>
          {districtFeatures.length} assembly constituencies
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Applications', value: totalApps, color: '#0F172A', noteColor: '#059669', note: '✓ Live DB' },
          { label: 'Active Assemblies', value: `${activeCount} / ${districtFeatures.length}`, color: '#D97706', noteColor: '#64748B', note: 'With Submissions' },
          { label: 'Peak Assembly', value: maxCount, color: '#DC2626', noteColor: '#64748B', note: 'Max count' },
        ].map(({ label, value, color, note, noteColor }) => (
          <div key={label} style={{ padding: '12px', borderRadius: 14, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#64748B', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color, fontFamily: 'Outfit, sans-serif', marginTop: 4, lineHeight: 1.1 }}>{value}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: noteColor, marginTop: 4 }}>{note}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, alignItems: 'start' }}>
        <div style={{ position: 'relative', background: '#F8FAFC', borderRadius: 20, border: '1.5px solid #E2E8F0', padding: 20, paddingBottom: 52, overflow: 'hidden' }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, gap: 10, color: '#64748B', fontSize: 13, fontWeight: 700 }}>
              <div className="tn-map-spinner" />
              Loading assembly map...
            </div>
          )}

          {!loading && districtFeatures.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#94A3B8', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
              No assembly data found for {districtFilter}
            </div>
          )}

          {!loading && districtFeatures.length > 0 && (
            <div style={{ width: '100%', height: 'auto' }}>
              <svg viewBox="0 0 540 520" style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
                <defs>
                  <filter id="assemblyGlow" x="-10%" y="-10%" width="120%" height="120%">
                    <feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#000000" floodOpacity="0.35" />
                  </filter>
                  <filter id="assemblyShadow" x="-15%" y="-15%" width="130%" height="130%">
                    <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#0F172A" floodOpacity="0.18" />
                  </filter>
                </defs>

                <g filter="url(#assemblyShadow)">
                  {featurePointsList.map(({ name, projected, acNo }) => {
                    if (!projected.length) return null
                    const pointsStr = coordsToPoints(projected)
                    const centroid = getCentroid(projected)
                    const count = Number(assemblyCounts[name.trim().toLowerCase()]) || 0
                    const isSelected = selectedAssembly && selectedAssembly.toLowerCase() === name.toLowerCase()
                    const isHovered = hoveredAssembly === name
                    const fillColor = isSelected ? '#1E40AF' : isHovered ? '#FF671F' : getSaffronIntensity(count, maxCount)
                    const lightFill = ['#E8ECF0', '#FEE0C8', '#FDC09A'].includes(fillColor)
                    const textFill = lightFill ? '#1E293B' : '#FFFFFF'
                    const shortName = name.length > 16 ? name.slice(0, 14) + '…' : name

                    return (
                      <g
                        key={name}
                        style={{ cursor: onSelectAssembly ? 'pointer' : 'default' }}
                        onMouseEnter={() => setHoveredAssembly(name)}
                        onMouseLeave={() => setHoveredAssembly(null)}
                        onClick={() => onSelectAssembly && onSelectAssembly(isSelected ? '' : name)}
                      >
                        <polygon
                          points={pointsStr}
                          fill={fillColor}
                          stroke="#1a1a1a"
                          strokeWidth={isSelected || isHovered ? '1.8' : '0.6'}
                          strokeLinejoin="round"
                          filter={isSelected || isHovered ? 'url(#assemblyGlow)' : undefined}
                          style={{ transition: 'fill 0.2s ease' }}
                        />
                        <text
                          x={centroid.x}
                          y={count > 0 ? centroid.y - 4 : centroid.y + 3}
                          textAnchor="middle"
                          fill={textFill}
                          fontSize="7"
                          fontWeight="700"
                          fontFamily="Outfit, sans-serif"
                          style={{ pointerEvents: 'none' }}
                        >
                          {shortName}
                        </text>
                        {count > 0 && (
                          <g transform={`translate(${centroid.x - 9}, ${centroid.y + 3})`}>
                            <rect width="18" height="10" rx="4" fill="#0F172A" stroke="#FFFFFF" strokeWidth="0.8" />
                            <text x="9" y="7.5" textAnchor="middle" fill="#FFFFFF" fontSize="6.5" fontWeight="900" fontFamily="JetBrains Mono, monospace" style={{ pointerEvents: 'none' }}>{count}</text>
                          </g>
                        )}
                      </g>
                    )
                  })}
                </g>
              </svg>
            </div>
          )}

          <div className="tn-map-infobar">
            {hoveredAssembly ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#60A5FA', fontFamily: 'Outfit, sans-serif' }}>{hoveredAssembly}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                  <span style={{ fontSize: 18, fontWeight: 900, color: '#F59E0B', fontFamily: 'JetBrains Mono, monospace' }}>{(assemblyCounts[(hoveredAssembly || '').trim().toLowerCase()] || 0).toLocaleString()}</span>
                  <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>applications</span>
                </div>
              </>
            ) : (
              <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.03em' }}>
                {districtFeatures.length} assemblies • Hover to see count
              </span>
            )}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 13, fontWeight: 900, color: '#0F172A', marginBottom: 12 }}>
            ASSEMBLY DIRECTORY
          </div>
          <div style={{ maxHeight: 500, overflowY: 'auto', paddingRight: 4 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {featurePointsList
                .map(({ name, acNo }) => ({
                  name,
                  acNo,
                  count: Number(assemblyCounts[name.trim().toLowerCase()]) || 0,
                }))
                .sort((a, b) => b.count - a.count)
                .map(({ name, acNo, count }) => {
                  const isSelected = selectedAssembly && selectedAssembly.toLowerCase() === name.toLowerCase()
                  const pct = totalApps ? Math.round((count / totalApps) * 100) : 0
                  return (
                    <div
                      key={name}
                      onClick={() => onSelectAssembly && onSelectAssembly(isSelected ? '' : name)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        borderRadius: 12,
                        cursor: onSelectAssembly ? 'pointer' : 'default',
                        background: isSelected ? '#2563EB' : count > 0 ? '#EFF6FF' : '#F8FAFC',
                        color: isSelected ? '#FFFFFF' : '#0F172A',
                        border: isSelected ? '2px solid #1D4ED8' : count > 0 ? '1.5px solid #BFDBFE' : '1px solid #E2E8F0',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span style={{ fontSize: 9, fontWeight: 900, background: isSelected ? 'rgba(255,255,255,0.2)' : '#E2E8F0', color: isSelected ? '#FFFFFF' : '#475569', padding: '1px 4px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0, minWidth: 28, textAlign: 'center' }}>
                        {acNo}
                      </span>
                      <span style={{ flex: 1, fontSize: 12, fontWeight: 700, fontFamily: 'Outfit, sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {name}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: isSelected ? 'rgba(255,255,255,0.8)' : '#94A3B8', flexShrink: 0 }}>{pct}%</span>
                      <span style={{ fontSize: 11, fontWeight: 900, padding: '2px 8px', borderRadius: 6, background: isSelected ? '#FFFFFF' : count > 0 ? '#2563EB' : '#E2E8F0', color: isSelected ? '#2563EB' : count > 0 ? '#FFFFFF' : '#94A3B8', flexShrink: 0, minWidth: 28, textAlign: 'center' }}>
                        {count}
                      </span>
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
