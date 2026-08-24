const EMAIL_ENDPOINT = 'https://api.sender.net/v2/message/send';

export function emailConfigured() {
  return Boolean(process.env.SENDER_API_TOKEN && process.env.SENDER_FROM_EMAIL);
}

export async function sendEmail({ to, toName = '', subject, text, html }) {
  if (!emailConfigured()) throw new Error('Sender.com is not connected yet.');
  const response = await fetch(EMAIL_ENDPOINT, {
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
  return result;
}

export function escapeEmailHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}
