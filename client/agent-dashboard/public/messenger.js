/*!
 * Chai Samosa Messenger loader
 *
 *   <script>
 *     window.ChaiSamosaSettings = { app_id: "YOUR_APP_ID",
 *       // logged-in users (optional): user_id, name, email, phone, user_hash (HMAC-SHA256 of user_id from your server)
 *     };
 *   </script>
 *   <script async src="https://YOUR-DASHBOARD/messenger.js"></script>
 *
 * JavaScript API: ChaiSamosa('boot', settings) · ChaiSamosa('update', settings) · ChaiSamosa('shutdown')
 *                 ChaiSamosa('show') · ChaiSamosa('hide')
 * Calls made before this script loads are queued by the stub:
 *   window.ChaiSamosa=window.ChaiSamosa||function(){(ChaiSamosa.q=ChaiSamosa.q||[]).push(arguments)};
 */
(function () {
  'use strict';
  if (window.__chaiSamosaLoaded) return;
  window.__chaiSamosaLoaded = true;

  var script = document.currentScript || (function () {
    var all = document.getElementsByTagName('script');
    for (var i = all.length - 1; i >= 0; i--) if (/messenger\.js(\?|$)/.test(all[i].src)) return all[i];
    return null;
  })();
  var BASE = script ? new URL(script.src, location.href).origin : location.origin;

  var queued = (window.ChaiSamosa && window.ChaiSamosa.q) || [];
  var settings = window.ChaiSamosaSettings || null;
  var iframe = null;
  var frameReady = false;
  var pending = [];        // messages waiting for the iframe
  var open = false;
  var layout = { position: 'right', showLauncher: true, hidden: false };

  function send(type, extra) {
    var msg = { source: 'chai-samosa-host', type: type };
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
    iframe.setAttribute('allow', 'clipboard-write');
    iframe.setAttribute('allowtransparency', 'true');
    var s = iframe.style;
    s.position = 'fixed'; s.bottom = '0'; s.right = '0'; s.border = '0'; s.zIndex = '2147483000';
    s.width = '88px'; s.height = '88px'; s.background = 'transparent'; s.colorScheme = 'normal'; s.display = 'none';
    (document.body || document.documentElement).appendChild(iframe);
  }

  window.addEventListener('message', function (e) {
    if (!iframe || e.source !== iframe.contentWindow || e.origin !== BASE) return;
    var d = e.data || {};
    if (d.source !== 'chai-samosa') return;
    if (d.type === 'ready') {
      frameReady = true;
      iframe.contentWindow.postMessage({ source: 'chai-samosa-host', type: 'boot', settings: settings, page: { url: location.href, title: document.title } }, BASE);
      while (pending.length) iframe.contentWindow.postMessage(pending.shift(), BASE);
    } else if (d.type === 'resize') {
      open = !!d.open;
      layout.position = d.position === 'left' ? 'left' : 'right';
      layout.showLauncher = d.showLauncher !== false;
      layout.hidden = !!d.hidden;
      size();
    }
  });
  window.addEventListener('resize', size);

  function boot(s) {
    settings = s || settings || {};
    if (!settings.app_id) { console.error('[Chai Samosa] app_id is required'); return; }
    if (!iframe) mount(settings.app_id);
    else send('update', { settings: settings });
  }

  function api(cmd, arg) {
    switch (cmd) {
      case 'boot': boot(arg); break;
      case 'update':
        settings = Object.assign({}, settings || {}, arg || {});
        send('update', { settings: arg || {} });
        break;
      case 'shutdown':
        // e.g. on logout: forget the visitor so the next person on this device starts fresh
        settings = settings && settings.app_id ? { app_id: settings.app_id } : null;
        send('shutdown');
        break;
      case 'show': send('show'); break;
      case 'hide': send('hide'); break;
      default: console.warn('[Chai Samosa] unknown command', cmd);
    }
  }
  window.ChaiSamosa = api;

  function start() {
    if (settings && settings.app_id) boot(settings);
    for (var i = 0; i < queued.length; i++) api.apply(null, queued[i]);
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
