const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
let entries = [], doors = [], operationId = crypto.randomUUID(), busy = false;
const date = value => value ? new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))+' Eastern' : '';
async function api(body) {
  const response = await fetch('/api/admin-locks',body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {});
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to update lock codes.'); return data;
}
function mode() {
  const value = $('owner-lock-mode').value;
  $('owner-lock-window').hidden = value !== 'scheduled';
  for (const name of ['startsAt','endsAt']) $('owner-lock-form').elements[name].required = value === 'scheduled';
  $('owner-lock-help').textContent = value === 'once' ? 'One successful unlock on one selected door. One-time codes are not automatically reissued. To clear an unused one-time code early, use KK Home.' : value === 'scheduled' ? 'The code works only between these Eastern start and end times.' : 'Permanent codes work until you revoke them.';
  if (value === 'once') { let kept = false; document.querySelectorAll('[name="lockDoor"]').forEach(input => { if (input.checked) { input.checked = !kept; kept = true; } }); }
}
function render() {
  $('owner-lock-list').innerHTML = entries.length ? entries.map(entry => {
    const ended = entry.mode === 'scheduled' && Date.parse(entry.endsAt) < Date.now();
    const label = entry.status === 'installed' ? (ended ? 'Expired' : entry.mode === 'once' ? 'One-time command confirmed' : 'Installed') : ({'revoked':'Revoked','revoking':'Removal needs attention','updating':'Updating locks','pending':'Pending','unconfirmed':'Not yet confirmed — check the lock','not-active':'No longer active','needs-attention':'Needs attention'}[entry.status] || entry.status);
    const window = entry.mode === 'permanent' ? 'Permanent · until revoked' : entry.mode === 'once' ? 'One successful unlock · one door' : `${date(entry.startsAt)} → ${date(entry.endsAt)}`;
    return `<article class="door-code-box"><strong>${escape(entry.name)}</strong><span class="badge">${escape(label)}</span><div><span class="door-code-value">${escape(entry.code)}</span></div><p class="helper">${escape(window)}</p><p class="helper">${entry.doorIds.map(id=>escape(doors.find(d=>d.id===id)?.name||id)+(entry.doors[id]?`: ${escape(entry.doors[id].status)}`:'')).join(' · ')}</p><div class="booking-tools"><button type="button" class="copy" data-copy-owner-lock="${escape(entry.id)}">Copy PIN</button>${entry.mode==='once'?`<button type="button" class="ghost" data-owner-lock-action="check" data-lock-id="${escape(entry.id)}">Check status</button>`:entry.status!=='revoked'?`${!ended&&['pending','needs-attention','updating'].includes(entry.status)?`<button type="button" class="primary" data-owner-lock-action="retry" data-lock-id="${escape(entry.id)}">Retry installation</button>`:''}<button type="button" class="danger" data-owner-lock-action="revoke" data-lock-id="${escape(entry.id)}">${entry.status==='revoking'?'Retry removal':'Revoke code'}</button>`:''}</div></article>`;
  }).join('') : '<div class="empty">No family or personal codes yet. Add your first one above.</div>';
}
async function load() {
  try {
    const data = await api(); entries = data.entries; doors = data.doors;
    if (!$('owner-lock-doors').children.length) $('owner-lock-doors').innerHTML = doors.map(door=>`<label class="checkline"><input type="checkbox" name="lockDoor" value="${escape(door.id)}" checked><span>${escape(door.name)}</span></label>`).join('');
    mode(); render();
  } catch(error) { $('owner-lock-message').textContent = error.message; }
}
async function action(body) {
  if (busy) return;
  busy = true; $('owner-lock-message').textContent = 'Updating the selected locks…';
  document.querySelectorAll('#panel-locks button').forEach(button=>button.disabled=true);
  try {
    const data = await api(body);
    $('owner-lock-message').textContent = data.entry.status === 'installed' ? 'Confirmed by KK Home. Check the keypad before sharing a new code.' : data.entry.status === 'revoked' ? 'Removal confirmed on all selected doors.' : 'Saved. Review the code status below.';
    if (body.action === 'create') { operationId = crypto.randomUUID(); $('owner-lock-form').reset(); }
    await load();
  } catch(error) { $('owner-lock-message').textContent = error.message; await load(); }
  finally { busy=false; document.querySelectorAll('#panel-locks button').forEach(button=>button.disabled=false); }
}
$('owner-lock-mode').addEventListener('change',mode);
$('owner-lock-doors').addEventListener('change',event=>{if($('owner-lock-mode').value==='once'&&event.target.checked)document.querySelectorAll('[name="lockDoor"]').forEach(input=>input.checked=input===event.target);});
$('owner-lock-form').addEventListener('submit',event=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));action({...values,action:'create',operationId,doorIds:[...document.querySelectorAll('[name="lockDoor"]:checked')].map(input=>input.value)});});
$('owner-lock-refresh').addEventListener('click',load);
$('owner-lock-list').addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.copyOwnerLock){const entry=entries.find(item=>item.id===button.dataset.copyOwnerLock);await navigator.clipboard.writeText(entry.code);$('owner-lock-message').textContent='PIN copied.';return;}
  if(button.dataset.ownerLockAction)action({action:button.dataset.ownerLockAction,id:button.dataset.lockId});
});
document.querySelector('.tabs').addEventListener('click',event=>{if(event.target.closest('[data-tab="locks"]'))load();});
let opened=false;
window.addEventListener('owner-dashboard-ready',()=>{if(!opened&&new URLSearchParams(location.search).get('tab')==='locks'){opened=true;document.querySelector('[data-tab="locks"]').click();}});
