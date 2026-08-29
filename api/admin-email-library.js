import { appendBookingRecord, getBookingCalendar } from '../_lib/booking-store.js';
import { DEFAULT_EMAIL_TEMPLATES, mergeEmailTemplates } from '../_lib/email-library.js';
import { json, requireAdmin } from '../_lib/security.js';

const clean = (value, max) => String(value || '').trim().slice(0, max);

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  try {
    const calendar = await getBookingCalendar();
    if (request.method === 'GET') return json(response, 200, { templates: mergeEmailTemplates(calendar.emailTemplates), availableTriggers: [...new Set(DEFAULT_EMAIL_TEMPLATES.map(item => item.trigger))] }, { 'Cache-Control':'no-store' });
    if (!['POST','PATCH','DELETE'].includes(request.method)) return json(response, 405, { error:'Method not allowed.' });
    const id = clean(request.body?.id, 80) || `custom-${crypto.randomUUID()}`;
    if (request.method === 'DELETE') {
      if (DEFAULT_EMAIL_TEMPLATES.some(item => item.id === id)) return json(response, 409, { error:'Built-in messages can be disabled but not deleted.' });
      await appendBookingRecord({ type:'email_template_removed', templateId:id, createdAt:new Date().toISOString() });
      return json(response, 200, { ok:true });
    }
    const current = mergeEmailTemplates(calendar.emailTemplates).find(item => item.id === id);
    const template = {
      ...(current || {}), id,
      name:clean(request.body?.name,120), audience:['Guest','Owner'].includes(request.body?.audience)?request.body.audience:'Guest',
      schedule:clean(request.body?.schedule,240), trigger:clean(request.body?.trigger,80), exception:clean(request.body?.exception,500),
      subject:clean(request.body?.subject,180), body:clean(request.body?.body,5000), enabled:request.body?.enabled !== false,
      system:Boolean(current?.system || DEFAULT_EMAIL_TEMPLATES.some(item => item.id === id)), updatedAt:new Date().toISOString(),
    };
    if (!template.name || !template.schedule || !template.trigger || !template.subject || !template.body) return json(response, 400, { error:'Name, schedule, trigger, subject, and message are required.' });
    await appendBookingRecord({ type:'email_template_saved', template, createdAt:template.updatedAt });
    return json(response, 200, { ok:true, template });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error:error.message || 'The email library could not be updated.' });
  }
}
