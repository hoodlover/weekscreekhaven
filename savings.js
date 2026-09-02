(function savingsPopout(){
  const triggers=[...document.querySelectorAll('[data-savings-open]')];
  if(!triggers.length)return;
  const dialog=document.createElement('dialog');
  dialog.className='savings-dialog';
  dialog.setAttribute('aria-labelledby','savings-title');
  dialog.innerHTML=`<div class="savings-dialog-inner">
    <button class="savings-close" type="button" aria-label="Close ways to save">&times;</button>
    <p class="savings-kicker">Book direct &amp; keep more for the getaway</p>
    <h2 id="savings-title">Ways to save at the Haven</h2>
    <p class="savings-lead">Choose your dates and we&rsquo;ll show the strongest eligible offer automatically. Here are the ways a Weeks Creek Haven stay can cost a little less.</p>
    <div class="savings-grid">
      <div class="savings-option"><strong>Book ahead &middot; save 5&ndash;15%</strong><span>Early Bird savings begin 30 days out and grow at 60 and 90 days.</span></div>
      <div class="savings-option"><strong>Pick quieter dates &middot; save up to 20%</strong><span>Midweek and eligible January&ndash;March stays can receive 20% off.</span></div>
      <div class="savings-option"><strong>Stay a little longer &middot; save 10&ndash;20%</strong><span>Four-night stays can save 10%; seven nights or more can save 20%.</span></div>
      <div class="savings-option"><strong>Catch an opening &middot; save 15%</strong><span>An available stay beginning within seven days may receive our last-minute rate.</span></div>
      <div class="savings-option"><strong>Book here or pay in full &middot; save 10%</strong><span>Direct booking is already rewarded, and paying in full is another eligible offer.</span></div>
      <div class="savings-option"><strong>Return or refer &middot; save 10&ndash;15%</strong><span>Returning guests, guest referrals, and rebooking before checkout all have special savings.</span></div>
    </div>
    <p class="savings-note">One promotional discount applies per stay. If several automatic offers fit, the live price uses the one that saves you the most.</p>
    <div class="savings-actions"><a href="/register.html">Check dates &amp; see my price</a><a class="secondary" href="/availability.html">View availability</a></div>
  </div>`;
  document.body.appendChild(dialog);
  const close=()=>dialog.close();
  triggers.forEach(trigger=>trigger.addEventListener('click',event=>{event.preventDefault();dialog.showModal();}));
  dialog.querySelector('.savings-close').addEventListener('click',close);
  dialog.addEventListener('click',event=>{if(event.target===dialog)close();});
})();
