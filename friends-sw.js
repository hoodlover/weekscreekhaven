const CACHE_NAME = 'friends-hub-v31';

const PRECACHE_URLS = [
  '/friends-hub.html',
  '/index.html',
  '/privacy.html',
  '/site-manifest.json?v=1',
  '/manifest.json?v=21',
  '/hub-adventures.html',
  '/nav.js',
  '/footer.js',
  '/site-interactions.css',
  // backgrounds & textures
  '/webpic/lightbardwood.webp',
  '/webpic/railroad-tie-texture.webp',
  '/webpic/rrtie.webp',
  '/webpic/barn.webp',
  // icons & UI
  '/webpic/Weeks_Creek_Haven_Favicon.webp',
  '/webpic/wch-favicon-v2.ico',
  '/webpic/wch-favicon-48-v2.png',
  '/webpic/wch-favicon-32-v2.png',
  '/webpic/wch-favicon-16-v2.png',
  '/gallery/weeks-creek-haven-blue-ridge-cabin.webp',
  '/webpic/checkmark.webp',
  // check-in assets
  '/webpic/wifi.webp',
  '/webpic/hottub.webp',
  '/webpic/bigtv.webp',
  '/webpic/fire.webp',
  '/webpic/firepit.webp',
  '/webpic/porchswing.webp',
  '/webpic/heathers.webp',
  '/webpic/alexa.webp',
  '/webpic/alexa2.webp',
  // scoop / safety
  '/webpic/trash.webp',
  '/info/HotTub.webp',
  '/info/05_Safety.webp',
  // emergency icons
  '/webpic/hospicon.png',
  '/webpic/policon.png',
  '/webpic/wpaicon.png',
  // PWA icons
  '/webpic/pwa-wch-192-v4.png',
  '/webpic/wch-main-pwa-192-v1.png',
  '/webpic/wch-main-pwa-512-v1.png',
  '/webpic/wch-main-apple-180-v1.png',
  '/webpic/pwa-wch-512-v4.png',
  '/webpic/weeks-creek-haven-round-logo.png',
  // checkout
  '/webpic/bidet.webp',
  '/webpic/$200.webp',
  '/webpic/wct.webp',
  '/webpic/rockers.webp',
  // nav buttons
  '/buttons/week-creek-button-crop.webp',
  '/buttons/week-creek-button-crop-hover.webp',
  '/buttons/home.webp',
  '/buttons/home-hover.webp',
  '/buttons/to-do-see.webp',
  '/buttons/to-do-see-hover.webp',
  '/buttons/need-to-know.webp',
  '/buttons/need-to-know-hover.webp',
  '/buttons/find-cabin.webp',
  '/buttons/find-cabin-hover.webp',
  '/buttons/check.webp',
  '/buttons/check-hover.webp',
  '/buttons/cabin-gallery.webp',
  '/buttons/cabin-gallery-hover.webp',
  '/buttons/friends-info.webp',
  '/buttons/friends-info-hover.webp',
  // adventures page assets
  '/webpic/hiking.webp',
  '/webpic/fishing.webp',
  '/webpic/foodshop.webp',
  '/webpic/familyfun.webp',
  '/info/hikes/01_Hiking_Trails.webp',
  '/info/hikes/flatcreektrail.webp',
  '/info/hikes/02_Swinging_Bridge.webp',
  '/info/hikes/03_Noontootla.webp',
  '/info/hikes/04_Fall_Branch_Falls.webp',
  '/info/hikes/06_Long_Branch_trails.webp',
  '/info/hikes/springermtntrailhead.webp',
  '/info/hikes/07_ledfordgap.webp',
  '/info/hikes/08_skeenahfalls.webp',
  '/info/fishing/Fishing_Guides.webp',
  '/info/fishing/01_blueridgefishing.webp',
  '/info/fishing/02_localfishing.webp',
  '/info/fishing/03_Toccoa_River_Trail_Canoe.webp',
  '/info/fishing/04_nantootla_creek_farms.webp',
  '/info/fishing/05_fish_hatchery.webp',
  '/info/activities/02_Fun_Thing_in_Blue_Ridge.webp',
  '/info/activities/03_Recreation_Areas.webp',
  '/info/activities/04_br_rail.webp',
  '/info/activities/zipline.webp',
  '/info/activities/04_lillypad_village.webp',
  '/info/activities/ropes.webp',
  '/info/activities/Tubing.webp',
  '/info/activities/06_Mercier_Orchards.webp',
  '/info/activities/05_BJ_Reece_Orchards.webp',
  '/info/activities/09_Toccoa_River_Trail_Canoe.webp',
  '/info/foodshopping/02_Dining1.webp',
  '/info/foodshopping/03_Dining2.webp',
  '/info/foodshopping/04_Dining3.webp',
  '/info/foodshopping/cafes_curioshops.webp',
  '/info/foodshopping/01_Good_Eats.webp',
  '/info/foodshopping/07_wineries.webp',
  '/info/foodshopping/05_top10stores.webp',
  '/info/foodshopping/06_otherstores.webp',
];

// Install: pre-cache everything
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache what we can, ignore individual failures so the SW still installs
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err => console.warn('Cache miss (install):', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: delete old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: prefer current deployed files, with the cache retained for offline use.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET and cross-origin API calls (weather, formspree)
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.hostname === 'formspree.io') return;

  // The worker has root scope, so every site page can pass through it. Always
  // check the network for navigations to avoid stale admin and booking screens.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          if (res && res.status === 200 && !res.redirected) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(url.pathname, clone));
          }
          return res;
        })
        .catch(() => caches.match(url.pathname))
    );
    return;
  }

  // Pages with authentication or frequently updated controls must check the network first.
  // Previously authorized devices can still use the last cached Hub when fully offline.
  const networkFirstPages = new Set([
    '/friends-hub', '/friends-hub.html',
    '/welcome-friends', '/welcome-friends.html',
    '/important-info', '/important-info.html',
    '/admin', '/admin.html',
  ]);
  if (networkFirstPages.has(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          if (res && res.status === 200 && !res.redirected) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(url.pathname, clone));
          }
          return res;
        })
        .catch(() => caches.match(url.pathname))
    );
    return;
  }

  // For CDN resources (tailwind, google fonts, weather icons) — network first, fall back to cache
  if (url.hostname !== self.location.hostname) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Refresh local files whenever online; cached copies keep the guest app usable offline.
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
