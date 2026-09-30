import { apiRoute } from '../local-server.mjs';

function headerValue(headers, name) {
  const value = headers?.[name];
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? raw.split(',')[0].trim() : '';
}

function rewrittenPath(request, incoming) {
  const queryPath = request.query?.path;
  if (Array.isArray(queryPath)) return queryPath.join('/');
  if (typeof queryPath === 'string' && queryPath) return queryPath;
  return incoming.searchParams.get('path') || '';
}

export function requestUrl(request) {
  const host = headerValue(request.headers, 'x-forwarded-host') || headerValue(request.headers, 'host') || 'vercel.local';
  const proto = headerValue(request.headers, 'x-forwarded-proto') || 'https';
  const incoming = new URL(request.url || '/api', `${proto}://${host}`);
  const path = rewrittenPath(request, incoming);
  const collapsed = incoming.pathname === '/api' || incoming.pathname === '/api/' || incoming.pathname === '/api/index';
  if (!path || !collapsed) return incoming;
  incoming.searchParams.delete('path');
  const url = new URL(`/api/${path.replace(/^\/+/, '')}`, incoming.origin);
  incoming.searchParams.forEach((value, key) => url.searchParams.append(key, value));
  return url;
}

export default async function handler(request, response) {
  return apiRoute(request, response, requestUrl(request));
}
