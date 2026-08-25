export function squareConfigured() {
  return Boolean(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID);
}

function squareBaseUrl() {
  const environment = String(process.env.SQUARE_ENVIRONMENT || 'production').toLowerCase();
  return environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
}

async function squareRequest(path, { method = 'GET', body } = {}) {
  if (!squareConfigured()) throw new Error('Square is not connected yet.');
  const response = await fetch(`${squareBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      'Square-Version': '2026-08-19',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.errors?.[0]?.detail || 'Square could not complete the request.');
  return result;
}

function easternDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function previousDate(value) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function invoiceReminders(today, dueDate) {
  const daysUntilDue = Math.round((Date.parse(`${dueDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  const reminders = [];
  if (daysUntilDue > 7) reminders.push({ relative_scheduled_days: -7, message: 'Your Weeks Creek Haven balance is due in one week.' });
  if (daysUntilDue > 1) reminders.push({ relative_scheduled_days: -1, message: 'Your Weeks Creek Haven balance is due tomorrow.' });
  return reminders;
}

export async function createSquareBookingInvoice({ bookingId, guestName, email, amountCents, arrival }) {
  if (amountCents < 10000) throw new Error('The stay total must be at least the $100 deposit.');
  const nameParts = String(guestName || 'Guest').trim().split(/\s+/);
  const familyName = nameParts.length > 1 ? nameParts.pop() : '';
  const givenName = nameParts.join(' ') || guestName || 'Guest';
  const customerResult = await squareRequest('/v2/customers', {
    method: 'POST',
    body: {
      idempotency_key: `wch-customer-${bookingId}`,
      given_name: givenName,
      ...(familyName ? { family_name: familyName } : {}),
      email_address: email,
      reference_id: bookingId,
    },
  });
  const orderResult = await squareRequest('/v2/orders', {
    method: 'POST',
    body: {
      idempotency_key: `wch-order-${bookingId}`,
      order: {
        location_id: process.env.SQUARE_LOCATION_ID,
        reference_id: bookingId,
        line_items: [{
          name: `Weeks Creek Haven stay for ${guestName}`,
          quantity: '1',
          base_price_money: { amount: amountCents, currency: 'USD' },
        }],
      },
    },
  });
  const today = easternDate();
  const balanceDueDate = previousDate(arrival);
  if (balanceDueDate < today) throw new Error('The balance due date has already passed. Choose a later arrival date.');
  const balanceCents = amountCents - 10000;
  const paymentRequests = [{
    request_type: balanceCents ? 'DEPOSIT' : 'BALANCE',
    due_date: today,
    ...(balanceCents ? { fixed_amount_requested_money: { amount: 10000, currency: 'USD' } } : {}),
    tipping_enabled: false,
    automatic_payment_source: 'NONE',
  }];
  if (balanceCents) paymentRequests.push({
    request_type: 'BALANCE',
    due_date: balanceDueDate,
    tipping_enabled: false,
    automatic_payment_source: 'NONE',
    reminders: invoiceReminders(today, balanceDueDate),
  });
  const invoiceResult = await squareRequest('/v2/invoices', {
    method: 'POST',
    body: {
      idempotency_key: `wch-invoice-${bookingId}`,
      invoice: {
        location_id: process.env.SQUARE_LOCATION_ID,
        order_id: orderResult.order.id,
        primary_recipient: { customer_id: customerResult.customer.id },
        delivery_method: 'EMAIL',
        payment_requests: paymentRequests,
        invoice_number: `WCH-${bookingId.slice(0, 8).toUpperCase()}`,
        title: 'Weeks Creek Haven private stay',
        description: '$100 non-refundable reservation deposit. Remaining balance is due one day before arrival.',
        sale_or_service_date: arrival,
        accepted_payment_methods: { card: true, square_gift_card: false, bank_account: false, buy_now_pay_later: false, cash_app_pay: false },
      },
    },
  });
  const published = await squareRequest(`/v2/invoices/${encodeURIComponent(invoiceResult.invoice.id)}/publish`, {
    method: 'POST',
    body: { version: invoiceResult.invoice.version, idempotency_key: `wch-publish-${bookingId}` },
  });
  return {
    url: published.invoice.public_url,
    invoiceId: published.invoice.id,
    orderId: orderResult.order.id,
    customerId: customerResult.customer.id,
    depositAmountCents: Math.min(amountCents, 10000),
    balanceAmountCents: balanceCents,
    balanceDueDate,
  };
}

export async function cancelSquareInvoice(invoiceId) {
  if (!invoiceId) return;
  const current = await squareRequest(`/v2/invoices/${encodeURIComponent(invoiceId)}`);
  if (['CANCELED', 'PAID', 'REFUNDED'].includes(current.invoice?.status)) return current.invoice;
  const result = await squareRequest(`/v2/invoices/${encodeURIComponent(invoiceId)}/cancel`, {
    method: 'POST',
    body: { version: current.invoice.version },
  });
  return result.invoice;
}

export async function createSquarePaymentLink({ bookingId, guestName, email, amountCents }) {
  if (!squareConfigured()) throw new Error('Square is not connected yet.');
  const response = await fetch(`${squareBaseUrl()}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      'Square-Version': '2026-08-19',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotency_key: `wch-${bookingId}`,
      quick_pay: {
        name: `Weeks Creek Haven stay for ${guestName}`,
        price_money: { amount: amountCents, currency: 'USD' },
        location_id: process.env.SQUARE_LOCATION_ID,
      },
      checkout_options: {
        redirect_url: 'https://www.weekscreekhaven.com/payment-thank-you.html',
        ask_for_shipping_address: false,
      },
      pre_populated_data: { buyer_email: email },
      payment_note: `Weeks Creek Haven booking request ${bookingId}`,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.payment_link?.url) {
    throw new Error(result.errors?.[0]?.detail || 'Square could not create the payment link.');
  }
  return { url: result.payment_link.url, id: result.payment_link.id, orderId: result.payment_link.order_id };
}
