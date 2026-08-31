import { sendEmail, escapeEmailHtml } from '../_lib/email.js';
import { getInvites } from '../_lib/invite-store.js';
import { json, requireAdmin } from '../_lib/security.js';
import { daysBetween, withEstimatedTaxesAndFees } from '../pricing.js';

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
    if (!invite || invite.archivedAt || invite.revokedAt) return json(response, 404, { error: 'That invite is not active.' });
    const recipientEmail = validEmail(request.body?.recipientEmail || invite.recipientEmail);
    if (!recipientEmail) return json(response, 400, { error: 'Add a valid guest email address.' });
    const guestName = invite.label;
    const url = 'https://www.weekscreekhaven.com/important-info.html?invite=1';
    const safeName = escapeEmailHtml(guestName);
    const code = invite.passcode;
    const safeCode = escapeEmailHtml(code);
    const options = invite.stayOptions || [];
    const welcomeMessage = invite.welcomeMessage || 'We’d love for you to enjoy some time at Weeks Creek Haven.';
    const inviteOffer = invite.complimentary
      ? 'This stay is our treat, with no rent, taxes, government lodging fees, or required charges.'
      : invite.recipientPhone
        ? 'We saved your phone number with this invitation, and any matching private Friends & Family rate will appear automatically as you choose dates.'
        : 'Your Friends & Family rate will appear automatically if your phone number matches our private list.';
    const taxFor = (option) => option.costCents && !option.complimentary ? withEstimatedTaxesAndFees({ totalCents: option.costCents, actualNights: daysBetween(option.arrival, option.departure) }) : null;
    const optionsText = options.map((option, index) => { const tax=taxFor(option); return `Option ${index + 1}: ${formatStayDate(option.arrival)} to ${formatStayDate(option.departure)}${option.complimentary?' — complimentary, with no rent, taxes, or government lodging fees':tax ? ` — $${(option.costCents / 100).toFixed(2)} before an estimated $${(tax.estimatedTaxesAndFeesCents / 100).toFixed(2)} in taxes and fees` : ''}${option.expiresOn ? ` — choose by ${formatStayDate(option.expiresOn)} or this option will be released for others` : ''}`; }).join('\n');
    const optionsHtml = options.map((option, index) => { const tax=taxFor(option); return `<li style="margin:0 0 12px"><strong>Option ${index + 1}:</strong> ${formatStayDate(option.arrival)} through ${formatStayDate(option.departure)}${option.complimentary?'<br><strong style="color:#276141">Complimentary stay · no rent, taxes, or government lodging fees</strong>':tax ? `<br>Cost: <strong>$${(option.costCents / 100).toFixed(2)}</strong><br>Does not include an estimated <strong>$${(tax.estimatedTaxesAndFeesCents / 100).toFixed(2)}</strong> in taxes and fees.` : ''}${option.expiresOn ? `<br><span style="color:#8a2f2f">Choose by <strong>${formatStayDate(option.expiresOn)}</strong>. If you do not choose it by then, this option will be released for someone else; any other unexpired choices remain available.</span>` : '<br>This option has no automatic expiration.'}</li>`; }).join('');
    await sendEmail({
      to: recipientEmail,
      toName: guestName,
      templateKey:'guest-invitation', templateVariables:{ guestName, welcomeMessage, inviteOffer, hubUrl:url, inviteCode:code },
      subject: `A little Blue Ridge getaway for you`,
      text: `Hi ${guestName},\n\n${welcomeMessage}\n\n${optionsText ? `We are holding these stay choices for you:\n${optionsText}\n\nOptions with different deadlines expire separately. Choosing one releases the others.` : `Use your private invitation to see the live calendar and choose any open dates that work for you. ${inviteOffer}`}\n\nOpen: ${url}\nYour invitation code: ${code}\n\nThe invitation form opens automatically. Enter your name, then paste the full code or enter just the 8 characters after WCH-.`,
      html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">A little Blue Ridge getaway for you</h1><p>Hi ${safeName},</p><p>${escapeEmailHtml(welcomeMessage)}</p>${optionsHtml ? `<h2 style="color:#183c2d">Your stay choices</h2><ol>${optionsHtml}</ol><p>Each deadline applies only to that option. Choosing one releases the others.</p>` : `<p>Use your private invitation to see the live calendar and choose any open dates that work for you.</p><p style="background:#e8f2e9;padding:12px;border-radius:8px"><strong>${escapeEmailHtml(inviteOffer)}</strong></p>`}<p><a href="${url}" style="display:inline-block;background:#183c2d;color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Open your invitation</a></p><p>Your invitation code is <strong style="font-size:20px;letter-spacing:2px">${safeCode}</strong>.</p><p style="color:#74685e;font-size:13px">The invitation form opens automatically. Enter your name, then paste the full code or enter just the 8 characters after <strong>WCH-</strong>.</p><p>Choose the dates that work best for you.</p></div>`,
    });
    return json(response, 200, { ok: true });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: error.message || 'The invitation email could not be sent.' });
  }
}
