export const DEFAULT_FAMILY_CHECKLIST = [
  { id:'linens', title:'Beds & laundry', detail:'Strip the beds you used. Wash sheets, pillowcases, and towels, then move the load to the dryer and start it before you leave.' },
  { id:'bathrooms', title:'Bathrooms', detail:'Clean the sinks, toilets, and showers you used so they are ready for the next guests.' },
  { id:'dishes', title:'Dishes', detail:'Hand-wash dishes or load and start the dishwasher. Please leave the sink empty.' },
  { id:'fridge', title:'Refrigerator', detail:'Remove your food and wipe up any spills or crumbs.' },
  { id:'trash', title:'Trash', detail:'Bag and remove all trash. Food waste goes in the tall bear-proof can; non-food trash goes in the porch trash box.' },
  { id:'fireplace', title:'Fireplace', detail:'Turn the fireplace knob to Pilot and close the screens.' },
  { id:'hottub', title:'Hot tub', detail:'Secure the cover, lower the temperature to 80°F, and include used hot-tub towels with the laundry.' },
  { id:'floors', title:'Floors & stick vacuum', detail:'Vacuum the floors, empty the stick vacuum, and plug it back in so it charges.' },
  { id:'lights', title:'Lights', detail:'Turn off most lights by hand. Alexa only controls the main living-room and kitchen lights. The checkout temperature adjusts automatically.' },
  { id:'lockup', title:'Doors & windows', detail:'Close the windows and lock all three smart doors, or use the Alexa routine below.' },
  { id:'walkthrough', title:'Final walk-through', detail:'Leave the cabin as you found it and text us about anything that broke, needs attention, or could make a future stay better.' },
];

export const DEFAULT_TURNOVER_CHECKLIST = [
  { id:'arrival', name:'Arrival & evidence', tasks:[
    { id:'arrival_photos', title:'Take arrival photos', detail:'Photograph damage, heavy mess, or anything unusual before moving it.' },
    { id:'checkout_report', title:'Read the guest checkout report', detail:'Review supplies, maintenance notes, location, urgency, and the guest’s checklist status.' },
    { id:'safety_scan', title:'Safety and cabin-feel scan', detail:'Check for leaks, pests, smoke or odd odors, damage, and anything unsafe.' },
  ]},
  { id:'kitchen', name:'Kitchen', tasks:[
    { id:'kitchen_dishes', title:'Dishes and sink', detail:'Wash or run dishes, empty the sink, and leave the dishwasher ready.' },
    { id:'kitchen_surfaces', title:'Counters, table, and backsplash', detail:'Clean and sanitize food-prep and eating surfaces.' },
    { id:'kitchen_appliances', title:'Appliances inside and out', detail:'Check the oven, microwave, range, coffee makers, toaster, and other used appliances.' },
    { id:'refrigerator', title:'Refrigerator and freezer', detail:'Remove abandoned food; clean spills, shelves, seals, and handles.' },
    { id:'kitchen_handles', title:'Cabinets, pulls, and touchpoints', detail:'Wipe visible marks and frequently touched surfaces.' },
    { id:'kitchen_trash', title:'Trash and recycling', detail:'Empty bins, replace liners, and move waste to the correct outdoor can.' },
    { id:'kitchen_floors', title:'Kitchen floors', detail:'Vacuum edges and under movable items, then mop.' },
  ]},
  { id:'bathrooms', name:'Bathrooms', tasks:[
    { id:'bath_toilets', title:'Toilets—complete clean', detail:'Disinfect bowl, seat, hinges, front, base, surrounding wall, and floor.' },
    { id:'bath_sinks', title:'Sinks, counters, and faucets', detail:'Clean, disinfect, dry, and polish fixtures.' },
    { id:'bath_mirrors', title:'Mirrors and glass', detail:'Leave glass streak-free.' },
    { id:'bath_showers', title:'Showers, tubs, and drains', detail:'Remove hair and residue; clean fixtures, ledges, curtains, and doors. Include the lower-level jetted soaking tub using its posted care instructions.' },
    { id:'bath_linens', title:'Towels, mats, and toiletries', detail:'Replace linens and neatly reset the guest supplies.' },
    { id:'bath_trash_floors', title:'Bathroom trash and floors', detail:'Empty bins, replace liners, vacuum, and mop corners and behind doors.' },
  ]},
  { id:'bedrooms', name:'Bedrooms & laundry', tasks:[
    { id:'beds_strip', title:'Strip and inspect used beds', detail:'Look for stains, damage, and forgotten items before laundering.' },
    { id:'linens_wash', title:'Wash and fully dry linens', detail:'Empty the dryer lint screen before each load. Dryer heat: Full High, 5th level, for linens suitable for high heat; follow fabric care labels for other items. Never put away damp linens.' },
    { id:'beds_remake', title:'Remake every used bed', detail:'Use fresh linens and make the room arrival-ready.' },
    { id:'protectors', title:'Inspect protectors and pillows', detail:'Check mattress and pillow protectors; replace or report anything soiled or damaged.' },
    { id:'bedroom_surfaces', title:'Bedroom reset', detail:'Dust, wipe touchpoints, empty trash, and reset nightstands, closets, and luggage areas.' },
  ]},
  { id:'living', name:'Living areas', tasks:[
    { id:'living_dust', title:'Dust and wipe surfaces', detail:'Include lamps, rails, shelves, tables, ledges, and visible cobwebs.' },
    { id:'living_reset', title:'Reset furniture, games, and remotes', detail:'Return everything to its home and check for guest belongings.' },
    { id:'living_floors', title:'Floors, stairs, edges, and rugs', detail:'Vacuum thoroughly, spot-clean, and mop appropriate hard floors.' },
    { id:'fireplace', title:'Fireplace area', detail:'Remove safe, fully cold debris as directed; clean the hearth and reset controls and screens.' },
  ]},
  { id:'outdoors', name:'Hot tub & outdoors', tasks:[
    { id:'hot_tub_water', title:'Empty, clean, refill & balance the hot tub', detail:'Follow the posted draining and refill procedure. Test fresh water, balance using the approved product instructions, then retest and record readings in the visit notes. Ask Heather & Lance if instructions or chemicals are unclear; do not guess doses.' },
    { id:'hot_tub_area', title:'Hot-tub cover, rail, and towels', detail:'Clean and secure the area, reset towels, and report damage or cloudy water.' },
    { id:'outdoor_reset', title:'Wipe deck furniture & clear outdoor paths', detail:'Wipe down all deck furniture and tables. Blow leaves off porches and the trails down to the fire pit and creek. Pick up litter and leave paths clear.' },
    { id:'grill_fireplace', title:'Grill and outdoor fire areas', detail:'Clean only when safely cool; remove residue and report unsafe conditions.' },
    { id:'fuel_check', title:'Propane and charcoal', detail:'Check supply levels and record anything low or empty.' },
  ]},
  { id:'lockup', name:'Restock, systems & lock-up', tasks:[
    { id:'restock', title:'Restock guest and cleaning supplies', detail:'Refill the agreed par levels and update the shared stock list.' },
    { id:'systems', title:'Lights, thermostat, Wi-Fi, TV, and Alexa', detail:'Perform the agreed quick checks and report anything offline or unusual.' },
    { id:'doors_windows', title:'Windows and exterior doors', detail:'Close, lock, and verify the three smart doors.' },
    { id:'vacuum_charge', title:'Empty and charge the stick vacuum', detail:'Empty the bin, clear the brush if needed, and plug it back in.' },
    { id:'final_walkthrough', title:'Final cabin-feel walk-through', detail:'Check temperature, scent, lighting, staging, and the view from the front door.' },
    { id:'after_photos', title:'Upload 60–75 visit photos', detail:'Photograph the finished rooms, beds, bathrooms, kitchen, outdoor spaces, and hot tub, plus any issues. Upload about 60–75 photos for this cleaning; notes are optional.' },
  ]},
];

const CABIN_TURNOVER_NOTES={"linens_wash":"Empty the dryer lint screen before each load. Dryer heat: Full High, 5th level, for linens suitable for high heat; follow fabric care labels for other items. Never put away damp linens.","hot_tub_water":"Follow the posted draining and refill procedure. Test fresh water, balance using the approved product instructions, then retest and record readings in the visit notes. Ask Heather & Lance if instructions or chemicals are unclear; do not guess doses.","outdoor_reset":"Wipe down all deck furniture and tables. Blow leaves off porches and the trails down to the fire pit and creek. Pick up litter and leave paths clear.","bath_showers":"Remove hair and residue; clean fixtures, ledges, curtains, and doors. Include the lower-level jetted soaking tub using its posted care instructions.","after_photos":"Photograph the finished rooms, beds, bathrooms, kitchen, outdoor spaces, and hot tub, plus any issues. Upload about 60–75 photos for this cleaning; notes are optional."};
const cabinDetail=(id,detail)=>CABIN_TURNOVER_NOTES[id]&&!detail.includes(CABIN_TURNOVER_NOTES[id])?(detail?detail+' ':'')+CABIN_TURNOVER_NOTES[id]:detail;
const clean=(value,max)=>String(value||'').trim().slice(0,max);
const cleanId=(value,fallback)=>clean(value,80).toLowerCase().replace(/[^a-z0-9_-]/g,'-').replace(/-+/g,'-')||fallback;

export function normalizeFamilyChecklist(value){
  if(!Array.isArray(value)||!value.length)return DEFAULT_FAMILY_CHECKLIST.map(item=>({...item}));
  const seen=new Set();
  return value.slice(0,40).map((item,index)=>{
    let id=cleanId(item?.id,`family-${index+1}`);while(seen.has(id))id=`${id}-${index+1}`;seen.add(id);
    return {id,title:clean(item?.title,100)||`Checkout item ${index+1}`,detail:clean(item?.detail,500)};
  });
}

export function normalizeTurnoverChecklist(value){
  if(!Array.isArray(value)||!value.length)return DEFAULT_TURNOVER_CHECKLIST.map(group=>({...group,tasks:group.tasks.map(task=>({...task}))}));
  const groupIds=new Set(),taskIds=new Set();
  return value.slice(0,20).map((group,index)=>{
    let id=cleanId(group?.id,`group-${index+1}`);while(groupIds.has(id))id=`${id}-${index+1}`;groupIds.add(id);
    const tasks=(Array.isArray(group?.tasks)?group.tasks:[]).slice(0,60).map((task,taskIndex)=>{
      let taskId=cleanId(task?.id,`${id}-task-${taskIndex+1}`);while(taskIds.has(taskId))taskId=`${taskId}-${taskIndex+1}`;taskIds.add(taskId);
      return {id:taskId,title:clean(task?.title,100)||`Turnover item ${taskIndex+1}`,detail:cabinDetail(taskId,clean(task?.detail,500))};
    });
    return {id,name:clean(group?.name,100)||`Area ${index+1}`,tasks};
  }).filter(group=>group.tasks.length);
}
