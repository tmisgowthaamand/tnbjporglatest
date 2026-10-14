import React, { useLayoutEffect, useRef, useState } from 'react'

// Measure full titles in the card's actual font and available space. Keep the
// complete application array in the caller for My Schemes and text sharing.
export default function WelfareCardSchemes({ titles, moreLabel, onViewMore, viewMySchemesText }) {
  const hostRef = useRef(null)
  const measureRef = useRef(null)
  const moreRef = useRef(null)
  const [visibleCount, setVisibleCount] = useState(0)
  // Display up to 5 schemes on the card
  const candidates = titles.slice(0, 5)

  useLayoutEffect(() => {
    let active = true
    const measure = () => {
      if (!active) return
      const host = hostRef.current
      if (!host || !measureRef.current || !moreRef.current) return
      const rows = Array.from(measureRef.current.children)
      const top = measureRef.current.getBoundingClientRect().top
      const available = host.clientHeight
      const fits = (count, reserve) => count === 0 ||
        rows[count - 1].getBoundingClientRect().bottom - top <= available - reserve - 1
      let count = rows.length
      if (titles.length > count || !fits(count, 0)) {
        const reserve = moreRef.current.getBoundingClientRect().height + 8
        while (count > 0 && !fits(count, reserve)) count--
      }
      setVisibleCount(count)
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (hostRef.current) observer.observe(hostRef.current)
    if (measureRef.current) observer.observe(measureRef.current)
    if (moreRef.current) observer.observe(moreRef.current)
    document.fonts?.ready?.then(measure)
    return () => { active = false; observer.disconnect() }
  }, [titles, moreLabel, viewMySchemesText])

  const row = (title, index) => (
    <div key={index} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
      <span style={{ color: '#f76201', fontSize: 10, flexShrink: 0, marginTop: 2 }}>✦</span>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere', fontSize: 11, color: '#0f172a', lineHeight: 1.35, fontWeight: 500 }}>{title}</span>
    </div>
  )
  const listStyle = { display: 'flex', flexDirection: 'column', gap: 5 }
  const moreStyle = { fontSize: 10, lineHeight: 1.3, fontWeight: 700, color: '#c2410c', overflowWrap: 'anywhere' }
  const remaining = titles.length - visibleCount

  return (
    <div ref={hostRef} data-welfare-schemes style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <div aria-hidden="true" data-html2canvas-ignore style={{ position: 'absolute', inset: '0 0 auto', visibility: 'hidden', pointerEvents: 'none' }}>
        <div ref={measureRef} style={listStyle}>{candidates.map(row)}</div>
        <div ref={moreRef} style={{ ...moreStyle, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', border: '1px solid transparent' }}>
          <span>{moreLabel(titles.length)}</span>
          {onViewMore && <span style={{ fontSize: 9.5, fontWeight: 800 }}>{viewMySchemesText || 'View in My Schemes'} →</span>}
        </div>
      </div>
      <div data-welfare-visible style={listStyle}>{candidates.slice(0, visibleCount).map(row)}</div>
      {remaining > 0 && (
        <div
          data-welfare-more
          onClick={onViewMore}
          role={onViewMore ? 'button' : undefined}
          tabIndex={onViewMore ? 0 : undefined}
          title={viewMySchemesText || 'View in My Schemes'}
          style={{
            ...moreStyle,
            marginTop: visibleCount ? 6 : 0,
            cursor: onViewMore ? 'pointer' : 'default',
            display: 'inline-flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 5,
            padding: '3px 8px',
            background: 'rgba(247, 98, 1, 0.08)',
            borderRadius: 6,
            border: '1px solid rgba(247, 98, 1, 0.25)',
            transition: 'background 0.15s'
          }}
          onMouseEnter={(e) => { if (onViewMore) e.currentTarget.style.background = 'rgba(247, 98, 1, 0.16)' }}
          onMouseLeave={(e) => { if (onViewMore) e.currentTarget.style.background = 'rgba(247, 98, 1, 0.08)' }}
        >
          <span>{moreLabel(remaining)}</span>
          {onViewMore && (
            <span style={{ fontSize: 9.5, fontWeight: 800, color: '#f76201', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {viewMySchemesText || 'View in My Schemes'} →
            </span>
          )}
        </div>
      )}
    </div>
  )
}
