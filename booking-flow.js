import { money } from '/pricing.js';
    import { normalizedEmail, normalizedPhone as cleanPhone } from '/guest-identity.js';
    import { discountDescription, securityDepositCents, totalWithDeposit } from '/booking-price.js';
    const form=document.getElementById('booking-form'); const button=document.getElementById('submit'); const message=document.getElementById('form-message');
    const confirmationDialog=document.getElementById('confirmation-dialog'),confirmationTitle=document.getElementById('confirmation-title'),confirmationCopy=document.getElementById('confirmation-copy'),myBookingLink=document.getElementById('my-booking-link'),confirmationClose=document.getElementById('confirmation-close');
    confirmationClose.addEventListener('click',()=>confirmationDialog.close());
    const pricingState={rates:[],unavailable:[],requested:[],loaded:false,calendarError:'',discountQuotes:{},discountTimer:null,discountRequest:0,inviteSession:false,invitePricing:false,identityReady:false,quoteError:''};
    const friendsPayment=document.getElementById('friends-payment');
    let focusPriceWhenReady=false;
    const today=new Date(); today.setHours(0,0,0,0); const minimum=today.toISOString().slice(0,10);
    const addDays=(value,days)=>{ const date=new Date(`${value}T12:00:00`); date.setDate(date.getDate()+days); return date.toISOString().slice(0,10); };
    const validDate=(value)=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(`${value}T12:00:00`));
    const friendlyDate=(value)=>new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(new Date(`${value}T12:00:00`));
    const rangesOverlap=(first,second)=>first.arrival<second.departure&&second.arrival<first.departure;
    const monthStart=(date)=>new Date(date.getFullYear(),date.getMonth(),1,12);
    const monthKey=(date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
    const dateKey=(date)=>`${monthKey(date)}-${String(date.getDate()).padStart(2,'0')}`;
    const addMonths=(date,amount)=>new Date(date.getFullYear(),date.getMonth()+amount,1,12);
    const firstCalendarMonth=monthStart(today), lastCalendarStart=addMonths(firstCalendarMonth,17);
    const calendarState={1:{month:firstCalendarMonth}};
    const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const stayNights=(arrival,departure)=>Math.round((Date.parse(`${departure}T12:00:00`)-Date.parse(`${arrival}T12:00:00`))/86400000);
    const unavailableNight=(value)=>pricingState.unavailable.some((range)=>value>=range.arrival&&value<range.departure);
    const unavailableCheckout=(value)=>!unavailableNight(value)&&pricingState.unavailable.some((range)=>value===range.departure);
    const requestMarkerForDate=(value)=>{
      const night=pricingState.requested.find((range)=>range.state==='deposit-pending'&&value>=range.arrival&&value<range.departure)||pricingState.requested.find((range)=>value>=range.arrival&&value<range.departure);
      if(night)return {state:night.state,checkout:false};
      const checkout=pricingState.requested.find((range)=>range.state==='deposit-pending'&&value===range.departure)||pricingState.requested.find((range)=>value===range.departure);
      return checkout?{state:checkout.state,checkout:true}:null;
    };
    const stayConflicts=(arrival,departure)=>pricingState.unavailable.some((range)=>rangesOverlap({arrival,departure},range));
    function possibleOfferPercent(index,quote){
      const offer=document.getElementById(`discount-request-${index}`).value,arrival=form.elements[`arrival${index}`].value,departure=form.elements[`departure${index}`].value,nights=quote?.actualNights||0;
      if(!offer||!quote)return 0;
      if(offer.startsWith('Pay in full')||offer.startsWith('Book direct')||offer.startsWith('Returning guest')||offer.startsWith('Guest referral'))return 10;
      if(offer.startsWith('Rebook before checkout')||offer.startsWith('Last-minute opening'))return offer.startsWith('Last-minute')&&Math.floor((Date.parse(`${arrival}T12:00:00`)-today.getTime())/86400000)>7?0:15;
      if(offer.startsWith('Extended stay'))return nights>=7?20:nights>=4?10:0;
      if(offer.startsWith('Off-season')){for(let value=arrival;value<departure;value=addDays(value,1)){const month=Number(value.slice(5,7));if(month<1||month>3)return 0;}return 20;}
      if(offer.startsWith('Midweek stay')){for(let value=arrival;value<departure;value=addDays(value,1)){const day=new Date(`${value}T12:00:00`).getDay();if(day===5||day===6)return 0;}return 20;}
      return 0;
    }
    function renderPossibleSavings(index,quote){
      const output=document.getElementById(`possible-savings-${index}`),offer=document.getElementById(`discount-request-${index}`).value;
      if(!offer){output.textContent='Choose an offer to see possible savings for these dates.';return;}
      if(!quote){output.textContent='Choose dates to see possible savings.';return;}
      if(quote.friendsAndFamilyDiscount){output.textContent='Your preferred rate is already applied. Offers do not stack.';return;}
      const percent=possibleOfferPercent(index,quote);
      if(!percent){output.textContent='These dates do not currently meet this offer’s listed conditions.';return;}
      const offerBase=quote.standardTotalCents||quote.totalCents,savings=Math.round(offerBase*percent/100),discounted=Math.max(0,offerBase-savings);
      output.textContent=`Possible ${percent}% savings: ${money(savings)} · about ${money(discounted)} before taxes if available.`;
    }
    function currentQuote(){const cached=pricingState.discountQuotes[1];return cached?.signature===quoteSignature(1)?cached.quote:null;}
    function renderCalendarPrice(index,arrival,departure){
      const panel=document.getElementById(`calendar-price-${index}`),quote=currentQuote();
      const valid=pricingState.loaded&&pricingState.identityReady&&validDate(arrival)&&validDate(departure)&&departure>arrival&&!stayConflicts(arrival,departure);
      document.getElementById('continue-dates').disabled=!valid||!quote;
      const status=document.getElementById('price-status');
      status.textContent=pricingState.quoteError||(valid?(quote?'Price includes the discount shown above. Continue when these dates work for you.':'Checking your price…'):'Select available arrival and checkout dates to see your total.');
      document.getElementById('retry-price').hidden=!pricingState.quoteError;
      panel.hidden=!valid||!quote;
      if(panel.hidden){renderPossibleSavings(index,null);return;}
      const deposit=securityDepositCents(quote);
      panel.querySelector('.calendar-price-main strong').textContent=money(totalWithDeposit(quote));
      panel.querySelector('.calendar-price-detail span').textContent=`Stay ${money(quote.totalCents)} + estimated taxes and government fees ${money(quote.estimatedTaxesAndFeesCents)} + refundable security deposit ${money(deposit)}. Cleaning included${quote.passThroughCents?' · required charges included in stay price':''}.`;
      panel.querySelector('.calendar-deposit-note').textContent=quote.complimentary?'No payment required. Complete the rental agreement to confirm your stay.':quote.friendsAndFamilyDiscount?'Choose $25 toward your stay or payment in full at checkout. The separate $50 security deposit is refundable; balance due seven days before arrival.':`A 20% reservation payment (about ${money(Math.round(quote.totalCents*.20))}) is due ${quote.earlyBirdDiscount?'within seven days after booking':'within 24 hours after booking'}. Balance due seven days before arrival; stays starting within seven days require full payment.`;
      panel.querySelector('.calendar-season').textContent=discountDescription(quote);
      renderPossibleSavings(index,quote);
    }
    function renderCalendar(index){
      const months=document.getElementById(`calendar-months-${index}`),prompt=document.getElementById(`calendar-prompt-${index}`),summary=document.getElementById(`calendar-summary-${index}`),arrival=form.elements[`arrival${index}`].value,departure=form.elements[`departure${index}`].value,state=calendarState[index];
      const previous=document.querySelector(`[data-calendar-prev="${index}"]`),next=document.querySelector(`[data-calendar-next="${index}"]`);
      months.replaceChildren(); previous.disabled=!pricingState.loaded||monthKey(state.month)<=monthKey(firstCalendarMonth); next.disabled=!pricingState.loaded||monthKey(state.month)>=monthKey(lastCalendarStart);
      if(!pricingState.loaded){renderCalendarPrice(index,arrival,departure);prompt.textContent=pricingState.calendarError||'Loading live availability…';summary.textContent=pricingState.calendarError?'Please refresh this page to try loading availability again.':'Reserved and owner-blocked nights will appear here.';return;}
      prompt.textContent=!arrival?'Choose your arrival date':!departure?'Arrival selected — now choose checkout':'Dates selected — choose a new arrival date to change them';
      const visibleMonthCount=window.matchMedia('(max-width:560px)').matches?1:2;
      for(let monthOffset=0;monthOffset<visibleMonthCount;monthOffset++){
        const visibleMonth=addMonths(state.month,monthOffset),month=document.createElement('section'),heading=document.createElement('h4'),weekdayRow=document.createElement('div'),days=document.createElement('div');
        month.className='calendar-month'; heading.textContent=new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(visibleMonth); weekdayRow.className='calendar-weekdays'; days.className='calendar-days';
        weekdays.forEach((label)=>{const day=document.createElement('span');day.className='calendar-weekday';day.textContent=label;weekdayRow.append(day);});
        for(let blank=0;blank<visibleMonth.getDay();blank++){const spacer=document.createElement('span');spacer.className='calendar-blank';spacer.setAttribute('aria-hidden','true');days.append(spacer);}
        const dayCount=new Date(visibleMonth.getFullYear(),visibleMonth.getMonth()+1,0).getDate();
        for(let dayNumber=1;dayNumber<=dayCount;dayNumber++){
          const value=dateKey(new Date(visibleMonth.getFullYear(),visibleMonth.getMonth(),dayNumber,12)),day=document.createElement('button'),isPast=value<minimum,isBlocked=unavailableNight(value),blockedCheckout=unavailableCheckout(value),requestMarker=requestMarkerForDate(value),requestState=requestMarker?.state||'',bookingCheckout=blockedCheckout||Boolean(requestMarker?.checkout),choosingCheckout=Boolean(arrival&&!departure),validCheckout=choosingCheckout&&value>arrival&&!stayConflicts(arrival,value),checkoutOnly=validCheckout&&isBlocked;
          day.type='button';day.className='calendar-day';day.dataset.calendarDay=value;day.dataset.calendarIndex=index;day.textContent=String(dayNumber);
          day.disabled=isPast||(choosingCheckout&&value>arrival?!validCheckout:isBlocked);
          if(value===minimum)day.classList.add('is-today');
          if(isPast)day.classList.add('is-past');
          if(isBlocked)day.classList.add('is-blocked');
          if(requestState&&!isPast)day.classList.add(requestState==='deposit-pending'?'is-deposit-pending':'is-requested');
          if(bookingCheckout&&!isPast)day.classList.add('is-booking-checkout');
          if(arrival&&departure&&value>arrival&&value<departure)day.classList.add('is-in-range');
          if(value===arrival)day.classList.add('is-arrival');
          if(value===departure)day.classList.add('is-departure');
          if(checkoutOnly)day.classList.add('is-checkout-only');
          const spoken=new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(new Date(`${value}T12:00:00`));
          const stateLabel=isPast?'past date':checkoutOnly?'available as checkout only':value===arrival?'selected arrival':value===departure?'selected checkout':bookingCheckout?'checkout date, available for a new arrival':requestState==='deposit-pending'?'deposit pending, temporarily held':requestState==='requested'?'requested, still available':day.disabled&&isBlocked?'unavailable':'available';
          day.setAttribute('aria-label',`${spoken}, ${stateLabel}`);day.setAttribute('aria-pressed',String(value===arrival||value===departure));
          days.append(day);
        }
        month.append(heading,weekdayRow,days);months.append(month);
      }
      renderCalendarPrice(index,arrival,departure);
      summary.replaceChildren();
      if(!arrival){summary.textContent='Choose an arrival date, then choose your checkout date.';return;}
      const strong=document.createElement('strong');
      if(!departure){strong.textContent=friendlyDate(arrival);summary.append(strong,document.createTextNode(' selected for arrival. Now choose your checkout date.'));return;}
      const nights=stayNights(arrival,departure);strong.textContent=`${friendlyDate(arrival)} → ${friendlyDate(departure)}`;summary.append(strong,document.createTextNode(` · ${nights} night${nights===1?'':'s'}${form.elements.guests.value?'':' · Estimate below uses the 1–4 guest tier.'}`));
    }
    function renderCalendars(){renderCalendar(1);}
    function chooseCalendarDate(index,value){
      if(!pricingState.loaded||value<minimum)return;
      const arrival=form.elements[`arrival${index}`],departure=form.elements[`departure${index}`];
      if(!arrival.value||departure.value||value<=arrival.value){if(unavailableNight(value))return;arrival.value=value;departure.value='';}
      else {if(stayConflicts(arrival.value,value))return;departure.value=value;}
      document.getElementById('calendar-selection').hidden=true;
      focusPriceWhenReady=Boolean(departure.value);
      delete pricingState.discountQuotes[index];quoteChanged(index);
    }
    form.addEventListener('click',(event)=>{
      const day=event.target.closest('[data-calendar-day]');if(day&&!day.disabled){chooseCalendarDate(day.dataset.calendarIndex,day.dataset.calendarDay);return;}
      const previous=event.target.closest('[data-calendar-prev]'),next=event.target.closest('[data-calendar-next]');
      if(previous||next){const index=Number((previous||next).dataset[previous?'calendarPrev':'calendarNext']),amount=previous?-1:1;calendarState[index].month=addMonths(calendarState[index].month,amount);renderCalendar(index);}
    });
    const normalizedPhone=()=>{const digits=String(form.elements.phone.value||'').replace(/\D/g,'');return digits.length===11&&digits.startsWith('1')?digits.slice(1):digits;};
    const quoteSignature=(index)=>`${form.elements[`arrival${index}`].value}|${form.elements[`departure${index}`].value}|${form.elements.guests.value}|${form.elements.dogs.value}|${form.elements.lateCheckout.checked?'1':'0'}|${normalizedPhone()}|${normalizedEmail(form.elements.email.value)}`;
    function renderQuote(){
      const quote=currentQuote();friendsPayment.hidden=!(quote?.friendsAndFamilyDiscount&&!quote.complimentary);
      form.elements.lateCheckout.closest('label').querySelector('span').textContent=quote?.friendsAndFamilyDiscount?'Noon checkout · any charge follows your saved rate and appears in the total. Check-in begins at 4:00 PM.':'Add noon checkout for $50. Standard checkout is 11:00 AM. Check-in begins at 4:00 PM.';
      document.getElementById('discount-guide').hidden=Boolean(quote?.friendsAndFamilyDiscount||pricingState.invitePricing);
      const summary=document.getElementById('reviewed-stay');
      summary.textContent=quote?`${friendlyDate(form.elements.arrival1.value)} through ${friendlyDate(form.elements.departure1.value)} · ${form.elements.guests.value} guests · Estimated total ${money(totalWithDeposit(quote))}, including taxes and refundable deposit. ${discountDescription(quote)}`:pricingState.quoteError||'Checking your updated price…';
      button.disabled=!quote;
    }
    function checkAvailability(index){
      const fieldset=document.getElementById(`choice-${index}`),status=document.getElementById(`availability-${index}`),arrival=form.elements[`arrival${index}`].value,departure=form.elements[`departure${index}`].value;
      fieldset.classList.remove('unavailable'); status.hidden=true; status.className='availability-status'; status.replaceChildren();
      if(!pricingState.loaded||!validDate(arrival)||!validDate(departure)||departure<=arrival)return false;
      const conflict=pricingState.unavailable.some((range)=>rangesOverlap({arrival,departure},range));
      const text=document.createElement('span');
      if(conflict){
        fieldset.classList.add('unavailable'); status.classList.add('conflict'); text.textContent='These dates overlap a reserved or blocked stay. Choose another arrival and checkout above.';status.append(text);
      }else{
        status.classList.add('available'); text.textContent='These dates are currently available. Review your price, then continue to your details.'; status.append(text);
      }
      status.hidden=false; return conflict;
    }
    function hasAvailabilityConflict(){return checkAvailability(1);}
    function quoteChanged(index){
      ++pricingState.discountRequest;pricingState.discountQuotes={};pricingState.quoteError='';
      renderCalendar(index);renderQuote();checkAvailability(index);scheduleDiscountQuotes();
    }
    function scheduleDiscountQuotes(){clearTimeout(pricingState.discountTimer);pricingState.discountTimer=setTimeout(refreshDiscountQuotes,350);}
    function setDogsVisibility(approved){const field=document.getElementById('dog-field');field.hidden=!approved;if(!approved)form.elements.dogs.value='0';}
    async function refreshDiscountQuotes(){
      if(!pricingState.loaded||!pricingState.identityReady)return;
      const arrival=form.elements.arrival1.value,departure=form.elements.departure1.value,guests=Number(form.elements.guests.value),dogs=Number(form.elements.dogs.value);
      if(!guests||!validDate(arrival)||!validDate(departure)||departure<=arrival||stayConflicts(arrival,departure))return;
      const requestId=++pricingState.discountRequest,signature=quoteSignature(1);
      pricingState.quoteError='';renderCalendars();renderQuote();
      try {
        const response=await fetch('/api/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({arrival,departure,guests,dogs,phone:normalizedPhone(),email:normalizedEmail(form.elements.email.value),lateCheckout:form.elements.lateCheckout.checked})});
        const data=await response.json();
        if(requestId!==pricingState.discountRequest||signature!==quoteSignature(1))return;
        if(!response.ok||!data.quote)throw new Error(data.error||'Your price could not be checked. Please try again.');
        const approved=Boolean(data.quote.friendsAndFamilyDiscount);
        setDogsVisibility(approved);
        if(dogs&&!approved){quoteChanged(1);return;}
        pricingState.discountQuotes[1]={signature,quote:data.quote};
        pricingState.invitePricing=approved;
        updateWelcome(approved);
      }catch(error){if(requestId!==pricingState.discountRequest||signature!==quoteSignature(1))return;pricingState.discountQuotes={};pricingState.quoteError=error.message||'Your price could not be checked. Please try again.';}
      renderCalendars();renderQuote();
      if(focusPriceWhenReady&&currentQuote()&&!datesStep.hidden){focusPriceWhenReady=false;document.getElementById('calendar-price-1').scrollIntoView({behavior:'smooth',block:'center'});}
    }
    form.elements.guests.addEventListener('change',()=>quoteChanged(1));
    form.elements.dogs.addEventListener('change',()=>quoteChanged(1));
    form.elements.lateCheckout.addEventListener('change',()=>quoteChanged(1));
    let returningGuestTimer=0,returningGuestSignature='';
    async function restoreReturningGuest(){const phone=String(form.elements.phone.value||'').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,''),email=String(form.elements.email.value||'').trim().toLowerCase(),signature=`${phone}|${email}`;if(phone.length!==10||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||signature===returningGuestSignature)return;returningGuestSignature=signature;try{const response=await fetch('/api/returning-guest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,email})}),data=await response.json();if(!response.ok||!data.found||signature!==`${normalizedPhone()}|${normalizedEmail(form.elements.email.value)}`)return;for(const [name,value] of Object.entries(data.profile||{})){const field=form.elements[name];if(field&&!field.value&&value!==''&&value!==null)field.value=String(value);}message.className='message success';message.textContent='Welcome back! We filled in the booking details saved from your previous stay.';message.hidden=false;}catch{}}
    function scheduleReturningGuest(){clearTimeout(returningGuestTimer);returningGuestTimer=setTimeout(restoreReturningGuest,450);}
    form.elements.phone.addEventListener('input',()=>{quoteChanged(1);scheduleReturningGuest();});
    form.elements.email.addEventListener('input',()=>{quoteChanged(1);scheduleReturningGuest();});
    const ownerQuestionField=document.getElementById('owner-question-field'),ownerQuestions=form.elements.ownerQuestions;
    function updateBookingIntent(){const intent=form.elements.bookingIntent.value,wantsQuestions=intent==='questions';ownerQuestionField.hidden=!wantsQuestions;ownerQuestions.required=wantsQuestions;button.textContent=wantsQuestions?'Send questions to owners':'Start secure checkout';}
    form.elements.bookingIntent.forEach(input=>input.addEventListener('change',updateBookingIntent));
    function updateOfferPolicy(index){renderCalendar(index);}
    document.querySelectorAll('[data-discount-request]').forEach(select=>select.addEventListener('change',()=>updateOfferPolicy(Number(select.dataset.discountRequest))));
    form.addEventListener('reset',()=>setTimeout(()=>updateOfferPolicy(1)));updateOfferPolicy(1);
    const selectedParams=new URLSearchParams(location.search), selectedArrival=selectedParams.get('arrival1'), selectedDeparture=selectedParams.get('departure1'),selectedGuests=selectedParams.get('guests');
    if(selectedGuests&&Number(selectedGuests)>=1&&Number(selectedGuests)<=11)form.elements.guests.value=selectedGuests;
    if(selectedParams.get('lateCheckout')==='1')form.elements.lateCheckout.checked=true;
    if(validDate(selectedArrival)&&validDate(selectedDeparture)&&selectedArrival>=minimum&&selectedDeparture>=addDays(selectedArrival,1)){
      form.elements.arrival1.value=selectedArrival; form.elements.departure1.value=selectedDeparture; calendarState[1].month=monthStart(new Date(`${selectedArrival}T12:00:00`));
      const selectionNote=document.getElementById('calendar-selection'); selectionNote.textContent=`Your calendar selection was added: ${friendlyDate(selectedArrival)} through ${friendlyDate(selectedDeparture)}.`; selectionNote.hidden=false;
    }
    const guestDialog=document.getElementById('guest-dialog'),guestCheck=document.getElementById('guest-check'),guestError=document.getElementById('guest-error'),guestSubmit=document.getElementById('guest-check-submit');
    const datesStep=document.getElementById('dates-step'),detailsStep=document.getElementById('details-step');
    let greetingName='',identityRequest=0,reviewedTotal=null;
    function updateWelcome(privatePricing){
      const first=greetingName.trim().split(/\s+/)[0],name=first==='Abigail'?'Abby':first;
      const welcome=name?`Welcome, ${name}! `:'Welcome! ';
      document.getElementById('guest-welcome').textContent=welcome+(privatePricing?'Choose your dates to see your discount from Lance and Heather, already included in your price.':'Choose your dates to see your price and any automatic savings. You can check a guest profile discount with your phone number or email anytime.');
    }
    function showDates(focus=true){datesStep.hidden=false;detailsStep.hidden=true;if(focus){document.getElementById('dates-heading').focus();datesStep.scrollIntoView({behavior:'smooth',block:'start'});}}
    function continueWithDates(){
      const quote=currentQuote();if(!quote||!pricingState.loaded||hasAvailabilityConflict())return;
      reviewedTotal=totalWithDeposit(quote);datesStep.hidden=true;detailsStep.hidden=false;renderQuote();
      document.getElementById('details-heading').focus();detailsStep.scrollIntoView({behavior:'smooth',block:'start'});
    }
    document.getElementById('continue-dates').addEventListener('click',continueWithDates);
    document.getElementById('edit-dates').addEventListener('click',()=>showDates());
    document.getElementById('back-to-dates').addEventListener('click',event=>{event.preventDefault();showDates();});
    document.getElementById('retry-price').addEventListener('click',()=>quoteChanged(1));
    document.getElementById('check-profile').addEventListener('click',()=>{guestError.hidden=true;guestDialog.showModal();});
    function browseDates(){
      ++identityRequest;guestSubmit.disabled=false;pricingState.identityReady=true;guestDialog.close();showDates();
      focusPriceWhenReady=Boolean(form.elements.departure1.value);
      updateWelcome(pricingState.invitePricing);quoteChanged(1);
    }
    document.getElementById('guest-skip').addEventListener('click',browseDates);
    guestDialog.addEventListener('cancel',event=>{event.preventDefault();browseDates();});
    guestCheck.elements.contact.addEventListener('input',()=>guestCheck.elements.contact.setCustomValidity(''));
    guestCheck.addEventListener('submit',async event=>{
      event.preventDefault();guestError.hidden=true;
      const contact=guestCheck.elements.contact.value.trim(),email=contact.includes('@')?normalizedEmail(contact):'',phone=contact.includes('@')?'':cleanPhone(contact);
      if(!email&&!phone){guestCheck.elements.contact.setCustomValidity('Enter a valid phone number or email. You only need one.');guestCheck.elements.contact.reportValidity();return;}
      const requestId=++identityRequest;guestSubmit.disabled=true;
      try {
        const response=await fetch('/api/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'identify',phone,email})}),data=await response.json();
        if(requestId!==identityRequest)return;
        if(!response.ok)throw new Error(data.error||'We could not check your profile. Please try again.');
        if(!pricingState.inviteSession){form.elements.phone.value=phone;form.elements.email.value=email;}
        greetingName=guestCheck.elements.firstName.value.trim();
        if(greetingName&&!form.elements.name.value)form.elements.name.value=greetingName;
        pricingState.invitePricing=data.privatePricing;pricingState.identityReady=true;setDogsVisibility(data.privatePricing);
        updateWelcome(data.privatePricing);guestDialog.close();showDates();focusPriceWhenReady=Boolean(form.elements.departure1.value);quoteChanged(1);
      }catch(error){if(requestId===identityRequest){guestError.textContent=error.message;guestError.hidden=false;}}
      finally{if(requestId===identityRequest)guestSubmit.disabled=false;}
    });
    async function startGuestFlow(){
      try {
        const response=await fetch('/api/invite-profile',{cache:'no-store'});
        if(response.ok){
          const data=await response.json(),profile=data.bookingProfile||{};
          if(!String(data.visitorName||'').includes('owner preview')){
            pricingState.inviteSession=true;pricingState.invitePricing=Boolean(data.complimentary||data.privatePricingConnected);pricingState.identityReady=true;
            greetingName=profile.guestName||'';form.elements.name.value=profile.guestName||'';
            for(const key of ['email','phone'])if(profile[key]){form.elements[key].value=profile[key];form.elements[key].readOnly=true;}
            if(profile.guests&&!selectedGuests)form.elements.guests.value=profile.guests;
            if(!selectedArrival&&validDate(profile.arrival)&&validDate(profile.departure)){form.elements.arrival1.value=profile.arrival;form.elements.departure1.value=profile.departure;calendarState[1].month=monthStart(new Date(`${profile.arrival}T12:00:00`));}
            document.getElementById('check-profile').hidden=true;
            setDogsVisibility(pricingState.invitePricing);updateWelcome(pricingState.invitePricing);quoteChanged(1);return;
          }
        }else if(selectedParams.get('invite')==='1'&&response.status!==401){throw new Error('We could not check your invitation. Please refresh to try again.');}
      }catch(error){if(selectedParams.get('invite')==='1'){document.getElementById('guest-welcome').textContent=error.message||'Please refresh to check your invitation.';return;}}
      guestDialog.showModal();
    }
    startGuestFlow();
    renderCalendars();
    fetch('/api/availability').then(async(response)=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'Pricing could not be loaded.');pricingState.rates=data.rates||[];pricingState.unavailable=data.unavailable||[];pricingState.requested=data.requested||[];pricingState.loaded=true;renderCalendars();renderQuote(1);checkAvailability(1);scheduleDiscountQuotes();}).catch((error)=>{pricingState.calendarError=error.message||'Live availability could not be loaded.';renderCalendars();});
    form.elements.formStartedAt.value=String(Date.now());
    form.addEventListener('submit',async(event)=>{
      event.preventDefault(); message.hidden=true;
      if(detailsStep.hidden){continueWithDates();return;}
      const reviewedQuote=currentQuote();
      if(!reviewedQuote||reviewedTotal!==totalWithDeposit(reviewedQuote)){showDates();document.getElementById('price-status').textContent='Review your price with the updated contact details, then continue again.';return;}
      if(!form.reportValidity())return;
      if(!validDate(form.elements.arrival1.value)||!validDate(form.elements.departure1.value)){message.className='message error';message.textContent='Choose an arrival and checkout date.';message.hidden=false;document.getElementById('choice-1').scrollIntoView({behavior:'smooth',block:'center'});return;}
      if(hasAvailabilityConflict()){message.className='message error';message.textContent='Those dates are unavailable. Choose different dates or use the availability calendar before continuing.';message.hidden=false;document.querySelector('.choice.unavailable')?.scrollIntoView({behavior:'smooth',block:'center'});return;}
      button.disabled=true; button.textContent=form.elements.bookingIntent.value==='questions'?'Sending questions...':'Creating checkout...'; document.querySelectorAll('.choice').forEach((choice)=>choice.classList.remove('unavailable'));
      const payload={...Object.fromEntries(new FormData(form)),reviewedTotalCents:totalWithDeposit(reviewedQuote)};
      try {
        const response=await fetch('/api/booking-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        const data=await response.json().catch(()=>({})); if(!response.ok) { const error=new Error(data.error || 'We could not create your checkout.'); error.unavailableChoices=data.unavailableChoices;error.priceChanged=data.priceChanged; throw error; }
        const quote=data.quotes?.[0],questionsOnly=payload.bookingIntent==='questions',isFriendsAndFamily=Boolean(quote?.friendsAndFamilyDiscount),reservationDepositCents=quote?.complimentary?0:isFriendsAndFamily?2500:Math.round((Number(quote?.totalCents)||0)*.20),confirmation=[
          questionsOnly?'WEEKS CREEK HAVEN — QUESTION REQUEST RECEIVED':'WEEKS CREEK HAVEN — CHECKOUT RECEIVED',
          '',
          `Confirmation: ${data.requestId||'Created'}`,
          `Guest: ${payload.name}`,
          `Stay: ${friendlyDate(payload.arrival1)} through ${friendlyDate(payload.departure1)}`,
          `Guests: ${payload.guests}`,
          quote?`Stay price before taxes: ${money(quote.totalCents)}`:'',
          '',
          questionsOnly?'STATUS: Sent to the owners for a reply':'STATUS: Payment and agreement pending',
          questionsOnly?'No invoice was created. Lance or Heather will respond to your questions. This inquiry expires and is archived after 48 hours.':'Your Square invoice and reservation details have been emailed.',
          questionsOnly?null:'',
          questionsOnly?null:'100% REFUND POLICY',
          questionsOnly?null:'Cancel by 4:00 PM Eastern on the day before check-in (at least 24 hours before arrival) for a 100% refund of all amounts paid.',
          questionsOnly?null:'',
          questionsOnly?null:`INSIDE 24 HOURS: ${money(reservationDepositCents)} will be retained as the reservation payment. This same amount is retained even if you paid the invoice in full; all remaining amounts paid will be refunded.`,
          '',
          'IMPORTANT: These dates remain available to others until both payment and the rental agreement are complete. The first guest to complete both steps locks in the dates.',
          '',
          'You may screenshot this confirmation.'
        ].filter(line=>line!==null&&line!==undefined).join('\n');
        form.reset();pricingState.discountQuotes={};reviewedTotal=null;showDates(false); form.elements.formStartedAt.value=String(Date.now()); setDogsVisibility(false); updateBookingIntent(); document.querySelectorAll('.stay-quote,.availability-status').forEach(box=>box.hidden=true);renderCalendars();message.className='message success'; message.textContent=questionsOnly?'Your questions and selected dates were sent to the owners. No invoice was created.':'Checkout received. Your screenshot-ready confirmation is shown, and your invoice and rental agreement were emailed.'; message.hidden=false; confirmationTitle.textContent=questionsOnly?'Inquiry received':'Booking checkout received'; confirmationCopy.textContent=confirmation; myBookingLink.hidden=questionsOnly||!data.bookingPacketUrl; confirmationClose.hidden=!questionsOnly&&Boolean(data.bookingPacketUrl); if(data.bookingPacketUrl)myBookingLink.href=data.bookingPacketUrl; confirmationDialog.showModal();
      } catch(error) { if(error.priceChanged){showDates();quoteChanged(1);} if(Array.isArray(error.unavailableChoices)) error.unavailableChoices.forEach((blocked,index)=>{ if(blocked) document.getElementById(`choice-${index+1}`).classList.add('unavailable'); }); message.className='message error'; message.textContent=error.message; message.hidden=false;message.scrollIntoView({behavior:'smooth',block:'center'}); }
      finally { button.disabled=!currentQuote(); updateBookingIntent(); }
    });
