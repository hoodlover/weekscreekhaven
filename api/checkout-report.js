import { appendBookingRecord, getBookingRequests } from '../_lib/booking-store.js';
import { sendEmail, escapeEmailHtml } from '../_lib/email.js';
import { enforceRateLimit, json, rateLimitJson, sameOriginRequest, verifyAgreementToken } from '../_lib/security.js';

function safeText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function safeList(value, maxItems = 20, maxLength = 100) {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => safeText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function selectedStay(booking) {
  const choices = booking?.dateChoices || [];
  return choices[Number.isInteger(booking?.approvedChoice) ? booking.approvedChoice : 0] || choices[0] || {};
}

function textList(items) {
  return items.length ? items.map((item) => `• ${item}`).join('\n') : 'None reported';
}

function htmlList(items) {
  return items.length ? `<ul>${items.map((item) => `<li>${escapeEmailHtml(item)}</li>`).join('')}</ul>` : '<p>None reported</p>';
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
  if (!sameOriginRequest(request)) return json(response, 403, { error: 'This checkout report was blocked.' });
  const rate = enforceRateLimit(request, 'checkout-report', 8, 15 * 60 * 1000);
  if (!rate.allowed) return rateLimitJson(response, rate);

  try {
    const rawToken = safeText(request.body?.booking_token || request.body?.token, 2400);
    const token = rawToken ? verifyAgreementToken(rawToken) : null;
    if (rawToken && !token) return json(response, 401, { error: 'This checkout link is invalid or has expired.' });

    const bookings = token ? await getBookingRequests() : [];
    const booking = token ? bookings.find((item) => item.id === token.bookingId) : null;
    if (token && !booking) return json(response, 404, { error: 'This booking could not be found.' });
    if (booking && ['cancelled', 'declined'].includes(booking.status)) return json(response, 409, { error: 'This booking is no longer active.' });
    if (booking?.checkoutReportSentAt) return json(response, 200, { ok: true, alreadyReceived: true });
    if (!process.env.OWNER_EMAIL) return json(response, 503, { error: 'The owner checkout email is not configured.' });

    const guestName = booking?.name || safeText(request.body?.guest_names, 120);
    if (!guestName) return json(response, 400, { error: 'Add your name before sending the checkout report.' });
    const guestPhone = safeText(request.body?.guest_phone, 60);
    const restock = safeList(request.body?.['restock[]'] || request.body?.restock);
    const maintenanceCategories = safeList(request.body?.['maintenance_category[]'] || request.body?.maintenance_category);
    const maintenanceLocation = safeText(request.body?.maintenance_location, 160);
    const maintenancePriority = safeText(request.body?.maintenance_priority, 100);
    const maintenanceIssue = safeText(request.body?.maintenance_issue, 1500);
    const nothingToReport = Boolean(request.body?.maintenance_none);
    const checklistCompleted = String(request.body?.checklist_completed || '').toLowerCase() === 'true';
    const checklistItems = safeList(request.body?.checklist_items, 20, 100);
    const checklistExpected = safeList(request.body?.checklist_expected, 20, 100);
    const stay = selectedStay(booking);
    const stayLabel = stay.arrival && stay.departure ? `${stay.arrival} through ${stay.departure}` : 'Booking not linked';
    const urgent = /urgent/i.test(maintenancePriority);
    const completedAt = new Date().toISOString();
    const report = {
      guestName,
      guestPhone,
      restock,
      maintenanceCategories,
      maintenanceLocation,
      maintenancePriority,
      maintenanceIssue,
      nothingToReport,
      checklistCompleted,
      checklistItems,
      checklistExpected,
      submittedAt: completedAt,
    };

    const maintenanceSummary = nothingToReport && !maintenanceCategories.length && !maintenanceIssue
      ? 'Nothing needs attention'
      : [maintenanceCategories.length ? textList(maintenanceCategories) : '', maintenanceLocation ? `Location: ${maintenanceLocation}` : '', maintenancePriority ? `Priority: ${maintenancePriority}` : '', maintenanceIssue ? `Details: ${maintenanceIssue}` : ''].filter(Boolean).join('\n');
    const maintenanceHtml = nothingToReport && !maintenanceCategories.length && !maintenanceIssue
      ? '<p>Nothing needs attention</p>'
      : `${htmlList(maintenanceCategories)}${maintenanceLocation ? `<p><strong>Location:</strong> ${escapeEmailHtml(maintenanceLocation)}</p>` : ''}${maintenancePriority ? `<p><strong>Priority:</strong> ${escapeEmailHtml(maintenancePriority)}</p>` : ''}${maintenanceIssue ? `<p><strong>Details:</strong><br>${escapeEmailHtml(maintenanceIssue).replace(/\n/g, '<br>')}</p>` : ''}`;

    const result = await sendEmail({
      to: process.env.OWNER_EMAIL,
      toName: 'Heather & Lance',
      subject: `${urgent ? 'URGENT · ' : ''}Checkout report from ${guestName}`,
      idempotencyKey: booking ? `${booking.id}-checkout-report` : '',
      text: `Weeks Creek Haven checkout report\n\nGuest: ${guestName}\nStay: ${stayLabel}${guestPhone ? `\nPhone: ${guestPhone}` : ''}\nChecklist fully checked: ${checklistCompleted ? 'Yes' : 'No'}\nChecked off: ${checklistItems.length ? checklistItems.join(', ') : 'Nothing marked'}\nNot checked: ${checklistExpected.filter(item => !checklistItems.includes(item)).join(', ') || 'None'}\n\nSUPPLIES RUNNING LOW\n${textList(restock)}\n\nMAINTENANCE / ATTENTION\n${maintenanceSummary || 'No details supplied'}`,
      html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:640px"><h1 style="color:#183c2d">Checkout report</h1><p><strong>Guest:</strong> ${escapeEmailHtml(guestName)}<br><strong>Stay:</strong> ${escapeEmailHtml(stayLabel)}${guestPhone ? `<br><strong>Phone:</strong> ${escapeEmailHtml(guestPhone)}` : ''}<br><strong>Checklist fully checked:</strong> ${checklistCompleted ? 'Yes' : 'No'}<br><strong>Checked off:</strong> ${escapeEmailHtml(checklistItems.length ? checklistItems.join(', ') : 'Nothing marked')}<br><strong>Not checked:</strong> ${escapeEmailHtml(checklistExpected.filter(item => !checklistItems.includes(item)).join(', ') || 'None')}</p><h2 style="color:#183c2d">Supplies running low</h2>${htmlList(restock)}<h2 style="color:#183c2d">Maintenance / attention</h2>${maintenanceHtml}</div>`,
    });

    if (booking) {
      await appendBookingRecord({
        type: 'status',
        bookingId: booking.id,
        createdAt: completedAt,
        changes: {
          status: 'completed',
          checkoutCompletedAt: booking.checkoutCompletedAt || completedAt,
          checkoutFormSubmittedAt: completedAt,
          checkoutReportSentAt: completedAt,
          checkoutReportProvider: result?.provider || '',
          checkoutReport: report,
        },
      });
    }

    return json(response, 200, { ok: true, completedAt, linkedBooking: Boolean(booking) });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: error.message || 'Your checkout report could not be sent.' });
  }
}
