export function squareConfigured() {
  return Boolean(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID);
}

export async function createSquarePaymentLink({ bookingId, guestName, email, amountCents }) {
  if (!squareConfigured()) throw new Error('Square is not connected yet.');
  const environment = String(process.env.SQUARE_ENVIRONMENT || 'production').toLowerCase();
  const baseUrl = environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
  const response = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
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
