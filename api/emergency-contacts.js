import { getContractors } from '../_lib/property-store.js';
import { json } from '../_lib/security.js';

const PUBLIC_CATEGORIES = new Set(['Police / Sheriff', 'Fire & Rescue', 'Hospital / Emergency Care']);

export default async function handler(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
  try {
    const contacts = (await getContractors())
      .filter((item) => PUBLIC_CATEGORIES.has(item.category) && item.phone)
      .map(({ id, name, category, phone, services, scheduling, notes, updatedAt }) => ({ id, name, category, phone, services, scheduling, notes, updatedAt }));
    return json(response, 200, { contacts }, { 'Cache-Control': 'public, max-age=60, s-maxage=300' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'Emergency contacts are temporarily unavailable.' });
  }
}
