function squareEnvironment() {
  const value = String(process.env.SQUARE_ENVIRONMENT || '').trim().toLowerCase();
  if (value === 'live') return 'production';
  return value;
}

export function squareConfigured() {
  return Boolean(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID && ['sandbox', 'production'].includes(squareEnvironment()));
}

export function squareStatus() {
  const environment = squareEnvironment();
  return {
    configured: squareConfigured(),
    environment: ['sandbox', 'production'].includes(environment) ? environment : 'not-set',
    live: environment === 'production' && squareConfigured(),
    webhookConfigured: Boolean(process.env.SQUARE_WEBHOOK_SIGNATURE_KEY && process.env.SQUARE_WEBHOOK_URL),
  };
}

function squareBaseUrl() {
  const environment = squareEnvironment();
  if (!['sandbox', 'production'].includes(environment)) throw new Error('Set SQUARE_ENVIRONMENT to sandbox or production before using Square.');
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

export async function getSquareInvoice(invoiceId) {
  if (!invoiceId) throw new Error('This reservation does not have a Square invoice yet.');
  const result = await squareRequest(`/v2/invoices/${encodeURIComponent(invoiceId)}`);
  if (!result.invoice) throw new Error('Square did not return that invoice.');
  return result.invoice;
}

function easternDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shiftDate(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function invoiceReminders(today, dueDate) {
  const daysUntilDue = Math.round((Date.parse(`${dueDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  return daysUntilDue > 1
    ? [{ relative_scheduled_days: -1, message: 'Your Weeks Creek Haven balance is due tomorrow.' }]
    : [];
}

export function friendInvoicePlan({ amountCents, arrival, paymentChoice = 'deposit', today = easternDate() }) {
  const balanceDueDate = shiftDate(arrival, -7);
  const fullPaymentRequired = paymentChoice === 'full' || balanceDueDate <= today || amountCents <= 2500;
  const depositAmountCents = fullPaymentRequired ? amountCents : 2500;
  return {
    fullPaymentRequired,
    depositAmountCents,
    balanceAmountCents: fullPaymentRequired ? 0 : amountCents - depositAmountCents,
    balanceDueDate: fullPaymentRequired ? null : balanceDueDate,
    depositDueDate: today,
  };
}

export async function createSquareBookingInvoice({ bookingId, guestName, email, address = {}, amountCents, securityDepositCents = 30000, depositBaseCents, arrival, discountCents = 0, depositDueDays = 1, revisionKey = '' }) {
  const revisionSuffix = revisionKey ? `-r${String(revisionKey).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)}` : '';
  if (!Number.isInteger(amountCents) || amountCents < 100) throw new Error('The stay total must be at least $1.00.');
  const stayChargeCents = amountCents - securityDepositCents;
  if (!Number.isInteger(stayChargeCents) || stayChargeCents < 100) throw new Error('The refundable security deposit could not be itemized.');
  const depositAmountCents = Math.round(Math.max(0, Number(depositBaseCents) || 0) * 0.20);
  if (depositAmountCents < 1 || depositAmountCents > amountCents) throw new Error('The 20% reservation deposit could not be calculated.');
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
      address: {
        address_line_1: String(address.line1 || '').slice(0, 160),
        locality: String(address.city || '').slice(0, 80),
        administrative_district_level_1: String(address.state || '').slice(0, 2),
        postal_code: String(address.postalCode || '').slice(0, 10),
        country: 'US',
      },
      reference_id: bookingId,
    },
  });
  const orderResult = await squareRequest('/v2/orders', {
    method: 'POST',
    body: {
      idempotency_key: `wch-order-${bookingId}${revisionSuffix}`,
      order: {
        location_id: process.env.SQUARE_LOCATION_ID,
        reference_id: bookingId,
        line_items: [{
          name: `Weeks Creek Haven stay for ${guestName}`,
          quantity: '1',
          base_price_money: { amount: stayChargeCents, currency: 'USD' },
        }, {
          name: 'Refundable security deposit',
          quantity: '1',
          base_price_money: { amount: securityDepositCents, currency: 'USD' },
        }],
      },
    },
  });
  const today = easternDate();
  const depositDueDate = shiftDate(today, Math.max(1, Number(depositDueDays) || 1));
  const balanceDueDate = shiftDate(arrival, -7);
  const fullPaymentRequired = balanceDueDate <= today;
  const balanceCents = amountCents - depositAmountCents;
  const paymentRequests = fullPaymentRequired ? [{
    request_type: 'BALANCE', due_date: today, tipping_enabled: false, automatic_payment_source: 'NONE',
  }] : [{
    request_type: 'DEPOSIT',
    due_date: depositDueDate,
    fixed_amount_requested_money: { amount: depositAmountCents, currency: 'USD' },
    tipping_enabled: false,
    automatic_payment_source: 'NONE',
  }, {
    request_type: 'BALANCE',
    due_date: balanceDueDate,
    tipping_enabled: false,
    automatic_payment_source: 'NONE',
    reminders: invoiceReminders(today, balanceDueDate),
  }];
  const invoiceResult = await squareRequest('/v2/invoices', {
    method: 'POST',
    body: {
      idempotency_key: `wch-invoice-${bookingId}${revisionSuffix}`,
      invoice: {
        location_id: process.env.SQUARE_LOCATION_ID,
        order_id: orderResult.order.id,
        primary_recipient: { customer_id: customerResult.customer.id },
        delivery_method: 'EMAIL',
        payment_requests: paymentRequests,
        invoice_number: `WCH-${bookingId.slice(0, 8).toUpperCase()}${revisionKey ? `-R${revisionKey}` : ''}`,
        title: 'Weeks Creek Haven private stay',
        description: `${discountCents ? `Includes a $${(discountCents / 100).toFixed(2)} Weeks Creek Haven discount. ` : ''}${fullPaymentRequired ? 'Because arrival is within seven days, payment in full is due now. ' : `The 20% reservation deposit is due within ${depositDueDays === 7 ? 'seven days' : '24 hours'} of approval, and the remaining balance is due seven days before arrival. `}Cancel at least 24 hours before the 4:00 PM Eastern check-in time for a full refund of amounts paid. Inside 24 hours, the 20% reservation deposit is retained and the remaining amount paid is refunded. The separately listed $300 security deposit is normally refunded within seven days after checkout, less any documented damage, missing property, rule-violation costs, or excessive cleaning.`,
        sale_or_service_date: arrival,
        accepted_payment_methods: { card: true, square_gift_card: false, bank_account: false, buy_now_pay_later: false, cash_app_pay: false },
      },
    },
  });
  const published = await squareRequest(`/v2/invoices/${encodeURIComponent(invoiceResult.invoice.id)}/publish`, {
    method: 'POST',
    body: { version: invoiceResult.invoice.version, idempotency_key: `wch-publish-${bookingId}${revisionSuffix}` },
  });
  return {
    url: published.invoice.public_url,
    invoiceId: published.invoice.id,
    orderId: orderResult.order.id,
    customerId: customerResult.customer.id,
    depositAmountCents,
    balanceAmountCents: fullPaymentRequired ? 0 : balanceCents,
    balanceDueDate,
    depositDueDate,
    fullPaymentRequired,
    securityDepositCents,
  };
}

export async function createSquareFriendInvoice({ bookingId, guestName, email, amountCents, securityDepositCents = 5000, arrival, paymentChoice = 'deposit', revisionKey = '' }) {
  const revisionSuffix = revisionKey ? `-r${String(revisionKey).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)}` : '';
  if (!Number.isInteger(amountCents) || amountCents < 100) throw new Error('The friend invoice total must be at least $1.00.');
  if (!email) throw new Error('Add an email address before sending a friend invoice.');
  const stayChargeCents = amountCents - securityDepositCents;
  if (!Number.isInteger(stayChargeCents) || stayChargeCents < 0) throw new Error('The refundable security deposit could not be itemized.');
  const today = easternDate();
  const { fullPaymentRequired, depositAmountCents, balanceAmountCents, balanceDueDate, depositDueDate } = friendInvoicePlan({ amountCents, arrival, paymentChoice, today });
  const paymentRequests = fullPaymentRequired ? [{
    request_type: 'BALANCE',
    due_date: today,
    tipping_enabled: false,
    automatic_payment_source: 'NONE',
  }] : [{
    request_type: 'DEPOSIT',
    due_date: today,
    fixed_amount_requested_money: { amount: depositAmountCents, currency: 'USD' },
    tipping_enabled: false,
    automatic_payment_source: 'NONE',
  }, {
    request_type: 'BALANCE',
    due_date: balanceDueDate,
    tipping_enabled: false,
    automatic_payment_source: 'NONE',
    reminders: invoiceReminders(today, balanceDueDate),
  }];
  const nameParts = String(guestName || 'Guest').trim().split(/\s+/);
  const familyName = nameParts.length > 1 ? nameParts.pop() : '';
  const givenName = nameParts.join(' ') || guestName || 'Guest';
  const customerResult = await squareRequest('/v2/customers', {
    method: 'POST',
    body: {
      idempotency_key: `wch-friend-customer-${bookingId}`,
      given_name: givenName,
      ...(familyName ? { family_name: familyName } : {}),
      email_address: email,
      reference_id: bookingId,
    },
  });
  const orderResult = await squareRequest('/v2/orders', {
    method: 'POST',
    body: {
      idempotency_key: `wch-friend-order-${bookingId}${revisionSuffix}`,
      order: {
        location_id: process.env.SQUARE_LOCATION_ID,
        reference_id: bookingId,
        line_items: [{
          name: `Weeks Creek Haven friends & family stay for ${guestName}`,
          quantity: '1',
          base_price_money: { amount: stayChargeCents, currency: 'USD' },
        }, ...(securityDepositCents > 0 ? [{
          name: 'Refundable security deposit',
          quantity: '1',
          base_price_money: { amount: securityDepositCents, currency: 'USD' },
        }] : [])],
      },
    },
  });
  const invoiceResult = await squareRequest('/v2/invoices', {
    method: 'POST',
    body: {
      idempotency_key: `wch-friend-invoice-${bookingId}${revisionSuffix}`,
      invoice: {
        location_id: process.env.SQUARE_LOCATION_ID,
        order_id: orderResult.order.id,
        primary_recipient: { customer_id: customerResult.customer.id },
        delivery_method: 'EMAIL',
        payment_requests: paymentRequests,
        invoice_number: `WCHF-${bookingId.slice(0, 8).toUpperCase()}${revisionKey ? `-R${revisionKey}` : ''}`,
        title: 'Weeks Creek Haven friends & family stay',
        description: `${fullPaymentRequired ? 'The full Friends & Family total is due now.' : `A $25 reservation payment is due today, and the remaining balance is due by ${balanceDueDate}. You may pay the balance sooner through this invoice.`} The separately listed $50 security deposit is refundable under the rental agreement. Cancel at least 24 hours before the 4:00 PM Eastern check-in time for a full refund. Inside 24 hours, the $25 reservation payment is retained and any remaining amount paid is refunded.`,
        sale_or_service_date: arrival,
        accepted_payment_methods: { card: true, square_gift_card: false, bank_account: false, buy_now_pay_later: false, cash_app_pay: false },
      },
    },
  });
  const published = await squareRequest(`/v2/invoices/${encodeURIComponent(invoiceResult.invoice.id)}/publish`, {
    method: 'POST',
    body: { version: invoiceResult.invoice.version, idempotency_key: `wch-friend-publish-${bookingId}${revisionSuffix}` },
  });
  return {
    url: published.invoice.public_url,
    invoiceId: published.invoice.id,
    orderId: orderResult.order.id,
    customerId: customerResult.customer.id,
    amountCents,
    depositAmountCents,
    balanceAmountCents,
    balanceDueDate: fullPaymentRequired ? null : balanceDueDate,
    depositDueDate,
    fullPaymentRequired,
    securityDepositCents,
  };
}

async function invoicePayments(invoiceId, fallbackOrderId) {
  const invoiceResult = invoiceId ? await squareRequest(`/v2/invoices/${encodeURIComponent(invoiceId)}`) : {};
  const invoice = invoiceResult.invoice || null;
  const orderId = invoice?.order_id || fallbackOrderId;
  if (!orderId) throw new Error('This reservation does not have a Square order to refund.');
  const orderResult = await squareRequest(`/v2/orders/${encodeURIComponent(orderId)}`);
  const paymentIds = [...new Set((orderResult.order?.tenders || []).map((tender) => tender.payment_id || tender.id).filter(Boolean))];
  const payments = await Promise.all(paymentIds.map(async (paymentId) => {
    const result = await squareRequest(`/v2/payments/${encodeURIComponent(paymentId)}`);
    const payment = result.payment;
    const paid = Number(payment?.amount_money?.amount) || 0;
    const refunded = Number(payment?.refunded_money?.amount) || 0;
    const processingFeeCents = (payment?.processing_fee || []).reduce((sum, fee) => sum + (Number(fee?.amount_money?.amount) || 0), 0);
    return { id: paymentId, status: payment?.status, paid, refunded, refundable: Math.max(0, paid - refunded), processingFeeCents, createdAt: payment?.created_at || null };
  }));
  return { invoice, orderId, payments };
}

export async function getSquareInvoiceAccounting(invoiceId, orderId) {
  const details = await invoicePayments(invoiceId, orderId);
  const completed = details.payments.filter((payment) => payment.status === 'COMPLETED');
  return {
    paidCents: completed.reduce((sum, payment) => sum + payment.paid, 0),
    refundedCents: completed.reduce((sum, payment) => sum + payment.refunded, 0),
    processingFeeCents: completed.reduce((sum, payment) => sum + payment.processingFeeCents, 0),
    payments: completed,
  };
}

export async function refundSquareBooking({ bookingId, invoiceId, orderId, amountCents, reason, operationId }) {
  if (!operationId) throw new Error('A refund operation ID is required.');
  let details = await invoicePayments(invoiceId, orderId);
  if (details.invoice?.status === 'PARTIALLY_PAID') {
    await cancelSquareInvoice(invoiceId);
    details = await invoicePayments(invoiceId, orderId);
  }
  if (details.invoice && !['PAID', 'CANCELED', 'FAILED', 'REFUNDED'].includes(details.invoice.status)) {
    throw new Error(`Square invoice status ${details.invoice.status} cannot be refunded yet.`);
  }
  const refundablePayments = details.payments.filter((payment) => payment.status === 'COMPLETED' && payment.refundable > 0);
  const availableCents = refundablePayments.reduce((sum, payment) => sum + payment.refundable, 0);
  const requestedCents = amountCents == null ? availableCents : Number(amountCents);
  if (!Number.isInteger(requestedCents) || requestedCents < 1) throw new Error('There is no completed Square payment available to refund.');
  if (requestedCents > availableCents) throw new Error(`Only $${(availableCents / 100).toFixed(2)} is currently available to refund.`);

  let remaining = requestedCents;
  const refunds = [];
  for (let index = 0; index < refundablePayments.length && remaining > 0; index++) {
    const payment = refundablePayments[index];
    const refundAmount = Math.min(remaining, payment.refundable);
    const result = await squareRequest('/v2/refunds', {
      method: 'POST',
      body: {
        idempotency_key: `${String(operationId).slice(0, 40)}-${index}`,
        payment_id: payment.id,
        amount_money: { amount: refundAmount, currency: 'USD' },
        reason: String(reason || 'Weeks Creek Haven guest adjustment').trim().slice(0, 192),
      },
    });
    refunds.push({
      id: result.refund.id,
      paymentId: payment.id,
      amountCents: Number(result.refund.amount_money?.amount) || refundAmount,
      status: result.refund.status,
      reason: result.refund.reason || reason,
      createdAt: result.refund.created_at || new Date().toISOString(),
    });
    remaining -= refundAmount;
  }
  return { bookingId, amountCents: requestedCents, availableBeforeCents: availableCents, refunds };
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
