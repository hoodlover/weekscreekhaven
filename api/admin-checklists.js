import { appendCleanerRecord, getCleanerState } from '../_lib/cleaner-store.js';
import { normalizeFamilyChecklist, normalizeTurnoverChecklist } from '../_lib/checklist-defaults.js';
import { json, requireAdmin, sameOriginRequest } from '../_lib/security.js';

export default async function handler(request,response){
  if(!requireAdmin(request))return json(response,401,{error:'Please sign in as the site owner.'});
  try{
    const state=await getCleanerState();
    if(request.method==='GET')return json(response,200,{family:normalizeFamilyChecklist(state.settings.familyCheckoutChecklist),turnover:normalizeTurnoverChecklist(state.settings.turnoverChecklistMaster),updatedAt:state.settings.checklistsUpdatedAt||''},{'Cache-Control':'private, no-store'});
    if(request.method!=='PATCH')return json(response,405,{error:'Method not allowed.'});
    if(!sameOriginRequest(request))return json(response,403,{error:'This checklist update was blocked.'});
    const kind=request.body?.kind;
    if(!['family','turnover'].includes(kind))return json(response,400,{error:'Choose the checklist to update.'});
    const updatedAt=new Date().toISOString();
    const changes=kind==='family'
      ? {familyCheckoutChecklist:normalizeFamilyChecklist(request.body?.items),checklistsUpdatedAt:updatedAt}
      : {turnoverChecklistMaster:normalizeTurnoverChecklist(request.body?.groups),checklistsUpdatedAt:updatedAt};
    await appendCleanerRecord({type:'settings',createdAt:updatedAt,changes});
    return json(response,200,{ok:true,kind,...changes});
  }catch(error){
    console.error(error);
    return json(response,503,{error:error.message||'The master checklist could not be saved.'});
  }
}
