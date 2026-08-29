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
    { href: 'important-info.html', label: 'Guest Guide' },
    { href: 'privacy.html',      label: 'Privacy'      },
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
        background-color: rgba(0,0,0,.18);
        border: 1px solid rgba(255,255,255,.34);
        border-radius: 999px;
        padding: 8px 13px;
        text-shadow: 0 1px 2px rgba(0,0,0,.55);
        text-decoration: none;
        font-size: 0.68rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }
      .wch-nav-link:hover {
        color: #fff;
        border-color: #A45D41;
      }
      .wch-nav-link-active {
        display: inline-block;
        color: #fff;
        background: #173f2b;
        border: 1px solid #72917c;
        border-radius: 999px;
        padding: 8px 13px;
        text-shadow: 0 1px 3px rgba(0,0,0,.6);
        text-decoration: none;
        font-size: 0.68rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        cursor: default;
        pointer-events: none;
      }
      .wch-footer-root {
        padding: 34px 24px 24px;
        color: white;
        text-align: center;
        background: linear-gradient(rgba(12,18,14,.88),rgba(12,18,14,.96)), url('webpic/barn.webp') center/cover;
        border-top: 5px solid #A45D41;
      }
      .wch-footer-logo {
        width: 88px;
        height: 88px;
        margin: 0 auto 10px;
        object-fit: contain;
        filter: drop-shadow(0 8px 18px rgba(0,0,0,.5));
      }
      .wch-footer-title { margin: 0 0 5px; color: white; font: 700 clamp(2rem,4vw,2.45rem)/1 'Crimson Text', Georgia, serif; }
      .wch-footer-address { margin: 0 0 8px; color: #eee6da; font-size: .68rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .wch-footer-copy { margin: 0; color: #cfc6b9; font-size: .6rem; letter-spacing: .09em; text-transform: uppercase; }
      .wch-footer-version { margin: 8px 0 0; color: rgba(255,255,255,.38); font-size: .52rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; }
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
    <footer class="wch-footer-root">

      <!-- Nav links row -->
      <div class="max-w-6xl mx-auto flex flex-wrap justify-center gap-2 mb-5">
        ${linksHTML}
      </div>

      <!-- Logo image + address + copyright -->
      <div>
        <a href="/index.html" aria-label="Weeks Creek Haven home"><img src="webpic/weeks-creek-haven-round-logo.png" alt="Weeks Creek Haven" class="wch-footer-logo"></a>
        <p class="wch-footer-title">Weeks Creek Haven</p>
        <p class="wch-footer-address">421 Weeks Creek Rd · Blue Ridge, GA 30513</p>
        <p class="wch-footer-copy">&copy; 2026 H &amp; L Havens, LLC · Beautiful Blue Ridge</p>
        <p class="wch-footer-version" aria-label="Website version">Version 31.226.1202</p>
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

})();
