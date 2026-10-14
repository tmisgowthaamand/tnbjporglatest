import React, { useState, useEffect } from 'react';
import API from '../utils/api';

const pctColor = (pct) => {
  if (pct === null || pct === undefined) return { bg: '#f8f9fa', text: '#6c757d', label: '—' };
  if (pct >= 15) return { bg: '#d1f0d9', text: '#155724', label: `${pct}%` };
  if (pct >= 5)  return { bg: '#fff3cd', text: '#856404', label: `${pct}%` };
  return          { bg: '#f8d7da', text: '#842029', label: `${pct}%` };
};

const SHOW_DEFAULT = 20;

const CoverageTable = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    API.get('/admin/coverage')
      .then(res => { if (res.data.success) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ padding: '16px 0', textAlign: 'center', color: '#aaa', fontSize: 13 }}>
      Loading coverage…
    </div>
  );
  if (!data || !data.rows?.length) return null;

  const { type, rows, assemblyName } = data;
  const isBoothLevel = type === 'booth';

  const totalReg  = rows.reduce((s, r) => s + (r.registered || 0), 0);
  const totalRoll = rows.reduce((s, r) => s + (r.roll || 0), 0);
  const overallPct = totalRoll > 0 ? parseFloat(((totalReg / totalRoll) * 100).toFixed(1)) : null;
  const oc = pctColor(overallPct);

  const visible = showAll ? rows : rows.slice(0, SHOW_DEFAULT);

  return (
    <div style={{
      background: '#fff', border: '1px solid #e9ecef',
      borderRadius: 12, padding: '16px', marginBottom: 20,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#212529' }}>
            {isBoothLevel ? `Booth Coverage — ${assemblyName}` : 'Assembly Coverage'}
          </div>
          <div style={{ fontSize: 11, color: '#6c757d', marginTop: 2 }}>
            Registered vs Voter Roll · <span style={{ color: '#138808', fontWeight: 600 }}>■</span> ≥15% &nbsp;
            <span style={{ color: '#856404', fontWeight: 600 }}>■</span> 5–15% &nbsp;
            <span style={{ color: '#842029', fontWeight: 600 }}>■</span> &lt;5%
          </div>
        </div>
        <div style={{
          background: oc.bg, color: oc.text,
          fontWeight: 800, fontSize: 18, lineHeight: 1,
          padding: '6px 12px', borderRadius: 8,
        }}>
          {oc.label}
          <div style={{ fontSize: 9, fontWeight: 500, marginTop: 2, textAlign: 'center' }}>overall</div>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              {isBoothLevel
                ? <th style={th}>Booth</th>
                : <><th style={th}>No.</th><th style={th}>Assembly</th><th style={th}>District</th></>
              }
              <th style={{ ...th, textAlign: 'right' }}>Reg.</th>
              <th style={{ ...th, textAlign: 'right' }}>Roll</th>
              <th style={{ ...th, textAlign: 'center' }}>%</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const c = pctColor(r.pct);
              return (
                <tr key={isBoothLevel ? r.boothNo : r.assemblyNo} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  {isBoothLevel
                    ? <td style={td}>Booth {r.boothNo}</td>
                    : <>
                        <td style={{ ...td, color: '#6c757d' }}>{r.assemblyNo}</td>
                        <td style={td}>{r.assemblyName}</td>
                        <td style={{ ...td, color: '#6c757d', fontSize: 11 }}>{r.district}</td>
                      </>
                  }
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {(r.registered || 0).toLocaleString()}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: '#6c757d', fontVariantNumeric: 'tabular-nums' }}>
                    {(r.roll || 0).toLocaleString()}
                  </td>
                  <td style={{ textAlign: 'center', padding: '5px 8px' }}>
                    <span style={{
                      background: c.bg, color: c.text,
                      fontWeight: 700, fontSize: 11,
                      padding: '2px 7px', borderRadius: 10,
                    }}>
                      {c.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Show more / summary */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <div style={{ fontSize: 11, color: '#6c757d' }}>
          <span style={{ fontWeight: 600, color: '#212529' }}>{totalReg.toLocaleString()}</span> registered &nbsp;/&nbsp;
          <span style={{ fontWeight: 600, color: '#6c757d' }}>{totalRoll.toLocaleString()}</span> voter roll
        </div>
        {rows.length > SHOW_DEFAULT && (
          <button
            onClick={() => setShowAll(p => !p)}
            style={{
              background: 'none', border: '1px solid #dee2e6',
              borderRadius: 6, padding: '3px 10px',
              fontSize: 11, color: '#495057', cursor: 'pointer',
            }}
          >
            {showAll ? 'Show less' : `Show all ${rows.length}`}
          </button>
        )}
      </div>
    </div>
  );
};

const th = {
  padding: '7px 8px', textAlign: 'left',
  fontWeight: 600, color: '#495057',
  borderBottom: '2px solid #dee2e6',
  whiteSpace: 'nowrap',
};
const td = { padding: '5px 8px' };

export default CoverageTable;
