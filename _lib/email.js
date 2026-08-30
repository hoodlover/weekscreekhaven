import { guestFirstName } from './guest-name.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SENDER_ENDPOINT = 'https://api.sender.net/v2/message/send';

export function emailConfigured() {
  return Boolean(
    (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)
    || (process.env.SENDER_API_TOKEN && process.env.SENDER_FROM_EMAIL),
  );
}

async function sendWithResend({ to, subject, text, html, attachments, idempotencyKey }) {
  const fromName = process.env.RESEND_FROM_NAME || 'Weeks Creek Haven';
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: `${fromName} <${process.env.RESEND_FROM_EMAIL}>`,
      to: [to],
      subject,
      text,
      html,
      ...(process.env.RESEND_REPLY_TO || process.env.OWNER_EMAIL
        ? { reply_to: process.env.RESEND_REPLY_TO || process.env.OWNER_EMAIL }
        : {}),
      ...(attachments?.length ? { attachments } : {}),
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || result.error?.message || 'Resend could not deliver the email.');
  }
  return { ...result, provider: 'resend' };
}

async function sendWithSender({ to, toName, subject, text, html, attachments }) {
  if (attachments?.length) throw new Error('Email attachments require the Resend connection.');
  const response = await fetch(SENDER_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SENDER_API_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      from: {
        email: process.env.SENDER_FROM_EMAIL,
        name: process.env.SENDER_FROM_NAME || 'Weeks Creek Haven',
      },
      to: { email: to, name: toName || to },
      subject,
      text,
      html,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    throw new Error(result.message || 'Sender.com could not deliver the email.');
  }
  return { ...result, provider: 'sender' };
}

export async function sendEmail({ to, toName = '', subject, text, html, attachments = [], idempotencyKey = '', templateKey = '', templateVariables = {} }) {
  if (templateKey) {
    try {
      const { mergeEmailTemplates, renderTemplate } = await import('./email-library.js');
      let savedTemplates = [];
      try {
        const { getBookingCalendar } = await import('./booking-store.js');
        savedTemplates = (await getBookingCalendar()).emailTemplates || [];
      } catch (error) {
        console.error('Saved email templates could not be loaded; using the built-in copy.', error);
      }
      const template = mergeEmailTemplates(savedTemplates).find(item => item.id === templateKey);
      if (template && template.enabled !== false) {
        const variables = template.audience === 'Guest'
          ? { ...templateVariables, guestName: guestFirstName(templateVariables.guestName || toName) }
          : templateVariables;
        if (template.audience === 'Guest') toName = guestFirstName(toName || templateVariables.guestName);
        subject = renderTemplate(template.subject || subject, variables);
        if (template.body) {
          text = renderTemplate(template.body, variables);
          html = `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px">${text.split(/\n{2,}/).map(part => `<p>${escapeEmailHtml(part).replace(/\n/g, '<br>')}</p>`).join('')}</div>`;
        }
      } else if (template?.enabled === false) return { skipped: true, templateKey };
    } catch (error) {
      console.error(`Email template ${templateKey} could not be loaded; using the built-in copy.`, error);
    }
  }
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
    return sendWithResend({ to, toName, subject, text, html, attachments, idempotencyKey });
  }
  if (process.env.SENDER_API_TOKEN && process.env.SENDER_FROM_EMAIL) {
    return sendWithSender({ to, toName, subject, text, html, attachments });
  }
  throw new Error('Transactional email is not connected yet.');
}

export function escapeEmailHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}
