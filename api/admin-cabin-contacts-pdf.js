import { requireAdmin } from '../_lib/security.js';
import { cabinContactsPdfBase64 } from '../_lib/cabin-contacts-pdf.js';

export default async function handler(request, response) {
  if (!requireAdmin(request)) return response.status(401).send('Please sign in as the site owner.');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).send('Method not allowed.');
  }

  const pdf = Buffer.from(cabinContactsPdfBase64, 'base64');
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', 'inline; filename="weeks-creek-haven-cabin-contacts.pdf"');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Content-Length', String(pdf.length));
  return request.method === 'HEAD' ? response.status(200).end() : response.status(200).send(pdf);
}
