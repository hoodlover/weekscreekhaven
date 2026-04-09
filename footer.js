// ============================================================
//  footer.js  —  Weeks Creek Haven shared footer
//  Drop this file in your site root.
//  In every HTML, replace the <footer>...</footer> block with:
//
//    <div id="footer-placeholder"></div>
//    <script src="footer.js"></script>
//
//  The current page's nav link will automatically highlight white.
// ============================================================

(function () {

  // ── All footer nav links ─────────────────────────────────
  const navLinks = [
    { href: 'index.html',          label: 'Home'         },
    { href: 'things-to-do.html',   label: 'Things to Do' },
    { href: 'need-to-know.html',   label: 'Need to Know' },
    { href: 'find-us.html',        label: 'Find Us'      },
    { href: 'gallery.html',        label: 'Gallery'      },
    { href: 'important-info.html', label: 'Friends Portal' },
  ];

  // ── Figure out which page we're on ──────────────────────
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  // ── Inject hover styles once ─────────────────────────────
  if (!document.getElementById('wch-footer-styles')) {
    const style = document.createElement('style');
    style.id = 'wch-footer-styles';
    style.textContent = `
      .wch-nav-link {
        display: inline-block;
        color: #fff;
        background: rgba(164,93,65,0.44);
        border: 1px solid #A45D41;
        border-radius: 4px;
        padding: 3px 10px;
        text-shadow: 1px 1px 0 rgba(0,0,0,0.4);
        text-decoration: none;
        font-size: 0.875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        transition: all 0.2s ease;
      }
      .wch-nav-link:hover {
        color: #4a4747;
        background: rgba(245,245,244,0.6);
        border-color: #4a4747;
        text-shadow: none;
      }
      .wch-nav-link-active {
        display: inline-block;
        color: #fff;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.4);
        border-radius: 4px;
        padding: 3px 10px;
        text-shadow: 0 1px 4px rgba(0,0,0,0.9), 1px 1px 0 #000;
        text-decoration: none;
        font-size: 0.875rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        cursor: default;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  // ── Build the nav link HTML ──────────────────────────────
  const linksHTML = navLinks.map(link => {
    const isActive = link.href === currentPage;
    return `<a href="${link.href}" class="${isActive ? 'wch-nav-link-active' : 'wch-nav-link'}">${link.label}</a>`;
  }).join('\n');

  // ── Full footer HTML ─────────────────────────────────────
  const footerHTML = `
    <footer class="pt-2 pb-2 px-6 text-center bg-footer-wood">

      <!-- Nav links row -->
      <div class="max-w-6xl mx-auto flex flex-wrap justify-center gap-3 mb-4">
        ${linksHTML}
      </div>

      <!-- Logo image + address + copyright -->
      <div class="flex flex-col items-center border-t border-stone-800 pt-4 text-xs text-stone-400 uppercase tracking-widest">
        <img src="webpic/Weeks_Creek_Haven_Social_Preview.png"
             alt="Cabin Away From Home!"
             class="mb-4 mx-auto w-full max-w-md rounded-lg opacity-80 hover:opacity-100 transition-opacity">
        <p class="text-white text-xl font-serif italic extra-heavy-shadow normal-case mb-1">Weeks Creek Haven</p>
        <p class="text-stone-100 extra-heavy-shadow mb-2">421 Weeks Creek Rd | Blue Ridge, GA 30513</p>
        <p class="text-stone-300" style="text-shadow: 0 1px 3px rgba(0,0,0,0.95), 0 2px 8px rgba(0,0,0,0.85), 1px 1px 0 #000;">&copy; 2026 H &amp; L Havens, LLC | Beautiful Blue Ridge</p>
      </div>

    </footer>
  `;

  // ── Inject into placeholder ──────────────────────────────
  function injectFooter() {
    const placeholder = document.getElementById('footer-placeholder');
    if (placeholder) {
      placeholder.innerHTML = footerHTML;
    } else {
      document.body.insertAdjacentHTML('beforeend', footerHTML);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFooter);
  } else {
    injectFooter();
  }

})();S