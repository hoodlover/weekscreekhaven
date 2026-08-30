import { appendPropertyRecord, getContractors } from '../_lib/property-store.js';
import { json, requireAdmin } from '../_lib/security.js';

const neighbors = [
  ['John Dodson','49 Huey Springs Rd','','404-922-3445 (Cell)',''],
  ['James Muehlenbrock','49 Huey Springs Rd','jim.muehlenbrock@gmail.com','706-838-4288 (Cabin)',''],
  ['Curtis & Nicki Hopfinger','67 Long Ridge Rd','curthopf@tds.net','706-838-0445 (Cabin)',''],
  ['Larry & Martha Thomas','83 Long Ridge Rd','thom3216@bellsouth.net','404-218-9098 (Cell)',''],
  ['Brian Tharp','108 Long Ridge Rd','tharpbs@gmail.com','512-567-9769','337 Guava Ave, Marathon, FL 33050'],
  ['Jill Tharp','108 Long Ridge Rd','milemarkerparty@gmail.com','305-743-5466','337 Guava Ave, Marathon, FL 33050'],
  ['Joseph Massaro','156 Long Ridge Rd','lorjoem@aol.com','561-504-4962 (Cell)',''],
  ['Lori Massaro','156 Long Ridge Rd','','',''],
  ['Chase Broward','212 Long Ridge Rd','chase.broward@gmail.com','404-392-6382 (Cell)',''],
  ['Mark D. Chitwood','212 Long Ridge Rd','','',''],
  ['Ethan and Mary Collier','229 Long Ridge Rd','mary@collierbuild.com','423-315-3481','400 Harper Street, Chattanooga, TN 37405'],
  ['Phillip Collins','264 Long Ridge Rd','philmcollins51@gmail.com','210-286-9291 (Cell)','2013 River Way, Spring Branch, TX 78070'],
  ['Jerri B. Collins','264 Long Ridge Rd','jbcmagnolia@yahoo.com','210-269-1869 (Cell)','2013 River Way, Spring Branch, TX 78070'],
  ['Veronica Crockett','294 Long Ridge Rd','veronicacrockett@tds.net','770-856-7865 (Cell)','155 Bay Drive, Newnan, GA 30263'],
  ['Kolin Kirschenmann','294 Long Ridge Rd','','',''],
  ['Gus Ferrer','309 Long Ridge Rd','gusfer3@aol.com','954-540-3206 (Cell)','5220 King Arthur Ave, Davie, FL 33331'],
  ['Mona Ferrer','309 Long Ridge Rd','moferr58@gmail.com','954-540-2502 (Cell)','5220 King Arthur Ave, Davie, FL 33331'],
  ['Gary & Ana Keehner','339 Long Ridge Rd','gkdrummer@hotmail.com','941-780-3164 (Cell)',''],
  ['Mark and Delores Harwell','342 Long Ridge Rd','markrh1208@gmail.com','770-235-9289 (Cell)','724 Aluice Ln, Martinez, GA 30907'],
  ['Lee & Leslie McDonald, Neil Johnston','355 Long Ridge Rd','ljeanmcjay@gmail.com','404-992-1650 (Cell); 706-838-5569 (Cabin)','3750 Peachtree Rd NE Apt. 1102, Atlanta, GA 30319'],
  ['Randy Sumner','359 Long Ridge Rd','sumnerrandy621@gmail.com','229-344-5432','154 Camp Osborne Rd, Sylvester, GA 31791'],
  ['Selena Sumner','359 Long Ridge Rd','sumnerselena@yahoo.com','229-344-6463','154 Camp Osborne Rd, Sylvester, GA 31791'],
  ['Todd Milbert','416 Long Ridge Rd','','321-355-8882 (Cell)','503 Poinsettia Rd, Melbourne Beach, FL 32951'],
  ['Helene Milbert','416 Long Ridge Rd','coasttocabin@gmail.com','954-444-4111 (Cell)','503 Poinsettia Rd, Melbourne Beach, FL 32951'],
  ['Britt Barret & Scott Reynolds','423 Long Ridge Rd','britt.barrett@gmail.com','678-478-6465 (Cell); 770-639-6959 (Home)','497 Patterson Ave SE, Atlanta, GA 30316'],
  ['David Savage Jr.','489 Long Ridge Rd','','770-313-5859 (Cell)',''],
  ['Dewitt Rogers','507 Long Ridge Rd','dewitt.rogers@gmail.com','404-803-0591 (Cell)','360 Glendale Ave, Decatur, GA 30030'],
  ['Claire Rogers','507 Long Ridge Rd','chrogers1@comcast.net','404-803-0316 (Cell)','360 Glendale Ave, Decatur, GA 30030'],
  ['John Belk','241 Weeks Creek Rd','JHBelk@gmail.com','314-606-6093 (Cell); 706-838-0480 (Cabin)','12779 Bennington Common Lane, St. Louis, MO 63146'],
  ['Ronald Baughman','305 Weeks Creek Rd','ronbaughman@bellsouth.net','251-408-1426 (Cell)','4109 Argenta Way, Pensacola, FL 32504'],
  ['Gail Baughman','305 Weeks Creek Rd','','','4109 Argenta Way, Pensacola, FL 32504'],
  ['Brian and Jennifer Sekel','363 Weeks Creek Rd','thebootleggerblueridge@gmail.com','717-940-6916','4710 70th Ave E, Ellenton, FL 34222'],
].map(([name,address,email,phone,otherAddress]) => ({ name, address, email, phone, otherAddress }));

const unlistedAddresses = ['57 Heather Lane','81 Heather Lane','245 Weeks Creek Rd','249 Weeks Creek Rd','421 Weeks Creek Rd','445 Weeks Creek Rd','487 Weeks Creek Rd','494 Weeks Creek Rd'];

const poa = {
  name: 'Heatherwood Phase II Property Owners Association',
  mailingAddress: 'P.O. Box 2775, Blue Ridge, GA 30513',
  email: 'heatherwoodphase2poa@gmail.com',
  board: [
    { role: 'President', name: 'John Belk' },
    { role: 'Vice President', name: 'Ethan Collier' },
    { role: 'Secretary / Treasurer', name: 'Chase Broward' },
  ],
  responsibilities: ['Operate the three-well community water system','Arrange road maintenance for Weeks Creek Road, Long Ridge Road, and Heather Lane','Administer the Heatherwood Phase II covenants'],
  currentDues: { year: 2026, amountCents: 30000, purpose: 'Road maintenance', due: 'Upon receipt; a $40 late fee applied after the February 7, 2026 annual meeting.' },
  paymentNote: 'Make checks payable to Heatherwood Phase II POA and mail them to the P.O. box. For bank bill pay, use the property street address without city/state as the account number.',
  annualRhythm: ['Board sets the next year’s road and water dues in December.','Annual invoices are generally sent in early January and are normally payable by January 31.','The annual property-owner meeting is held in the first quarter; 2026 meeting: February 7 at 2:00 PM, United Community Bank Community Room, 4000 Appalachian Highway, Blue Ridge.'],
  covenants: ['Residential or farm use only; no nuisance or offensive activity.','Permanent dwellings must have at least 864 heated square feet, excluding porches, patios, and carports, and permanent homes must be log construction.','No mobile homes, house trailers, campers, tents, or non-permanent dwellings without prior approval; temporary camping equipment is limited to 30 days.','No dumping, garbage accumulation, junk vehicles, or abandoned vehicles.','No lot resubdivision except by the developer; utility easements and underground utilities are addressed in the covenants.','Owners pay an equal annual road-maintenance fee per lot and must maintain lots, roadways, and frontages, including debris, grass, and dead/downed trees.'],
};

const compliance = [
  { title: 'STVR registration and posting', detail: 'Fannin County requires STVR registration and reporting. Post the Accommodation Excise Tax Certificate, local point-of-contact information, maximum occupancy, and the county noise rules inside the cabin. The POA also recommends posting the covenants.' },
  { title: 'Local point of contact', detail: 'The local contact must be available within two hours, 24/7, while the cabin is occupied, and the certificate holder must keep that contact current with Fannin County.' },
  { title: 'Trash, parking, and signage', detail: 'Use proper trash pickup/storage, keep guest vehicles on the rental property without blocking rights-of-way, and maintain visible-from-road 911 address signage. A rental-company/contact sign is permitted and welcomed by the POA.' },
  { title: 'Firearms, fires, and fireworks', detail: 'The STVR rules prohibit discharging firearms, unconstrained fires, and fireworks on rental property.' },
  { title: 'Quiet hours', detail: 'The POA notice summarizes residential quiet hours as Sunday-Thursday 10:00 PM-6:00 AM and Friday-Saturday 11:00 PM-6:00 AM. During quiet hours, sound-amplifying devices and equipment are prohibited.' },
  { title: 'Noise complaints', detail: 'For an active violation, verify the exact street address and call the Fannin County Sheriff non-emergency dispatch at 706-632-2043. Possible paths include speaking with the guest, contacting the owner/local contact, or reporting to the sheriff.' },
];

const text = (value, max = 1000) => String(value || '').trim().slice(0, max);
const email = (value) => { const result = text(value, 160).toLowerCase(); return !result || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) ? result : null; };
const requiredContacts = [
  ['Primary owner','Primary owner'],['Backup owner','Backup owner'],['Local 24/7 Contact','Local 24/7 contact'],
  ['Cleaning','Cleaner / turnover'],['Garbage','Garbage / trash service'],['Locksmith','Locksmith'],
  ['HVAC','HVAC service'],['Electrical','Electrician'],['Plumbing','Plumber'],['Septic','Septic service'],
  ['Hot Tub','Hot tub service'],['Power Utility','Power utility / outage'],['Insurance','Insurance emergency claim'],
];

async function contractorsWithRequiredPlaceholders() {
  const contractors = await getContractors();
  const categories = new Set(contractors.map((item) => String(item.category || '').toLowerCase()));
  const createdAt = new Date().toISOString();
  for (const [category, name] of requiredContacts) {
    if (categories.has(category.toLowerCase())) continue;
    const contractor = { id:`required-${category.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`, name:`Needed: ${name}`, category, phone:'', email:'', services:'', scheduling:'', notes:'Add this contact once confirmed. It will automatically appear in the Emergency Handbook.', createdAt, updatedAt:createdAt };
    await appendPropertyRecord({ type:'contractor_created', contractor, createdAt });
    contractors.push(contractor);
  }
  return contractors.sort((a,b)=>String(a.category).localeCompare(String(b.category))||String(a.name).localeCompare(String(b.name)));
}

function contractorFrom(body, current = {}) {
  const name = text(body?.name, 100);
  if (name.length < 2) throw new Error('Add the contractor or company name.');
  const parsedEmail = email(body?.email);
  if (parsedEmail === null) throw new Error('Enter a valid email address or leave it blank.');
  return { ...current, id: current.id || crypto.randomUUID(), name, category: text(body?.category, 60) || 'Other', phone: text(body?.phone, 60), email: parsedEmail, services: text(body?.services, 1500), scheduling: text(body?.scheduling, 1500), notes: text(body?.notes, 2000), updatedAt: new Date().toISOString(), createdAt: current.createdAt || new Date().toISOString() };
}

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  try {
    if (request.method === 'GET') return json(response, 200, { contractors: await contractorsWithRequiredPlaceholders(), neighbors, unlistedAddresses, poa, compliance }, { 'Cache-Control': 'no-store' });
    const createdAt = new Date().toISOString();
    if (request.method === 'POST') {
      const contractor = contractorFrom(request.body);
      await appendPropertyRecord({ type: 'contractor_created', contractor, createdAt });
      return json(response, 201, { contractor });
    }
    if (request.method === 'PATCH') {
      const contractors = await getContractors();
      const current = contractors.find((item) => item.id === text(request.body?.id, 80));
      if (!current) return json(response, 404, { error: 'Contractor not found.' });
      const contractor = contractorFrom(request.body, current);
      await appendPropertyRecord({ type: 'contractor_updated', contractor, createdAt });
      return json(response, 200, { contractor });
    }
    if (request.method === 'DELETE') {
      const contractorId = text(request.body?.id, 80);
      if (!(await getContractors()).some((item) => item.id === contractorId)) return json(response, 404, { error: 'Contractor not found.' });
      await appendPropertyRecord({ type: 'contractor_removed', contractorId, createdAt });
      return json(response, 200, { ok: true });
    }
    return json(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: error.message || 'The private property directory is temporarily unavailable.' });
  }
}
