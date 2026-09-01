import { appendBookingRecord } from './booking-store.js';
import { escapeEmailHtml, sendEmail } from './email.js';
import { bookingAccessCode, createAgreementToken } from './security.js';
import { createSquareBookingInvoice, createSquareFriendInvoice } from './square.js';
import { daysBetween, withEstimatedTaxesAndFees } from '../pricing.js';

export function referralCode(booking) {
  const first=String(booking.name||'GUEST').toUpperCase().replace(/[^A-Z]/g,'').slice(0,8)||'GUEST';
  return `WCH-${first}-${String(booking.id||'').replace(/-/g,'').slice(-6).toUpperCase()}`;
}

export async function automaticallyApproveBooking(booking) {
  const dates=booking.dateChoices[0], quote=dates.quote, createdAt=new Date().toISOString();
  const preTaxAmountCents=quote.totalCents;
  const tax=withEstimatedTaxesAndFees({totalCents:preTaxAmountCents,actualNights:Math.max(1,daysBetween(dates.arrival,dates.departure)),complimentary:quote.complimentary});
  const isFriendsAndFamily=Boolean(quote.friendsAndFamilyDiscount);
  const securityDepositCents=quote.complimentary?0:isFriendsAndFamily?5000:(Number(tax.refundableSecurityDepositCents)||30000);
  const stayAmountCents=tax.estimatedGrandTotalCents;
  const amountCents=stayAmountCents+securityDepositCents;
  const securityText=securityDepositCents?` Refundable security deposit: $${(securityDepositCents/100).toFixed(2)}.`:'';
  const earlyBirdDiscountCents=Math.max(0,Number(quote.earlyBirdDiscountCents)||0);
  const earlyBirdExpiresAt=earlyBirdDiscountCents?new Date(Date.parse(createdAt)+7*86400000).toISOString():null;
  let payment=null,paymentPlan='complimentary';
  if(amountCents>0&&quote.friendsAndFamilyDiscount){payment=await createSquareFriendInvoice({bookingId:booking.id,guestName:booking.name,email:booking.email,amountCents,securityDepositCents,arrival:dates.arrival,paymentChoice:booking.friendsPaymentChoice});paymentPlan=payment.fullPaymentRequired?'friends-family-full':'friends-family-deposit';}
  else if(amountCents>0){payment=await createSquareBookingInvoice({bookingId:booking.id,guestName:booking.name,email:booking.email,address:{line1:booking.billingAddress,city:booking.billingCity,state:booking.billingState,postalCode:booking.billingPostalCode},amountCents,securityDepositCents,depositBaseCents:preTaxAmountCents,arrival:dates.arrival,discountCents:quote.discountAmountCents||0,depositDueDays:earlyBirdDiscountCents?7:1});paymentPlan=payment.fullPaymentRequired?'full-payment':'deposit-balance';}
  const code=referralCode(booking);
  const hasBalancePlan=['deposit-balance','friends-family-deposit'].includes(paymentPlan);
  const changes={status:'pending-payment',autoApproved:true,approvedAt:createdAt,approvedChoice:0,originalAmountCents:quote.standardTotalCents||preTaxAmountCents,discountAmountCents:quote.discountAmountCents||0,earlyBirdDiscountCents,earlyBirdPercentage:quote.earlyBirdDiscount?.percentage||null,earlyBirdExpiresAt,preTaxAmountCents,stayAmountCents,securityDepositCents,amountCents,paymentPlan,complimentary:Boolean(quote.complimentary),salesTaxCents:tax.salesTaxCents,lodgingTaxCents:tax.lodgingTaxCents,stateHotelMotelFeeCents:tax.stateHotelMotelFeeCents,taxesAndFeesCents:tax.estimatedTaxesAndFeesCents,paymentUrl:payment?.url||null,squareInvoiceId:payment?.invoiceId||null,squareOrderId:payment?.orderId||null,squareCustomerId:payment?.customerId||null,invoiceSentAt:payment?createdAt:null,bookingPacketSentAt:createdAt,depositAmountCents:payment?.depositAmountCents??amountCents,balanceAmountCents:hasBalancePlan?payment.balanceAmountCents:0,balanceDueDate:hasBalancePlan?payment.balanceDueDate:null,depositDueDate:hasBalancePlan?payment.depositDueDate:null,referralCode:code};
  await appendBookingRecord({type:'status',bookingId:booking.id,changes,createdAt});
  const packetUrl=`https://www.weekscreekhaven.com/booking-packet.html?token=${encodeURIComponent(createAgreementToken(booking.id,365*86400))}`;
  const deadline=earlyBirdExpiresAt?` Sign the agreement and pay by ${earlyBirdExpiresAt.slice(0,10)} to keep the Early Bird price.`:'';
  const paymentText=payment?(paymentPlan==='friends-family-deposit'?`Pay $25 today to secure your dates, then pay the remaining balance whenever you like before ${payment.balanceDueDate}: ${payment.url}`:`Open your Square invoice: ${payment.url}`):'No payment is required.';
  const paymentButton=payment?`<p><a href="${escapeEmailHtml(payment.url)}" style="display:inline-block;background:#183c2d;color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:bold">${paymentPlan==='friends-family-deposit'?'Pay $25 today':'Open Square invoice'}</a></p>`:'<p><strong>No payment is required.</strong></p>';
  const paymentSummary=paymentPlan==='friends-family-deposit'?`Pay $25 today to secure your dates, then pay the remaining balance whenever you like before ${payment.balanceDueDate}.`:payment?'Your Square invoice is ready.':'No payment is required.';
  const checkout=isFriendsAndFamily?'flexible—there is no set time unless Lance or Heather lets you know personally':(booking.lateCheckout?'noon':'11:00 AM');
  const bookingCode=bookingAccessCode(booking.id);
  await sendEmail({to:booking.email,toName:booking.name,templateKey:'booking-approved',templateVariables:{guestName:booking.name,arrival:dates.arrival,departure:dates.departure,total:`$${(amountCents/100).toFixed(2)}`,paymentText:`${paymentText}${deadline}`,packetUrl,checkout,bookingCode},subject:'Complete your Weeks Creek Haven reservation',text:`Hi ${booking.name},\n\nYour reservation details for ${dates.arrival} through ${dates.departure} are ready. These dates remain available to other guests until your deposit is received; the first completed deposit secures them. Stay and taxes: $${(stayAmountCents/100).toFixed(2)}.${securityText} Total due: $${(amountCents/100).toFixed(2)}. ${paymentText}${deadline}\n\nComplete and manage your reservation: ${packetUrl}\nGuest Guide reservation code: ${bookingCode}`,html:`<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">Complete your reservation</h1><p>Hi ${escapeEmailHtml(booking.name)},</p><p>Your reservation details are ready for <strong>${dates.arrival} through ${dates.departure}</strong>. These dates remain open until a deposit is received; the first completed deposit secures them. Your stay and taxes are <strong>$${(stayAmountCents/100).toFixed(2)}</strong>.${securityDepositCents?` A <strong>$${(securityDepositCents/100).toFixed(2)} refundable security deposit</strong> is listed separately.`:''} Total due: <strong>$${(amountCents/100).toFixed(2)}</strong>.</p><p>${escapeEmailHtml(paymentSummary+deadline)}</p>${paymentButton}<p><a href="${escapeEmailHtml(packetUrl)}" style="display:inline-block;background:#a45d41;color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Complete your reservation</a></p><p><strong>Guest Guide reservation code:</strong> ${bookingCode}</p></div>`});
  return {...booking,...changes};
}
