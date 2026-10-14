// v2.0 - Booth President feature
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import App from './App.jsx';
import './index.css';
import './styles/global.css';
import './styles/admin.css';
import './styles/admin-medialist.css';

Sentry.init({
  dsn: 'https://5b300f6a5087c1e9142ccd512d51a4a6@o4512071928184832.ingest.de.sentry.io/4512071949549648',
  environment: import.meta.env.MODE,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
  ],
  tracesSampleRate: 0.2,
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,
  // Drop SecurityErrors about localStorage — these come from sandboxed WebViews
  // and private browsers where storage is blocked. The app already degrades
  // gracefully; Sentry's own replay init is what throws in those environments.
  beforeSend(event) {
    const err = event.exception?.values?.[0];
    if (
      err?.type === 'SecurityError' &&
      typeof err?.value === 'string' &&
      err.value.includes('localStorage')
    ) {
      return null;
    }
    return event;
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
