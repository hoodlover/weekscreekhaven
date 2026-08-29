// ============================================================
//  nav.js  —  Weeks Creek Haven shared navigation
//  Drop this file in your site root.
//  In every HTML, replace the <nav> and #mobile-menu blocks with:
//
//    <div id="nav-placeholder"></div>
//    <script src="/nav.js"></script>
//
//  CSS is injected automatically — no changes needed in each page.
// ============================================================

(function () {

  // Shared public-page polish. The wooden railroad header remains unchanged.
  if (!document.querySelector('link[href$="site-interactions.css"]')) {
    const polish = document.createElement('link');
    polish.rel = 'stylesheet';
    polish.href = '/site-interactions.css';
    document.head.appendChild(polish);
  }

  // -- Inject all nav CSS automatically --------------------
  const style = document.createElement('style');
  style.textContent = `
    /* -- Nav bar: locked height on ALL screen sizes -- */
    .railroad-tie-nav {
      max-height: 80px !important;
      background-image: linear-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.2)), url('webpic/rrtie.webp');
      background-size: auto 125%;
      background-repeat: repeat-x;
      background-position: left center;
      border-bottom: 4px solid #1a1512;
      box-shadow: 0 4px 20px rgba(0,0,0,0.8);
    }

    /* -- Nav buttons: one consistent size everywhere -- */
    .railroad-tie-nav .wood-btn {
      height: 58px !important;
      width: auto !important;
      display: block;
      transition: transform 0.2s ease;
    }
    .railroad-tie-nav .wood-btn:hover {
      transform: scale(1.05);
    }
    .railroad-tie-nav .logo-link:hover .wood-btn {
      transform: scale(1.0) !important;
    }

    .railroad-tie-nav .admin-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      margin-left: 8px;
      padding: 7px 13px;
      border: 1px solid rgba(255,255,255,.38);
      border-radius: 999px;
      background: rgba(10,35,24,.5);
      color: white;
      font: 800 .64rem/1 Montserrat, sans-serif;
      letter-spacing: .08em;
      text-decoration: none;
      text-transform: uppercase;
      transition: background .2s ease, border-color .2s ease, transform .2s ease;
    }
    .railroad-tie-nav .admin-pill:hover,
    .railroad-tie-nav .admin-pill:focus-visible {
      background: #2f6846;
      border-color: #a8c8b2;
      transform: translateY(-1px);
      outline: none;
    }

    /* -- Logo hover swap -- */
    .logo-link { position: relative; display: inline-block; }
    .logo-link .hover-img { position: absolute; top: 0; left: 0; opacity: 0; transition: opacity 0.3s ease-in-out; z-index: 2; }
    .logo-link:hover .hover-img { opacity: 1; }

    /* -- Desktop nav button hover swap -- */
    .nav-link-group a .hover-img { display: none; }
    .nav-link-group a:hover .normal-img { display: none; }
    .nav-link-group a:hover .hover-img { display: block; }

    /* -- Mobile full-screen menu -- */
    #mobile-menu {
      background-image: linear-gradient(rgba(0,0,0,0.9), rgba(0,0,0,0.9)), url('webpic/railroad-tie-texture.webp');
      background-size: cover;
    }
    /* Bigger buttons inside the mobile overlay menu */
    #mobile-menu .wood-btn {
      height: 72px !important;
      width: auto !important;
    }
    @media (max-width: 767px) {
      .railroad-tie-nav { padding-left: 10px !important; padding-right: 10px !important; }
      .railroad-tie-nav .logo-link .wood-btn { max-width:180px; object-fit:contain; }
      .railroad-tie-nav .admin-pill { margin-left: auto; margin-right: 7px; padding: 7px 10px; font-size: .58rem; }
    }
  `;
  document.head.appendChild(style);

  const pagePath = location.pathname.toLowerCase();
  const showAdminPill = pagePath === '/' || pagePath.endsWith('/index.html') || pagePath.endsWith('/friends-hub.html');
  const adminPill = showAdminPill ? '<a href="admin.html" class="admin-pill" aria-label="H and L owner administration">H &amp; L</a>' : '';

  const navHTML = `
    <!-- ===== TOP NAV BAR ===== -->
    <nav class="fixed w-full z-50 railroad-tie-nav py-2 px-6 flex justify-between items-center">
      <a href="index.html" class="flex-shrink-0 logo-link">
        <img src="buttons/week-creek-button-crop.webp"       alt="Weeks Creek Haven" class="wood-btn normal-img">
        <img src="buttons/week-creek-button-crop-hover.webp" alt="Weeks Creek Haven" class="wood-btn hover-img">
      </a>

      <div class="hidden md:flex space-x-1 nav-link-group items-center">
        <a href="things-to-do.html">
          <img src="buttons/to-do-see.webp"       alt="To Do &amp; See" class="wood-btn normal-img">
          <img src="buttons/to-do-see-hover.webp" alt="To Do &amp; See" class="wood-btn hover-img">
        </a>
        <a href="need-to-know.html">
          <img src="buttons/need-to-know.webp"       alt="Need to Know" class="wood-btn normal-img">
          <img src="buttons/need-to-know-hover.webp" alt="Need to Know" class="wood-btn hover-img">
        </a>
        <a href="find-us.html">
          <img src="buttons/find-cabin.webp"       alt="Find Us" class="wood-btn normal-img">
          <img src="buttons/find-cabin-hover.webp" alt="Find Us" class="wood-btn hover-img">
        </a>
        <a href="gallery.html">
          <img src="buttons/cabin-gallery.webp"       alt="Gallery" class="wood-btn normal-img">
          <img src="buttons/cabin-gallery-hover.webp" alt="Gallery" class="wood-btn hover-img">
        </a>
        <a href="important-info.html?v=12">
          <img src="buttons/friends-info.webp"       alt="Guest Guide" class="wood-btn normal-img">
          <img src="buttons/friends-info-hover.webp" alt="Guest Guide" class="wood-btn hover-img">
        </a>
      </div>

      ${adminPill}

      <button id="mobile-menu-button" class="md:hidden text-white focus:outline-none p-2 bg-black/20 rounded-lg border border-white/20">
        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path id="menu-icon-path" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
        </svg>
      </button>
    </nav>

    <!-- ===== MOBILE FULL-SCREEN MENU ===== -->
    <div id="mobile-menu" class="hidden fixed inset-0 z-[60] flex flex-col items-center justify-center space-y-1 nav-link-group">
      <button id="close-mobile-menu" class="absolute top-6 right-8 text-white text-5xl font-light">&times;</button>
      <a href="index.html">        <img src="buttons/home.webp"         alt="Home"         class="wood-btn"></a>
      <a href="things-to-do.html"> <img src="buttons/to-do-see.webp"    alt="To Do"        class="wood-btn"></a>
      <a href="need-to-know.html"> <img src="buttons/need-to-know.webp" alt="Need to Know" class="wood-btn"></a>
      <a href="find-us.html">      <img src="buttons/find-cabin.webp"   alt="Find Us"      class="wood-btn"></a>
      <a href="checkout.html">     <img src="buttons/check.webp"        alt="Checkout"     class="wood-btn"></a>
      <a href="gallery.html">      <img src="buttons/cabin-gallery.webp" alt="Gallery"     class="wood-btn"></a>
      <a href="important-info.html?v=12"><img src="buttons/friends-info.webp" alt="Guest Guide" class="wood-btn"></a>
    </div>
  `;

  function injectNav() {
    const placeholder = document.getElementById('nav-placeholder');
    if (placeholder) {
      placeholder.innerHTML = navHTML;
    } else {
      document.body.insertAdjacentHTML('afterbegin', navHTML);
    }
    initToggle();
  }

  function initToggle() {
    const menuBtn    = document.getElementById('mobile-menu-button');
    const closeBtn   = document.getElementById('close-mobile-menu');
    const mobileMenu = document.getElementById('mobile-menu');

    if (!menuBtn || !mobileMenu) return;

    menuBtn.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
      document.body.classList.toggle('overflow-hidden');
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        mobileMenu.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
      });
    }

    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectNav);
  } else {
    injectNav();
  }
})();
