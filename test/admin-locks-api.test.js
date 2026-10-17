import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/admin-locks.js';

test('malformed admin cookie returns a JSON lock API error', async () => {
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    await handler({ method: 'GET', headers: { cookie: 'wch_admin=%E0%A4%A' } }, response);
  } finally {
    console.error = originalError;
  }

  assert.equal(response.statusCode, 409);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(response.body, { error: 'The lock update could not be confirmed. Refresh the list before trying again.' });
});
