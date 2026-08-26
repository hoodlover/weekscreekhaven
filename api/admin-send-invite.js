import { sendEmail, escapeEmailHtml } from '../_lib/email.js';
import { getInvites } from '../_lib/invite-store.js';
import { json, requireAdmin } from '../_lib/security.js';

function validEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function formatStayDate(value) {
  return value ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00Z`)) : '';
}

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
  try {
    const invite = (await getInvites()).find((item) => item.id === String(request.body?.inviteId || ''));
    if (!invite || invite.revokedAt) return json(response, 404, { error: 'That invite is not active.' });
    const recipientEmail = validEmail(request.body?.recipientEmail || invite.recipientEmail);
    if (!recipientEmail) return json(response, 400, { error: 'Add a valid guest email address.' });
    const guestName = invite.label;
    const url = 'https://www.weekscreekhaven.com/important-info.html';
    const safeName = escapeEmailHtml(guestName);
    const safeCode = escapeEmailHtml(invite.passcode);
    const options = invite.stayOptions || [];
    const optionsText = options.map((option, index) => `Option ${index + 1}: ${formatStayDate(option.arrival)} to ${formatStayDate(option.departure)}${option.costCents ? ` — $${(option.costCents / 100).toFixed(2)}` : ''}${option.expiresOn ? ` — choose by ${formatStayDate(option.expiresOn)} or this option will be released for others` : ''}`).join('\n');
    const optionsHtml = options.map((option, index) => `<li style="margin:0 0 12px"><strong>Option ${index + 1}:</strong> ${formatStayDate(option.arrival)} through ${formatStayDate(option.departure)}${option.costCents ? `<br>Cost: <strong>$${(option.costCents / 100).toFixed(2)}</strong>` : ''}${option.expiresOn ? `<br><span style="color:#8a2f2f">Choose by <strong>${formatStayDate(option.expiresOn)}</strong>. If you do not choose it by then, this option will be released for someone else; any other unexpired choices remain available.</span>` : '<br>This option has no automatic expiration.'}</li>`).join('');
    await sendEmail({
      to: recipientEmail,
      toName: guestName,
      subject: `Your Weeks Creek Haven invitation`,
      text: `Hi ${guestName},\n\nYou’re invited to the Weeks Creek Haven Friends Hub.${optionsText ? `\n\nWe are holding these stay choices for you:\n${optionsText}\n\nOptions with different deadlines expire separately. Choosing one releases the others.` : ''}\n\nOpen: ${url}\nYour code: ${invite.passcode}\n\nEnter your name and the code to unlock the cabin guide${optionsText ? ' and choose your stay' : ''}.`,
      html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">Welcome to Weeks Creek Haven</h1><p>Hi ${safeName},</p><p>You’re invited to the private Friends Hub with everything you’ll need for your stay.</p>${optionsHtml ? `<h2 style="color:#183c2d">Your stay choices</h2><ol>${optionsHtml}</ol><p>Each deadline applies only to that option. Choosing one releases the others.</p>` : ''}<p><a href="${url}" style="display:inline-block;background:#183c2d;color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Open Friends Hub</a></p><p>Your invitation code is <strong style="font-size:20px">${safeCode}</strong>.</p><p>Enter your name and the code when prompted${optionsHtml ? ', then choose the dates that work best' : ''}.</p></div>`,
    });
    return json(response, 200, { ok: true });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: error.message || 'The invitation email could not be sent.' });
  }
}
