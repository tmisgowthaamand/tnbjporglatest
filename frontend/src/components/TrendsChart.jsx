import React, { useState, useEffect } from 'react';
import API from '../utils/api';

const TrendsChart = ({ days = 14 }) => {
  const [trends, setTrends] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    API.get(`/admin/trends?days=${days}`)
      .then(res => { if (res.data.success) setTrends(res.data.trends); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) return (
    <div style={{ padding: '16px 0', textAlign: 'center', color: '#aaa', fontSize: 13 }}>
      Loading trends…
    </div>
  );
  if (!trends.length) return null;

  const max = Math.max(...trends.map(t => t.count), 1);
  const total = trends.reduce((s, t) => s + t.count, 0);
  const today = trends[trends.length - 1]?.count ?? 0;

  const CHART_H = 72;
  const LABEL_H = 16;
  const SVG_H = CHART_H + LABEL_H;
  const n = trends.length;

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e9ecef',
      borderRadius: 12,
      padding: '16px 16px 12px',
      marginBottom: 20,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#212529' }}>
            Daily Registrations
          </div>
          <div style={{ fontSize: 11, color: '#6c757d', marginTop: 2 }}>
            Last {days} days
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#FF9933', lineHeight: 1 }}>
            {today.toLocaleString()}
          </div>
          <div style={{ fontSize: 10, color: '#6c757d', marginTop: 2 }}>today</div>
        </div>
      </div>

      {/* SVG bar chart */}
      <svg
        viewBox={`0 0 300 ${SVG_H}`}
        style={{ width: '100%', height: SVG_H, display: 'block', overflow: 'visible' }}
        aria-label={`Registration trend: ${total} total over ${days} days`}
      >
        {trends.map((t, i) => {
          const slotW = 300 / n;
          const barW = Math.max(slotW - 3, 2);
          const x = i * slotW + (slotW - barW) / 2;
          const barH = t.count > 0
            ? Math.max((t.count / max) * CHART_H, 4)
            : 2;
          const y = CHART_H - barH;
          const isToday = i === n - 1;
          const fill = isToday ? '#FF9933' : '#138808';

          // Show label every 2nd bar (or always for ≤7 days)
          const showLabel = n <= 7 || i % 2 === 0 || isToday;
          const label = t.date.slice(5); // MM-DD

          return (
            <g key={t.date}>
              <rect
                x={x} y={y} width={barW} height={barH}
                fill={fill} opacity={isToday ? 1 : 0.7} rx={2}
              />
              {t.count > 0 && barH > 14 && (
                <text
                  x={x + barW / 2} y={y + 10}
                  textAnchor="middle" fontSize={7} fill="#fff" fontWeight="700"
                >
                  {t.count}
                </text>
              )}
              {showLabel && (
                <text
                  x={x + barW / 2} y={CHART_H + LABEL_H - 2}
                  textAnchor="middle" fontSize={6.5}
                  fill={isToday ? '#FF9933' : '#adb5bd'}
                  fontWeight={isToday ? '700' : '400'}
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Footer */}
      <div style={{ marginTop: 8, fontSize: 11, color: '#6c757d', textAlign: 'right' }}>
        <span style={{ color: '#212529', fontWeight: 600 }}>{total.toLocaleString()}</span> total registrations
      </div>
    </div>
  );
};

export default TrendsChart;
