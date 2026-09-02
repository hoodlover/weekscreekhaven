import { guestFirstName } from './guest-name.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SENDER_ENDPOINT = 'https://api.sender.net/v2/message/send';

const GUEST_TEMPLATE_ACTIONS = {
  'booking-approved':[['paymentUrl','Open Square invoice'],['packetUrl','Complete your reservation']],
  'booking-packet':[['packetUrl','Open reservation details']],
  'payment-received':[['packetUrl','Sign the rental agreement']],
  'booking-confirmed':[['packetUrl','Open reservation details']],
  'stay-selected':[['packetUrl','Open reservation details']],
  'guest-invitation':[['hubUrl','Open your invitation']],
  'deposit-reminder':[['paymentUrl','Open Square invoice']],
  'deposit-grace':[['paymentUrl','Open Square invoice']],
  'signed-unpaid-reminder':[['paymentUrl','Open Square invoice']],
  'selected-unpaid-reminder':[['paymentUrl','Open Square invoice']],
  'balance-reminder':[['paymentUrl','Open Square invoice']],
  'balance-grace':[['paymentUrl','Open Square invoice']],
  'pre-arrival-guide':[['guestGuideUrl','Open Guest Guide']],
  'checkin-reminder':[['guestGuideUrl','Open Guest Guide']],
  'midstay-rebook':[['bookingUrl','Choose your next dates']],
  'checkout-reminder':[['checkoutChecklistUrl','Open checkout checklist']],
  'checkout-checklist-followup':[['checkoutChecklistUrl','Open checkout checklist']],
  'thank-you-review':[['reviewUrl','Rate your stay'],['guestBookUrl','Sign the guest book']],
  'return-referral-offer':[['bookingUrl','Book another stay']],
};

function guestTemplateHtml(text,templateKey,variables){
  const actions=(GUEST_TEMPLATE_ACTIONS[templateKey]||[]).map(([key,label])=>({url:String(variables[key]||''),label})).filter(action=>/^https:\/\//.test(action.url));
  let visible=String(text||'');
  for(const action of actions)visible=visible.split(action.url).join('');
  visible=visible.replace(/:\s*(?=\n|$)/gm,'.').replace(/[ \t]+\n/g,'\n').trim();
  const paragraphs=visible.split(/\n{2,}/).filter(Boolean).map(part=>`<p style="margin:0 0 16px">${escapeEmailHtml(part).replace(/\n/g,'<br>')}</p>`).join('');
  const buttons=actions.map((action,index)=>`<a href="${escapeEmailHtml(action.url)}" style="display:inline-block;background:${index?'#a45d41':'#183c2d'};color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:bold;margin:0 8px 10px 0">${action.label}</a>`).join('');
  return `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:620px;margin:auto"><div style="background:#183c2d;color:#fff;padding:18px 22px;border-radius:14px 14px 0 0"><div style="color:#e5b67e;font-size:12px;font-weight:bold;letter-spacing:.16em">WEEKS CREEK HAVEN</div><div style="font-family:Georgia,serif;font-size:25px;font-weight:bold;margin-top:3px">A little piece of Blue Ridge</div></div><div style="border:1px solid #ded3c1;border-top:0;padding:24px 22px;border-radius:0 0 14px 14px;background:#fffdf8">${paragraphs}${buttons?`<div style="margin:4px 0 18px">${buttons}</div>`:''}</div></div>`;
}

const TEXT_SIGNATURE_PATTERN=/(?:^|\n)\s*(Heather\s*&\s*Lance|Heather and Lance)\s*$/i;
const HTML_SIGNATURE_PATTERN=/<p[^>]*>\s*(?:<strong[^>]*>)?\s*(Heather\s*&amp;\s*Lance|Heather and Lance)\s*(?:<\/strong>)?\s*<\/p>/i;
const WARM_PATTERN=/(just reply|reply if|let us know|happy to help|we’re here|we are here|glad to help)/i;
function addHtmlClosing(html,{addHelp,addSignature}){
  if(!html)return html;
  const closing=`${addHelp?'<p style="margin:20px 0 0;color:#5f554d">If you have any questions, just reply—we’re always happy to help.</p>':''}${addSignature?'<p style="margin:20px 0 0;color:#183c2d;font-weight:bold">Heather &amp; Lance</p>':''}`;
  if(!closing)return html;
  const index=html.lastIndexOf('</div>');
  return index>=0?`${html.slice(0,index)}${closing}${html.slice(index)}`:`${html}${closing}`;
}
function warmPersonalEmail(text,html){
  const originalText=String(text||''),addHelp=!WARM_PATTERN.test(originalText),addTextSignature=!TEXT_SIGNATURE_PATTERN.test(originalText),addHtmlSignature=!HTML_SIGNATURE_PATTERN.test(String(html||''));
  return {
    text:`${originalText.trim()}${addHelp?'\n\nIf you have any questions, just reply—we’re always happy to help.':''}${addTextSignature?'\n\nHeather & Lance':''}`,
    html:addHtmlClosing(html,{addHelp,addSignature:addHtmlSignature}),
  };
}

export function emailConfigured() {
  return Boolean(
    (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)
    || (process.env.SENDER_API_TOKEN && process.env.SENDER_FROM_EMAIL),
  );
}

async function sendWithResend({ to, subject, text, html, attachments, idempotencyKey }) {
  const fromName = process.env.RESEND_FROM_NAME || 'Weeks Creek Haven';
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: `${fromName} <${process.env.RESEND_FROM_EMAIL}>`,
      to: [to],
      subject,
      text,
      html,
      ...(process.env.RESEND_REPLY_TO || process.env.OWNER_EMAIL
        ? { reply_to: process.env.RESEND_REPLY_TO || process.env.OWNER_EMAIL }
        : {}),
      ...(attachments?.length ? { attachments } : {}),
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || result.error?.message || 'Resend could not deliver the email.');
  }
  return { ...result, provider: 'resend' };
}

async function sendWithSender({ to, toName, subject, text, html, attachments }) {
  if (attachments?.length) throw new Error('Email attachments require the Resend connection.');
  const response = await fetch(SENDER_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SENDER_API_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      from: {
        email: process.env.SENDER_FROM_EMAIL,
        name: process.env.SENDER_FROM_NAME || 'Weeks Creek Haven',
      },
      to: { email: to, name: toName || to },
      subject,
      text,
      html,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    throw new Error(result.message || 'Sender.com could not deliver the email.');
  }
  return { ...result, provider: 'sender' };
}

export async function sendEmail({ to, toName = '', subject, text, html, attachments = [], idempotencyKey = '', templateKey = '', templateVariables = {} }) {
  if (templateKey) {
    try {
      const { mergeEmailTemplates, renderTemplate } = await import('./email-library.js');
      let savedTemplates = [];
      try {
        const { getBookingCalendar } = await import('./booking-store.js');
        savedTemplates = (await getBookingCalendar()).emailTemplates || [];
      } catch (error) {
        console.error('Saved email templates could not be loaded; using the built-in copy.', error);
      }
      const template = mergeEmailTemplates(savedTemplates).find(item => item.id === templateKey);
      if (template && template.enabled !== false) {
        const variables = template.audience === 'Guest'
          ? { ...templateVariables, guestName: guestFirstName(templateVariables.guestName || toName) }
          : templateVariables;
        if (template.audience === 'Guest') toName = guestFirstName(toName || templateVariables.guestName);
        subject = renderTemplate(template.subject || subject, variables);
        if (template.body) {
          text = renderTemplate(template.body, variables);
          if(template.audience==='Guest'){
            html=guestTemplateHtml(text,templateKey,variables);
          }else html = `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px">${text.split(/\n{2,}/).map(part => `<p>${escapeEmailHtml(part).replace(/\n/g, '<br>')}</p>`).join('')}</div>`;
        }
      } else if (template?.enabled === false) return { skipped: true, templateKey };
    } catch (error) {
      console.error(`Email template ${templateKey} could not be loaded; using the built-in copy.`, error);
    }
  }
  const ownerAddress=String(process.env.OWNER_EMAIL||'').trim().toLowerCase();
  if(!ownerAddress||String(to||'').trim().toLowerCase()!==ownerAddress)({text,html}=warmPersonalEmail(text,html));
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
    return sendWithResend({ to, toName, subject, text, html, attachments, idempotencyKey });
  }
  if (process.env.SENDER_API_TOKEN && process.env.SENDER_FROM_EMAIL) {
    return sendWithSender({ to, toName, subject, text, html, attachments });
  }
  throw new Error('Transactional email is not connected yet.');
}

export function escapeEmailHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}
