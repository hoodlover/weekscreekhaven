import test from 'node:test';
import assert from 'node:assert/strict';
import login from '../api/admin-login.js';
import renew from '../api/admin-session.js';
import ownerLogout from '../api/admin-logout.js';
import cleanerLogout from '../api/cleaner-logout.js';
import { ADMIN_SESSION_SECONDS, createSession, requireAdmin, verifySession } from '../_lib/security.js';
process.env.SESSION_SECRET='owner-session-test-secret-at-least-32-characters';
process.env.ADMIN_PASSWORD='owner-session-test-password';
async function call(handler,{cookie='',origin='https://cleaner.weekscreekhaven.com',body={},method='POST'}={}) {
 const result={headers:{}};
 await handler({method,headers:{cookie,origin,host:'cleaner.weekscreekhaven.com'},body,socket:{remoteAddress:'session-test'}},{status(code){result.code=code;return this;},setHeader(key,value){result.headers[key]=value;},json(body){result.body=body;return this;}});
 return result;
}
const ownerCookie=()=>`wch_admin=${createSession({role:'admin'},3600)}`;
test('owner login is persistent and shares one cookie across cabin apps',async()=>{
 const result=await call(login,{body:{password:process.env.ADMIN_PASSWORD}});
 assert.equal(result.code,200);
 const cookie=result.headers['Set-Cookie'].find(value=>value.includes(`Max-Age=${ADMIN_SESSION_SECONDS}`));
 assert.match(cookie,/HttpOnly; Secure; SameSite=Lax; Domain=.weekscreekhaven.com/);
 const token=decodeURIComponent(cookie.split(';')[0].slice('wch_admin='.length));
 assert.ok(verifySession(token,'admin').exp>=Math.floor(Date.now()/1000)+ADMIN_SESSION_SECONDS-1);
 assert.match(result.headers['Set-Cookie'][0],/Max-Age=0/);
});
test('only a valid owner session can renew; cleaner sessions and foreign origins cannot',async()=>{
 const result=await call(renew,{cookie:ownerCookie()});
 assert.equal(result.code,200);assert.ok(result.headers['Set-Cookie'].some(value=>value.includes(`Max-Age=${ADMIN_SESSION_SECONDS}`)));
 for(const cookie of ['',`wch_admin=${createSession({role:'admin'},-1)}`,`wch_cleaner=${createSession({role:'cleaner'},3600)}`,'wch_admin=forged'])assert.equal((await call(renew,{cookie})).code,401);
 assert.equal((await call(renew,{cookie:ownerCookie(),origin:'https://other.example'})).code,403);
});
test('stale duplicate host cookies cannot hide a valid shared owner session',()=>{
 const good=ownerCookie(),expired=`wch_admin=${createSession({role:'admin'},-1)}`;
 for(const cookie of [`${expired}; ${good}`,`${good}; ${expired}`])assert.equal(requireAdmin({headers:{cookie}}).role,'admin');
});
test('cleaner logout leaves owner signed in; explicit owner logout clears both cookie scopes',async()=>{
 const cleaner=await call(cleanerLogout);
 assert.ok(cleaner.headers['Set-Cookie'].every(value=>value.startsWith('wch_cleaner=')));
 const owner=await call(ownerLogout);
 assert.equal(owner.headers['Set-Cookie'].length,2);
 assert.ok(owner.headers['Set-Cookie'].every(value=>value.startsWith('wch_admin=')&&value.includes('Max-Age=0')));
});
