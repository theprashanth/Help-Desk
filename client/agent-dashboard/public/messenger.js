/*!
 * Chai Shots Messenger loader
 *
 *   <script>
 *     window.ChaiShotsSettings = { app_id: "YOUR_APP_ID",
 *       // logged-in users (optional): user_id, name, email, phone, user_hash (HMAC-SHA256 of user_id from your server)
 *     };
 *   </script>
 *   <script async src="https://YOUR-DASHBOARD/messenger.js"></script>
 *
 * JavaScript API: ChaiShots('boot', settings) · ChaiShots('update', settings) · ChaiShots('shutdown')
 *                 ChaiShots('show') · ChaiShots('hide')
 * Calls made before this script loads are queued by the stub:
 *   window.ChaiShots=window.ChaiShots||function(){(ChaiShots.q=ChaiShots.q||[]).push(arguments)};
 */
(function () {
  'use strict';
  if (window.__chaiShotsLoaded) return;
  window.__chaiShotsLoaded = true;

  var script = document.currentScript || (function () {
    var all = document.getElementsByTagName('script');
    for (var i = all.length - 1; i >= 0; i--) if (/messenger\.js(\?|$)/.test(all[i].src)) return all[i];
    return null;
  })();
  var BASE = script ? new URL(script.src, location.href).origin : location.origin;

  var queued = (window.ChaiShots && window.ChaiShots.q) || [];
  var settings = window.ChaiShotsSettings || null;
  var iframe = null;
  var frameReady = false;
  var pending = [];        // messages waiting for the iframe
  var open = false;
  var layout = { position: 'right', showLauncher: true, hidden: false, preview: false };
  var bannerEl = null;     // proactive banner drawn across the top of the host page

  function send(type, extra) {
    var msg = { source: 'chai-shots-host', type: type };
    for (var k in extra || {}) msg[k] = extra[k];
    if (iframe && frameReady) iframe.contentWindow.postMessage(msg, BASE);
    else pending.push(msg);
  }

  function size() {
    if (!iframe) return;
    var s = iframe.style;
    s[layout.position === 'left' ? 'left' : 'right'] = '0';
    s[layout.position === 'left' ? 'right' : 'left'] = 'auto';
    if (layout.hidden || (!open && !layout.showLauncher)) { s.display = 'none'; return; }
    s.display = 'block';
    if (open) {
      s.width = Math.min(window.innerWidth, 432) + 'px';
      s.height = Math.min(window.innerHeight, 696) + 'px';
    } else if (layout.preview) {
      // A proactive message pops up above the launcher
      s.width = Math.min(window.innerWidth, 340) + 'px';
      s.height = '300px';
    } else {
      s.width = '88px';
      s.height = '88px';
    }
  }

  function mount(appId) {
    if (iframe) return;
    iframe = document.createElement('iframe');
    iframe.title = 'Chat with us';
    iframe.src = BASE + '/messenger/' + encodeURIComponent(appId);
    iframe.setAttribute('allow', 'clipboard-write; microphone'); // microphone: the mic button (speech to text)
    iframe.setAttribute('allowtransparency', 'true');
    var s = iframe.style;
    s.position = 'fixed'; s.bottom = '0'; s.right = '0'; s.border = '0'; s.zIndex = '2147483000';
    s.width = '88px'; s.height = '88px'; s.background = 'transparent'; s.colorScheme = 'normal'; s.display = 'none';
    (document.body || document.documentElement).appendChild(iframe);
  }

  window.addEventListener('message', function (e) {
    if (!iframe || e.source !== iframe.contentWindow || e.origin !== BASE) return;
    var d = e.data || {};
    if (d.source !== 'chai-shots') return;
    if (d.type === 'ready') {
      frameReady = true;
      iframe.contentWindow.postMessage({ source: 'chai-shots-host', type: 'boot', settings: settings, page: { url: location.href, title: document.title } }, BASE);
      while (pending.length) iframe.contentWindow.postMessage(pending.shift(), BASE);
    } else if (d.type === 'resize') {
      open = !!d.open;
      layout.position = d.position === 'left' ? 'left' : 'right';
      layout.showLauncher = d.showLauncher !== false;
      layout.hidden = !!d.hidden;
      layout.preview = !!d.preview;
      size();
    } else if (d.type === 'banner') {
      showBanner(d.banner || null);
    }
  });

  // ── Proactive banner (the Messenger decides what to show; it's drawn here, on the host page) ──
  function showBanner(b) {
    if (bannerEl) { bannerEl.remove(); bannerEl = null; document.documentElement.style.removeProperty('--chai-shots-banner'); }
    if (!b || !b.body) return;
    var promo = b.style === 'promo';
    var el = document.createElement('div');
    el.setAttribute('role', 'status');
    var st = el.style;
    st.position = 'fixed'; st.top = '0'; st.left = '0'; st.right = '0'; st.zIndex = '2147483001';
    st.display = 'flex'; st.alignItems = 'center'; st.gap = '12px'; st.padding = '10px 16px';
    st.font = '14px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
    st.background = promo ? (/^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#1a1a1a') : '#ffffff';
    st.color = promo ? '#ffffff' : '#1a1a1a';
    st.boxShadow = '0 1px 3px rgba(0,0,0,.12)';
    var text = document.createElement('span');
    text.style.flex = '1'; text.style.textAlign = 'center';
    text.textContent = String(b.body).replace(/\*\*(.+?)\*\*/g, '$1'); // plain text only on the host page
    el.appendChild(text);
    if (b.link && /^https?:\/\//i.test(b.link.url || '')) {
      var a = document.createElement('a');
      a.href = b.link.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = b.link.label || 'Learn more';
      a.style.color = 'inherit'; a.style.fontWeight = '600'; a.style.textDecoration = 'underline';
      a.addEventListener('click', function () { send('banner-clicked', { id: b.id }); });
      el.appendChild(a);
    }
    var x = document.createElement('button');
    x.type = 'button'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '\u2715';
    x.style.cssText = 'background:none;border:0;color:inherit;opacity:.7;cursor:pointer;font-size:14px;padding:4px';
    x.addEventListener('click', function () { showBanner(null); send('banner-dismissed', { id: b.id }); });
    el.appendChild(x);
    (document.body || document.documentElement).appendChild(el);
    bannerEl = el;
  }

  // Single-page apps: tell the Messenger when the URL changes (page-based proactive messages)
  var lastUrl = location.href;
  function pageChanged() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    send('page', { page: { url: location.href, title: document.title } });
  }
  ['pushState', 'replaceState'].forEach(function (fn) {
    var orig = history[fn];
    if (typeof orig !== 'function') return;
    history[fn] = function () { var r = orig.apply(this, arguments); setTimeout(pageChanged, 0); return r; };
  });
  window.addEventListener('popstate', pageChanged);
  window.addEventListener('hashchange', pageChanged);
  window.addEventListener('resize', size);

  function boot(s) {
    settings = s || settings || {};
    if (!settings.app_id) { console.error('[Chai Shots] app_id is required'); return; }
    if (!iframe) mount(settings.app_id);
    else send('update', { settings: settings });
  }

  function api(cmd, arg) {
    switch (cmd) {
      case 'boot': boot(arg); break;
      case 'update':
        settings = Object.assign({}, settings || {}, arg || {});
        send('update', { settings: arg || {}, page: { url: location.href, title: document.title } });
        break;
      case 'shutdown':
        // e.g. on logout: forget the visitor so the next person on this device starts fresh
        settings = settings && settings.app_id ? { app_id: settings.app_id } : null;
        send('shutdown');
        break;
      case 'show': send('show'); break;
      case 'hide': send('hide'); break;
      default: console.warn('[Chai Shots] unknown command', cmd);
    }
  }
  window.ChaiShots = api;

  function start() {
    if (settings && settings.app_id) boot(settings);
    for (var i = 0; i < queued.length; i++) api.apply(null, queued[i]);
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
