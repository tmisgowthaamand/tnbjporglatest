import React, { useState, useEffect, useCallback } from 'react';
import API from '../utils/api';
import { Search, RefreshCw, UserX, ChevronLeft, ChevronRight } from 'lucide-react';

const STAGE_LABELS = {
  OTP_VERIFIED: 'OTP Done',
  EPIC_VERIFIED: 'EPIC Found'
};

const STAGE_COLORS = {
  OTP_VERIFIED: { bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
  EPIC_VERIFIED: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' }
};

const maskMobile = (m) => String(m || '');

const formatDate = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
};

const LIMIT = 20;

const IncompleteRegistrationsView = () => {
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [stageFilter, setStageFilter] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit: LIMIT };
      if (search) params.search = search;
      if (stageFilter) params.stage = stageFilter;
      const res = await API.get('/admin/incomplete-registrations', { params });
      setRecords(res.data?.records || []);
      setTotal(res.data?.total || 0);
      setTotalPages(res.data?.totalPages || 1);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [page, search, stageFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const handleStageChange = (val) => {
    setPage(1);
    setStageFilter(val);
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: '10px',
          background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <UserX size={20} color="#dc2626" />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '600', color: '#1d1d1f' }}>
            Incomplete Registrations
          </h2>
          <p style={{ margin: 0, fontSize: '13px', color: '#707070' }}>
            People who verified OTP but never completed scheme registration
          </p>
        </div>
        <button
          onClick={fetchData}
          style={{
            marginLeft: 'auto', background: 'none', border: '1px solid #d2d2d7',
            borderRadius: '8px', padding: '8px 14px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '13px', color: '#474747'
          }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Summary pill */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '20px',
        padding: '6px 14px', marginBottom: '20px',
        fontSize: '13px', color: '#dc2626', fontWeight: '500'
      }}>
        <UserX size={13} />
        {total} incomplete lead{total !== 1 ? 's' : ''} captured
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '6px' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#999' }} />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Mobile, EPIC, name, district…"
              style={{
                paddingLeft: '30px', paddingRight: '12px', paddingTop: '8px', paddingBottom: '8px',
                border: '1px solid #d2d2d7', borderRadius: '8px',
                fontSize: '13px', width: '220px', outline: 'none'
              }}
            />
          </div>
          <button type="submit" style={{
            background: '#1d1d1f', color: '#fff', border: 'none',
            borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '13px'
          }}>
            Search
          </button>
        </form>

        <select
          value={stageFilter}
          onChange={(e) => handleStageChange(e.target.value)}
          style={{
            border: '1px solid #d2d2d7', borderRadius: '8px',
            padding: '8px 12px', fontSize: '13px', outline: 'none', cursor: 'pointer'
          }}
        >
          <option value="">All Stages</option>
          <option value="OTP_VERIFIED">OTP Done (no EPIC)</option>
          <option value="EPIC_VERIFIED">EPIC Found (no submit)</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
          padding: '12px 16px', color: '#dc2626', marginBottom: '16px', fontSize: '13px'
        }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid #e5e5ea' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f5f5f7', borderBottom: '1px solid #e5e5ea' }}>
              {['#', 'Mobile', 'Stage', 'EPIC No.', 'Name', 'District', 'Assembly', 'Captured At', 'Contact'].map((h) => (
                <th key={h} style={{
                  padding: '10px 14px', textAlign: 'left',
                  fontWeight: '600', color: '#474747', whiteSpace: 'nowrap'
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
                  Loading…
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: '#999' }}>
                  No incomplete registrations found.
                </td>
              </tr>
            ) : records.map((r, idx) => {
              const stageStyle = STAGE_COLORS[r.stage] || {};
              return (
                <tr key={r._id} style={{
                  borderBottom: '1px solid #f0f0f0',
                  background: idx % 2 === 0 ? '#ffffff' : '#fafafa'
                }}>
                  <td style={{ padding: '10px 14px', color: '#999' }}>
                    {(page - 1) * LIMIT + idx + 1}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: '500' }}>
                    {maskMobile(r.mobile)}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      background: stageStyle.bg, color: stageStyle.color,
                      border: `1px solid ${stageStyle.border}`,
                      borderRadius: '20px', padding: '3px 10px',
                      fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap'
                    }}>
                      {STAGE_LABELS[r.stage] || r.stage}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#474747' }}>
                    {r.epicNo || '—'}
                  </td>
                  <td style={{ padding: '10px 14px', color: '#1d1d1f' }}>
                    {r.voterName || '—'}
                  </td>
                  <td style={{ padding: '10px 14px', color: '#474747' }}>
                    {r.district || '—'}
                  </td>
                  <td style={{ padding: '10px 14px', color: '#474747' }}>
                    {r.assemblyName || '—'}
                  </td>
                  <td style={{ padding: '10px 14px', color: '#999', whiteSpace: 'nowrap' }}>
                    {formatDate(r.createdAt)}
                  </td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                    {r.mobile && (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <a
                          href={`tel:+91${r.mobile}`}
                          style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #d2d2d7', background: '#fff', color: '#1d1d1f', fontSize: '12px', fontWeight: '600', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
                          title={`Call ${r.mobile}`}
                        >
                          📞 Call
                        </a>
                        <a
                          href={`https://wa.me/91${r.mobile}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#16a34a', fontSize: '12px', fontWeight: '600', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
                          title={`WhatsApp ${r.mobile}`}
                        >
                          💬 WA
                        </a>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '8px', marginTop: '16px'
        }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              background: 'none', border: '1px solid #d2d2d7', borderRadius: '8px',
              padding: '6px 10px', cursor: page === 1 ? 'not-allowed' : 'pointer',
              opacity: page === 1 ? 0.4 : 1, display: 'flex', alignItems: 'center'
            }}
          >
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: '13px', color: '#474747' }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              background: 'none', border: '1px solid #d2d2d7', borderRadius: '8px',
              padding: '6px 10px', cursor: page === totalPages ? 'not-allowed' : 'pointer',
              opacity: page === totalPages ? 0.4 : 1, display: 'flex', alignItems: 'center'
            }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

export default IncompleteRegistrationsView;
