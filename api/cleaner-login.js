import { CLEANER_COOKIE, cookieHeader, createSession, enforceRateLimit, json, rateLimitJson, sameOriginRequest, verifyPasscode } from '../_lib/security.js';
import { getCleanerState } from '../_lib/cleaner-store.js';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export default async function handler(request,response){
  if(request.method!=='POST')return json(response,405,{error:'Method not allowed.'});
  if(!sameOriginRequest(request))return json(response,403,{error:'Open the cleaner sign-in from this website.'});
  const rate=enforceRateLimit(request,'cleaner-login',6,15*60*1000); if(!rate.allowed)return rateLimitJson(response,rate);
  try{
    const {settings}=await getCleanerState();
    if(!settings.passcodeHash||!settings.passcodeSalt)return json(response,503,{error:'The owner needs to set up cleaner access first.'});
    if(!verifyPasscode(request.body?.passcode,settings.passcodeSalt,settings.passcodeHash)){await wait(350);return json(response,401,{error:'That cleaner access code is not correct.'});}
    const maxAge=30*86400;
    return json(response,200,{ok:true},{'Set-Cookie':cookieHeader(CLEANER_COOKIE,createSession({role:'cleaner',authVersion:settings.cleanerAuthVersion||''},maxAge),maxAge),'Cache-Control':'no-store'});
  }catch(error){return json(response,503,{error:error.message||'Cleaner sign-in is unavailable.'});}
}
