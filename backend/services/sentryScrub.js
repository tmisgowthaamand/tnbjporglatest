/**
 * Sentry beforeSend / beforeSendTransaction hook: removes the BJP WACTO webhook
 * secret (`?key=...`) from every string in an event — request URL, query string,
 * span attributes, breadcrumbs — before it leaves the server.
 */
const KEY_RE = /([?&]key=)[^&#\s"']+/gi;

function scrub(value, depth = 0) {
  if (depth > 12 || value == null) return value;
  if (typeof value === 'string') return value.replace(KEY_RE, '$1[Filtered]');
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    for (const k of Object.keys(value)) {
      // Query strings can arrive without a leading ? (e.g. request.query_string "key=abc").
      if (k === 'query_string' && typeof value[k] === 'string') {
        value[k] = value[k].replace(/(^|&)key=[^&]*/gi, '$1key=[Filtered]');
      } else if (k === 'url.query' || k === 'http.query') {
        value[k] = String(value[k]).replace(/(^|[?&])key=[^&]*/gi, '$1key=[Filtered]');
      } else {
        value[k] = scrub(value[k], depth + 1);
      }
    }
  }
  return value;
}

const scrubSentryEvent = (event) => scrub(event);

module.exports = { scrubSentryEvent };
