import { sendEmail, escapeEmailHtml } from '../_lib/email.js';

const [reportType, recipient] = process.argv.slice(2);
const reportNames = {
  weekly: 'Weekly website caretaker report',
  monthly: 'Monthly bookkeeping report',
};

if (!reportNames[reportType]) {
  throw new Error('Report type must be weekly or monthly.');
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(recipient || ''))) {
  throw new Error('Enter a valid owner report recipient.');
}

let report = '';
for await (const chunk of process.stdin) report += chunk;
report = report.trim();
if (!report) throw new Error('The owner report is empty.');

const now = new Date();
const easternDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(now);
const period = reportType === 'monthly' ? easternDate.slice(0, 7) : easternDate;
const subject = `Weeks Creek Haven — ${reportNames[reportType]} — ${period}`;
const html = `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:680px"><h1 style="color:#183c2d">${escapeEmailHtml(reportNames[reportType])}</h1>${report.split(/\n{2,}/).map((section) => `<p>${escapeEmailHtml(section).replace(/\n/g, '<br>')}</p>`).join('')}</div>`;

const result = await sendEmail({
  to: recipient,
  toName: 'Heather',
  subject,
  text: report,
  html,
  idempotencyKey: `owner-${reportType}-report-${period}`,
});

console.log(JSON.stringify({ ok: true, provider: result.provider || 'configured email service' }));
