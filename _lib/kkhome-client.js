import {
  constants, createPrivateKey, createPublicKey, privateDecrypt, publicEncrypt, sign,
} from 'node:crypto';

const SERVICE_PUBLIC_KEY = Buffer.from('MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDAhvfVLGrJ/M3xpUnT1xlN30E1UESxhAmGmFyTx3p3vpxF4zMYpUjwHckCvg/zvZwhNTgsm3CNT7LAdE8lCl2YK4BoUZ6IYbbXSOa02/brASX4kjpOPbTcaDfYud2CFWQba95d5dlf3Jf9Z3eTPwNK7YQ0LDDWMOQ6LxoGqcLciQIDAQAB', 'base64');
const PUBLIC_KEY = createPublicKey({ key:SERVICE_PUBLIC_KEY, format:'der', type:'spki' });

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function findToken(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  for (const key of ['accessToken','access_token','token','bearerToken']) {
    if (typeof value[key] === 'string' && value[key]) return value[key];
  }
  for (const child of Object.values(value)) {
    const token = findToken(child);
    if (token) return token;
  }
  return null;
}

export function createKKHomeClient({ email, password, appPrivateKey, fetchImpl=globalThis.fetch, now=Date.now } = {}) {
  if (!email || !password) throw new Error('KKHOME_EMAIL and KKHOME_PASSWORD are required.');
  if (!appPrivateKey) throw new Error('KKHOME_APP_PRIVATE_KEY is required.');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  let privateKey;
  try { privateKey = createPrivateKey({ key:Buffer.from(appPrivateKey, 'base64'), format:'der', type:'pkcs1' }); }
  catch { throw new Error('KKHOME_APP_PRIVATE_KEY is invalid.'); }
  let token;
  let authentication;

  function decrypt(encryptData) {
    const bytes = Buffer.from(encryptData, 'base64');
    const chunks = [];
    for (let offset=0; offset<bytes.length; offset+=128) {
      chunks.push(privateDecrypt({ key:privateKey, padding:constants.RSA_PKCS1_PADDING }, bytes.subarray(offset, offset+128)));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  function signed(payload) {
    const body = { ...payload, reqTime:String(now()) };
    body.sign = sign('RSA-SHA256', Buffer.from(stableJson(body)), { key:privateKey, padding:constants.RSA_PKCS1_PADDING }).toString('base64');
    return body;
  }

  function encrypted(payload) {
    const bytes = Buffer.from(JSON.stringify(signed(payload)));
    const chunks = [];
    for (let offset=0; offset<bytes.length; offset+=117) {
      chunks.push(publicEncrypt({ key:PUBLIC_KEY, padding:constants.RSA_PKCS1_PADDING }, bytes.subarray(offset, offset+117)));
    }
    return { encryptData:Buffer.concat(chunks).toString('base64') };
  }

  async function request(path, { body, encryptBody=false, unauthenticated=false, normalBody=false } = {}) {
    const headers = {
      Accept:'*/*', 'Content-Type':'application/json', 'k-language':'en_US', 'k-signv':'1.0.0',
      'k-tenant':'kawden', 'k-version':'3.3.1', phoneName:'iPhone17,1',
      'User-Agent':'KKHome/3.3.1 (iPhone; iOS 26.3.1; Scale/3.00)',
    };
    if (token && !unauthenticated) headers.token = token;
    if (encryptBody) headers.encrypt_data = 'encrypt_data';
    else if (normalBody) headers.encrypt_data = 'normal';
    const response = await fetchImpl(`https://api.kksecurityhome.com${path}`, {
      method:'POST', headers, ...(body === undefined ? {} : { body:JSON.stringify(encryptBody ? encrypted(body) : signed(body)) }),
    });
    let parsed;
    try { parsed = await response.json(); } catch { parsed = {}; }
    if (parsed?.encryptData) parsed = decrypt(parsed.encryptData);
    const message = parsed?.msg || parsed?.message;
    if (!response.ok || parsed?.success === false || ('code' in (parsed || {}) && ![0,200,'0','200'].includes(parsed.code))) {
      const error = new Error(`KK Home request failed${message ? `: ${message}` : ` (HTTP ${response.status})`}.`);
      error.operation = path.split('/').at(-1);
      error.providerCode = typeof parsed?.code === 'number' ? parsed.code : undefined;
      throw error;
    }
    return parsed && Object.hasOwn(parsed, 'data') ? parsed.data : parsed;
  }

  async function authenticate() {
    if (token) return;
    if (!authentication) authentication = (async () => {
      const data = await request('/v3/user/login/get-user-by-mail', { body:{ mail:email, password }, encryptBody:true, unauthenticated:true });
      token = findToken(data);
      if (!token) throw new Error('KK Home login returned no access token.');
    })().catch(error => { authentication = null; throw error; });
    await authentication;
  }

  return {
    async listDevices() { await authenticate(); return request('/v3/user/device/list', { body:{} }); },
    async listKeys(esn) { await authenticate(); return request('/v3/device/key-list', { body:{ esn } }); },
    async getTemporaryKey(esn) { await authenticate(); return request('/v3/device/get-temporary-key', { body:{ esn } }); },
    async insertTemporaryKey(payload) { await authenticate(); return request('/v3/device/insert-temp-pwd', { body:payload, encryptBody:true }); },
    async insertKey(payload) { await authenticate(); return request('/v3/device/insert-pwd', { body:payload, encryptBody:true }); },
    async updateKey(payload) { await authenticate(); return request('/v3/device/update-pwd', { body:payload, encryptBody:true }); },
    async saveKeyMetadata(payload) { await authenticate(); return request('/v3/device/ble-add-key-list', { body:payload, normalBody:true }); },
    async removeKey(payload) { await authenticate(); return request('/v3/device/remove-pwd', { body:payload }); },
    async removeKeyMetadata(payload) { await authenticate(); return request('/v3/device/ble-remove-pwd-list', { body:payload, normalBody:true }); },
  };
}
