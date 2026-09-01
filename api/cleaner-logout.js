import { ADMIN_COOKIE, CLEANER_COOKIE, cookieHeader, json, sharedAdminCookieDomain } from '../_lib/security.js';
export default function handler(request,response){
  if(request.method!=='POST')return json(response,405,{error:'Method not allowed.'});
  return json(response,200,{ok:true},{'Set-Cookie':[
    cookieHeader(CLEANER_COOKIE,'',-1),
    cookieHeader(ADMIN_COOKIE,'',-1,{domain:sharedAdminCookieDomain(request)}),
  ]});
}
