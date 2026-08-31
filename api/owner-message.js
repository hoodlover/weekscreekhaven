import { sendEmail, escapeEmailHtml } from '../_lib/email.js';
import { enforceRateLimit, json, rateLimitJson, sameOriginRequest } from '../_lib/security.js';

function safeText(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function safeList(value, maxItems = 20, maxLength = 100) {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => safeText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function validEmail(value) {
  const email = safeText(value, 160).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function row(label, value) {
  return value ? `${label}: ${value}` : '';
}

function htmlRow(label, value) {
  return value ? `<p><strong>${escapeEmailHtml(label)}:</strong> ${escapeEmailHtml(value).replace(/\n/g, '<br>')}</p>` : '';
}

function inquiry(body) {
  const name = safeText(body.name || [body.first_name, body.last_name].filter(Boolean).join(' '), 120);
  const email = validEmail(body.email);
  if (!name || !email) throw new Error('Add your name and a valid email address.');
  const phone = safeText(body.phone, 60);
  const arrival = safeText(body.arrival || body.checkin, 40);
  const departure = safeText(body.departure || body.checkout, 40);
  const guests = safeText(body.guests, 20);
  const source = safeText(body.source, 100);
  const message = safeText(body.message, 2000);
  const lines = [row('Name', name), row('Email', email), row('Phone', phone), row('Arrival', arrival), row('Departure', departure), row('Guests', guests), row('How they found us', source), row('Message', message)].filter(Boolean);
  return {
    subject: `Cabin inquiry from ${name}`,
    text: `A new Weeks Creek Haven inquiry was submitted.\n\n${lines.join('\n')}`,
    html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:640px"><h1 style="color:#183c2d">New cabin inquiry</h1>${htmlRow('Name', name)}${htmlRow('Email', email)}${htmlRow('Phone', phone)}${htmlRow('Arrival', arrival)}${htmlRow('Departure', departure)}${htmlRow('Guests', guests)}${htmlRow('How they found us', source)}${htmlRow('Message', message)}</div>`,
  };
}

function maintenance(body) {
  const location = safeText(body.location, 160);
  const priority = safeText(body.priority, 60);
  const categories = safeList(body['category[]'] || body.category);
  const description = safeText(body.description, 2000);
  if (!location || !priority || !description) throw new Error('Add the location, urgency, and a description of the issue.');
  const urgent = priority === 'high';
  const categoryText = categories.join(', ') || 'No category selected';
  return {
    subject: `${urgent ? 'URGENT · ' : ''}Cabin maintenance report · ${location}`,
    text: `A Weeks Creek Haven maintenance report was submitted.\n\nLocation: ${location}\nPriority: ${priority}\nCategories: ${categoryText}\n\nDescription:\n${description}`,
    html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:640px"><h1 style="color:#183c2d">Cabin maintenance report</h1>${htmlRow('Location', location)}${htmlRow('Priority', priority)}${htmlRow('Categories', categoryText)}${htmlRow('Description', description)}</div>`,
  };
}

function guestbook(body) {
  const guestNames = safeText(body.guest_names, 160);
  const stayStart = safeText(body.stay_start, 40);
  const stayEnd = safeText(body.stay_end, 40);
  const stayDates = safeText(body.stay_dates, 100) || [stayStart, stayEnd].filter(Boolean).join(' through ');
  const favorite = safeText(body.favorite_adventure, 2000);
  const funnyMoment = safeText(body.funny_moment || body.darkest_secret, 2000);
  const guestTip = safeText(body.guest_tip, 1200);
  const feedback = safeText(body.feedback, 2000);
  if (!guestNames || !favorite) throw new Error('Add the guest name and favorite part of the stay.');
  return {
    subject: `Guestbook entry from ${guestNames}`,
    text: `A new Weeks Creek Haven guestbook entry was submitted.\n\nGuest: ${guestNames}\nStay: ${stayDates || 'Not provided'}\n\nFavorite part:\n${favorite}${funnyMoment ? `\n\nFavorite memory:\n${funnyMoment}` : ''}${guestTip ? `\n\nTip for future guests:\n${guestTip}` : ''}${feedback ? `\n\nPrivate note for Lance & Heather:\n${feedback}` : ''}`,
    html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:640px"><h1 style="color:#183c2d">New guestbook entry</h1>${htmlRow('Guest', guestNames)}${htmlRow('Stay', stayDates || 'Not provided')}<h2 style="color:#183c2d">Favorite part</h2><p>${escapeEmailHtml(favorite).replace(/\n/g, '<br>')}</p>${funnyMoment ? `<h2 style="color:#183c2d">Favorite memory</h2><p>${escapeEmailHtml(funnyMoment).replace(/\n/g, '<br>')}</p>` : ''}${guestTip ? `<h2 style="color:#183c2d">Tip for future guests</h2><p>${escapeEmailHtml(guestTip).replace(/\n/g, '<br>')}</p>` : ''}${feedback ? `<h2 style="color:#183c2d">Private note for Lance &amp; Heather</h2><p>${escapeEmailHtml(feedback).replace(/\n/g, '<br>')}</p>` : ''}</div>`,
  };
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
  if (!sameOriginRequest(request)) return json(response, 403, { error: 'This form submission was blocked.' });
  const formType = safeText(request.body?.form_type, 30);
  if (!['inquiry', 'maintenance', 'guestbook'].includes(formType)) return json(response, 400, { error: 'Choose a valid form type.' });
  const rate = enforceRateLimit(request, `owner-message-${formType}`, 6, 15 * 60 * 1000);
  if (!rate.allowed) return rateLimitJson(response, rate);
  if (safeText(request.body?.website, 200)) return json(response, 200, { ok: true });
  if (!process.env.OWNER_EMAIL) return json(response, 503, { error: 'The owner email is not configured.' });

  try {
    const message = formType === 'inquiry' ? inquiry(request.body) : formType === 'maintenance' ? maintenance(request.body) : guestbook(request.body);
    const operationId = safeText(request.body?.operation_id, 100);
    await sendEmail({
      to: process.env.OWNER_EMAIL,
      toName: 'Heather & Lance',
      ...message,
      idempotencyKey: operationId ? `${formType}-${operationId}` : '',
    });
    return json(response, 200, { ok: true });
  } catch (error) {
    const validationError = /^(Add|Choose)\b/.test(error.message || '');
    if (!validationError) console.error(error);
    return json(response, validationError ? 400 : 503, { error: error.message || 'The form could not be delivered.' });
  }
}
