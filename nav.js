// ============================================================
//  nav.js  —  Weeks Creek Haven shared navigation
//  Drop this file in your site root.
//  In every HTML, replace the <nav> and #mobile-menu blocks with:
//
//    <div id="nav-placeholder"></div>
//    <script src="/nav.js"></script>
//
//  Make sure the CSS below (railroad-tie-nav, wood-btn, etc.)
//  is either in a shared stylesheet OR kept in each page's <style>.
// ============================================================

(function () {
  const navHTML = `
    <!-- ===== TOP NAV BAR ===== -->
    <nav class="fixed w-full z-50 railroad-tie-nav py-2 px-6 2xl:py-6 2xl:px-12 flex justify-between items-center">
      <a href="index.html" class="flex-shrink-0 logo-link">
        <img src="buttons/week-creek-button-crop.jpg"       alt="Weeks Creek Haven" class="wood-btn normal-img">
        <img src="buttons/week-creek-button-crop-hover.jpg" alt="Weeks Creek Haven" class="wood-btn hover-img">
      </a>

      <div class="hidden md:flex space-x-1 2xl:space-x-4 nav-link-group items-center">
        <a href="things-to-do.html">
          <img src="buttons/to-do-see.jpg"       alt="To Do &amp; See" class="wood-btn normal-img">
          <img src="buttons/to-do-see-hover.jpg" alt="To Do &amp; See" class="wood-btn hover-img">
        </a>
        <a href="need-to-know.html">
          <img src="buttons/need-to-know.jpg"       alt="Need to Know" class="wood-btn normal-img">
          <img src="buttons/need-to-know-hover.jpg" alt="Need to Know" class="wood-btn hover-img">
        </a>
        <a href="find-us.html">
          <img src="buttons/find-cabin.jpg"       alt="Find Us" class="wood-btn normal-img">
          <img src="buttons/find-cabin-hover.jpg" alt="Find Us" class="wood-btn hover-img">
        </a>
        <a href="gallery.html">
          <img src="buttons/cabin-gallery.jpg"       alt="Gallery" class="wood-btn normal-img">
          <img src="buttons/cabin-gallery-hover.jpg" alt="Gallery" class="wood-btn hover-img">
        </a>
        <a href="important-info.html">
          <img src="buttons/friends-info.jpg"       alt="Friends Info" class="wood-btn normal-img">
          <img src="buttons/friends-info-hover.jpg" alt="Friends Info" class="wood-btn hover-img">
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
      <a href="index.html">        <img src="buttons/home.jpg"         alt="Home"         class="wood-btn"></a>
      <a href="things-to-do.html"> <img src="buttons/to-do-see.jpg"    alt="To Do"        class="wood-btn"></a>
      <a href="need-to-know.html"> <img src="buttons/need-to-know.jpg" alt="Need to Know" class="wood-btn"></a>
      <a href="find-us.html">      <img src="buttons/find-cabin.jpg"   alt="Find Us"      class="wood-btn"></a>
      <a href="checkout.html">     <img src="buttons/check.jpg"        alt="Checkout"     class="wood-btn"></a>
      <a href="gallery.html">      <img src="buttons/submit_hover.jpg" alt="Gallery"     class="wood-btn"></a>
      <a href="important-info.html"><img src="buttons/friends-info.jpg" alt="Friends Info" class="wood-btn"></a>
    </div>
  `;

  // ── Inject into placeholder ──────────────────────────────
  function injectNav() {
    const placeholder = document.getElementById('nav-placeholder');
    if (placeholder) {
      placeholder.innerHTML = navHTML;
    } else {
      // Fallback: prepend to body if no placeholder exists
      document.body.insertAdjacentHTML('afterbegin', navHTML);
    }
    initToggle();
  }

  // ── Wire up open / close logic ───────────────────────────
  function initToggle() {
    const menuBtn       = document.getElementById('mobile-menu-button');
    const closeBtn      = document.getElementById('close-mobile-menu');
    const mobileMenu    = document.getElementById('mobile-menu');

    if (!menuBtn || !mobileMenu) return;

    // Open
    menuBtn.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
      document.body.classList.toggle('overflow-hidden');
    });

    // Close via X button
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        mobileMenu.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
      });
    }

    // Close when a link is tapped
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
      });
    });
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectNav);
  } else {
    injectNav();
  }
})();