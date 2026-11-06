/*!
 * leadloop-capture.js — ad-click attribution capture for client websites.
 *
 * Add ONE tag to every page (in the shared header/footer), before </body>:
 *
 *   <script src="/leadloop-capture.js" defer></script>
 *
 * What it does:
 *   1. On landing, reads the ad click IDs + UTMs from the URL (gclid, gbraid,
 *      wbraid, fbclid, msclkid, ttclid, utm_*) and saves them in a first-party
 *      cookie for 90 days. Visitors rarely fill the form on the page they land
 *      on — they browse, or come back days later — and by then the IDs are
 *      gone from the URL. A newer ad click replaces an older one (last click).
 *   2. Keeps Meta's `_fbc` / `_fbp` cookies present even without the Meta
 *      Pixel, in Meta's documented format (the Pixel adopts them once added).
 *   3. Adds hidden inputs carrying all of it to the lead form(s), refreshed at
 *      submit time. Any submit path that serialises the <form> element
 *      (classic POST, `new FormData(form)`, jQuery `.serialize()`) includes them.
 *   4. If the form has a checkbox named `ad_consent`, also sends its label text
 *      as `consent_text`, so the exact wording the visitor agreed to is stored.
 *
 * Which forms: any form whose action ends in `contact.php`, plus any form with
 * a `data-leadloop` attribute. Override with `data-forms="<css selector>"` on
 * the script tag (e.g. `form:has(input[name="website"])` for a JS-submitted
 * form that has no action).
 *
 * Built sites (React/Vite…) where the form can't be edited by hand: set
 * `data-consent="<wording>"` on the script tag and an UNCHECKED `ad_consent`
 * checkbox with that wording is added above each matched form's submit button,
 * including forms that render later (modals). Optional `data-accent="#hex"`
 * colours the checkbox.
 *
 * Static/React sites on hosts with a PHP bot-check (Bluehost's `humans_`
 * cookie): set `data-endpoint="/contact.php"` so the check is passed on page
 * load instead of failing the visitor's submit.
 *
 * For custom JS submitters that build their own payload:
 *   Object.assign(payload, window.LeadLoopCapture.fields());
 *
 * No dependencies, no network calls, nothing sent anywhere by this script.
 */
(function () {
  'use strict';

  var COOKIE = 'll_attr';
  var DAYS = 90;
  var CLICK_PARAMS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid'];
  var UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id'];
  var HIDDEN_FIELDS = CLICK_PARAMS.concat(UTM_PARAMS, ['fbc', 'fbp', 'landing_page', 'referrer', 'click_ts', 'page_url']);

  var DEFAULT_SELECTOR = 'form[action$="contact.php"], form[data-leadloop]';
  var script = document.currentScript;
  var formSelector = (script && script.getAttribute('data-forms')) || DEFAULT_SELECTOR;
  var consentWording = (script && script.getAttribute('data-consent')) || '';
  var consentAccent = (script && script.getAttribute('data-accent')) || '';
  var formEndpoint = (script && script.getAttribute('data-endpoint')) || '';

  // A selector the browser can't parse (e.g. `:has()` on an old browser) must
  // not take the whole script down — fall back to the default selector.
  try {
    document.querySelector(formSelector);
  } catch (e) {
    formSelector = DEFAULT_SELECTOR;
  }

  function readCookie(name) {
    var parts = document.cookie ? document.cookie.split('; ') : [];
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (parts[i].slice(0, eq) === name) {
        try {
          return decodeURIComponent(parts[i].slice(eq + 1));
        } catch (e) {
          return null;
        }
      }
    }
    return null;
  }

  function writeCookie(name, value, days) {
    var expires = new Date(Date.now() + days * 864e5).toUTCString();
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie =
      name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; SameSite=Lax' + secure;
  }

  function loadStored() {
    var raw = readCookie(COOKIE);
    if (!raw) return {};
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function externalReferrer() {
    var ref = document.referrer || '';
    if (!ref) return '';
    try {
      return new URL(ref).hostname === location.hostname ? '' : ref;
    } catch (e) {
      return '';
    }
  }

  // --- 1. Capture on landing ------------------------------------------------
  var params = new URLSearchParams(location.search);
  var fromUrl = {};
  var hasClick = false;
  var hasUtm = false;
  CLICK_PARAMS.forEach(function (k) {
    var v = params.get(k);
    if (v) {
      fromUrl[k] = v.slice(0, 512);
      hasClick = true;
    }
  });
  UTM_PARAMS.forEach(function (k) {
    var v = params.get(k);
    if (v) {
      fromUrl[k] = v.slice(0, 256);
      hasUtm = true;
    }
  });

  var stored = loadStored();
  if (hasClick || hasUtm) {
    // A new ad click / campaign visit replaces the previous touch entirely, so
    // a stale gclid never pairs with a newer campaign's UTMs.
    stored = fromUrl;
    stored.landing_page = location.href.slice(0, 2000);
    stored.referrer = externalReferrer().slice(0, 2000);
    stored.click_ts = String(Date.now());
    writeCookie(COOKIE, JSON.stringify(stored), DAYS);
  }

  // --- 2. Meta cookies (what the Pixel would set) ---------------------------
  var now = Date.now();
  if (fromUrl.fbclid) {
    var existingFbc = readCookie('_fbc');
    // Only replace when the click is new; keeps the original click time.
    if (!existingFbc || existingFbc.split('.').slice(3).join('.') !== fromUrl.fbclid) {
      writeCookie('_fbc', 'fb.1.' + now + '.' + fromUrl.fbclid, DAYS);
    }
  }
  if (!readCookie('_fbp')) {
    writeCookie('_fbp', 'fb.1.' + now + '.' + Math.floor(Math.random() * 1e10), DAYS);
  }

  // --- 3. Fill the forms ----------------------------------------------------
  function fields() {
    var data = loadStored();
    var out = {};
    HIDDEN_FIELDS.forEach(function (k) {
      out[k] = data[k] || '';
    });
    out.fbc = readCookie('_fbc') || '';
    out.fbp = readCookie('_fbp') || '';
    out.page_url = location.href.slice(0, 2000);
    return out;
  }

  function consentText(form) {
    var box = form.querySelector('input[type="checkbox"][name="ad_consent"]');
    if (!box) return null;
    var label = box.closest('label') || (box.id && form.querySelector('label[for="' + box.id + '"]'));
    return label ? label.textContent.replace(/\s+/g, ' ').trim().slice(0, 2000) : '';
  }

  function setHidden(form, name, value) {
    var input = form.querySelector('input[type="hidden"][name="' + name + '"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      form.appendChild(input);
    }
    input.value = value;
  }

  function fill(form) {
    var f = fields();
    Object.keys(f).forEach(function (k) {
      setHidden(form, k, f[k]);
    });
    var text = consentText(form);
    if (text !== null) setHidden(form, 'consent_text', text);
  }

  // --- 4. Host bot-check pre-flight (opt-in: data-endpoint="/contact.php") ---
  // Some shared hosts (e.g. Bluehost) answer the FIRST request to a PHP file
  // with a 409 page that sets a `humans_<n>=1` cookie and reloads. Real page
  // visits pass it invisibly, but a static/React site never loads a PHP page,
  // so its background form POST gets the challenge instead of a reply and the
  // form shows an error. Fetching the endpoint once on load and applying the
  // cookie the host asks for — exactly what the browser would do on a normal
  // visit — means the visitor's submit goes straight through.
  function passHostCheck() {
    if (!formEndpoint || !window.fetch) return;
    if (/(?:^|;\s*)humans_\d+=/.test(document.cookie)) return;
    fetch(formEndpoint, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) {
        if (res.status !== 409) return null;
        return res.text().then(function (body) {
          var m = /document\.cookie\s*=\s*["'](humans_\d+=[^"';]+)["']/.exec(body);
          if (m) {
            document.cookie =
              m[1] + '; path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
          }
        });
      })
      .catch(function () {});
  }
  passHostCheck();

  // --- 5. Consent checkbox for forms we can't edit --------------------------
  function addConsentBox(form) {
    if (!consentWording || form.querySelector('input[name="ad_consent"]')) return;
    var label = document.createElement('label');
    label.setAttribute('data-leadloop-consent', '');
    label.style.cssText =
      'display:flex;gap:10px;align-items:flex-start;font-size:12px;line-height:1.5;' +
      'color:var(--color-muted,#6b6b6b);cursor:pointer;text-align:left;';
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.name = 'ad_consent';
    box.value = 'yes'; // unchecked by default — consent must be opt-in
    box.style.cssText = 'margin-top:2px;flex-shrink:0;width:14px;height:14px;' +
      (consentAccent ? 'accent-color:' + consentAccent + ';' : '');
    var text = document.createElement('span');
    text.textContent = consentWording;
    label.appendChild(box);
    label.appendChild(text);
    // Above the submit button when it's a direct child, else at the form's end.
    var submit = form.querySelector('button[type="submit"], input[type="submit"]');
    if (submit && submit.parentNode === form) form.insertBefore(label, submit);
    else form.appendChild(label);
  }

  function fillAll() {
    var forms = document.querySelectorAll(formSelector);
    for (var i = 0; i < forms.length; i++) {
      addConsentBox(forms[i]);
      fill(forms[i]);
    }
  }

  // Forms rendered after load (modals, client-side routes) get the same setup.
  if (consentWording && window.MutationObserver) {
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () {
        pending = false;
        fillAll();
      }, 50);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // Capture phase: runs before the site's own submit handler reads the form.
  document.addEventListener(
    'submit',
    function (e) {
      if (e.target && e.target.matches && e.target.matches(formSelector)) fill(e.target);
    },
    true
  );

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fillAll);
  } else {
    fillAll();
  }

  window.LeadLoopCapture = { fields: fields, fill: fill };
})();
