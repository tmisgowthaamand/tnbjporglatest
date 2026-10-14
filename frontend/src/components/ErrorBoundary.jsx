import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Catches JS render errors so one crash doesn't white-screen the whole app.
 * Usage:
 *   <ErrorBoundary>          — full-page fallback (wrap AdminPortal)
 *   <ErrorBoundary inline>   — small inline card (wrap individual sections)
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const msg = this.state.error?.message || 'Unexpected error';

    if (this.props.inline) {
      return (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '14px 18px', borderRadius: '12px',
          background: '#fef2f2', border: '1px solid #fecaca',
          color: '#b91c1c', fontSize: '13px', margin: '8px 0'
        }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <span>This section failed to load. <strong>{msg}</strong></span>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px',
              background: 'none', border: '1px solid #fca5a5', borderRadius: '6px',
              color: '#b91c1c', cursor: 'pointer', padding: '4px 10px', fontSize: '12px'
            }}
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      );
    }

    return (
      <div style={{
        minHeight: '60vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '40px 24px', textAlign: 'center', gap: '16px'
      }}>
        <div style={{
          width: '56px', height: '56px', borderRadius: '50%',
          background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <AlertTriangle size={28} color="#b91c1c" />
        </div>
        <h2 style={{ margin: 0, fontSize: '20px', color: '#1c1c1e', fontWeight: '600' }}>
          Something went wrong
        </h2>
        <p style={{ margin: 0, fontSize: '14px', color: '#6e6e73', maxWidth: '360px' }}>
          {msg}
        </p>
        <button
          onClick={() => this.setState({ hasError: false, error: null })}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '10px 20px', borderRadius: '980px',
            background: '#1c1c1e', color: '#fff',
            border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: '500'
          }}
        >
          <RefreshCw size={14} /> Try Again
        </button>
        <p style={{ margin: 0, fontSize: '12px', color: '#aeaeb2' }}>
          If this keeps happening, refresh the page.
        </p>
      </div>
    );
  }
}

export default ErrorBoundary;
