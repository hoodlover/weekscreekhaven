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

  // -- Inject all nav CSS automatically --------------------
  const style = document.createElement('style');
  style.textContent = `
    /* -- Nav bar: locked height on ALL screen sizes -- */
    .railroad-tie-nav {
      max-height: 80px !important;
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
  `;
  document.head.appendChild(style);

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
        <a href="important-info.html">
          <img src="buttons/friends-info.webp"       alt="Friends Info" class="wood-btn normal-img">
          <img src="buttons/friends-info-hover.webp" alt="Friends Info" class="wood-btn hover-img">
        </a>
      </div>

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
      <a href="important-info.html"><img src="buttons/friends-info.webp" alt="Friends Info" class="wood-btn"></a>
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