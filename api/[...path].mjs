import { apiRoute } from '../local-server.mjs';

export default async function handler(request, response) {
  const url = new URL(request.url || '/api', `https://${request.headers.host || 'vercel.local'}`);
  return apiRoute(request, response, url);
}
