import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const textEncoder = new TextEncoder();

export const ADMIN_COOKIE = 'wch_admin';
export const INVITE_COOKIE = 'wch_invite';

export function parseCookies(request) {
  const header = request.headers.cookie || '';
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf('=');
    return [decodeURIComponent(part.slice(0, separator)), decodeURIComponent(part.slice(separator + 1))];
  }));
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sessionSecret() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters.');
  }
  return process.env.SESSION_SECRET;
}

export function createSession(payload, lifetimeSeconds) {
  const body = base64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + lifetimeSeconds }));
  const signature = createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifySession(token, expectedRole) {
  try {
    if (!token) return null;
    const [body, suppliedSignature] = token.split('.');
    const expectedSignature = createHmac('sha256', sessionSecret()).update(body).digest('base64url');
    const supplied = Buffer.from(suppliedSignature || '', 'base64url');
    const expected = Buffer.from(expectedSignature, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.role !== expectedRole || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function cookieHeader(name, value, maxAge = 0) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'];
  if (maxAge > 0) parts.push(`Max-Age=${maxAge}`);
  if (maxAge < 0) parts.push('Max-Age=0');
  return parts.join('; ');
}

export function verifyAdminPassword(password) {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) throw new Error('ADMIN_PASSWORD is not configured.');
  const supplied = createHash('sha256').update(String(password || '')).digest();
  const expected = createHash('sha256').update(configured).digest();
  return timingSafeEqual(supplied, expected);
}

export function normalizePasscode(passcode) {
  return String(passcode || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function hashPasscode(passcode, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(normalizePasscode(passcode), salt, 32).toString('hex') };
}

export function verifyPasscode(passcode, salt, expectedHash) {
  const supplied = scryptSync(normalizePasscode(passcode), salt, 32);
  const expected = Buffer.from(expectedHash, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function generatePasscode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  return `WCH-${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')}`;
}

function encryptionKey() {
  return createHash('sha256').update(`${sessionSecret()}:weeks-creek-private-data`).digest();
}

export function encryptRecord(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: encrypted.toString('base64url'),
  });
}

export function decryptRecord(value) {
  const envelope = typeof value === 'string' ? JSON.parse(value) : value;
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(envelope.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64url')),
    decipher.final(),
  ]).toString('utf8'));
}

export function anonymizeIp(ip) {
  if (!ip) return 'unknown';
  return createHmac('sha256', sessionSecret()).update(ip).digest('hex').slice(0, 12);
}

export function requireAdmin(request) {
  return verifySession(parseCookies(request)[ADMIN_COOKIE], 'admin');
}

export function json(response, status, body, extraHeaders = {}) {
  response.status(status);
  for (const [name, value] of Object.entries(extraHeaders)) response.setHeader(name, value);
  return response.json(body);
}
