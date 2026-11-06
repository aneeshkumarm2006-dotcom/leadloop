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
 * ─── No-code snippet mode ────────────────────────────────────────────────
 * Served by LeadLoop and added with ONE tag — no server code on the site:
 *
 *   <script src="https://<leadloop>/capture.js" data-site="site_xxxx" defer></script>
 *
 * With `data-site`, the script also:
 *   - loads its settings (form selector, consent wording) from LeadLoop — the
 *     request is refused unless the page is on the site key's allowed domain;
 *   - finds the lead form itself (a form with an email field and no password
 *     field) unless a selector is configured;
 *   - adds a hidden honeypot field, and on submit sends a COPY of the form to
 *     LeadLoop (sendBeacon, so it survives the page navigating away). The
 *     site's own submit carries on untouched. Password, card, bank-account and
 *     other sensitive-looking fields are never collected.
 *
 * Without `data-site` nothing is sent anywhere by this script.
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
  var siteKey = (script && script.getAttribute('data-site')) || '';
  var explicitSelector = !!(script && script.getAttribute('data-forms'));
  var apiBase = '';
  if (siteKey && script && script.src) {
    try {
      apiBase = new URL(script.src).origin;
    } catch (e) {
      apiBase = '';
    }
  }
  var startedAt = Date.now();

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

  // --- 6. Which forms ---------------------------------------------------------
  // Snippet mode without a configured selector: any form that collects an
  // email address and is not a login/search form.
  function isAutoLeadForm(form) {
    if (form.querySelector('input[type="password"]')) return false;
    if ((form.getAttribute('role') || '').toLowerCase() === 'search') return false;
    return !!form.querySelector('input[type="email"], input[name*="email" i], input[autocomplete="email"]');
  }

  function isTarget(form) {
    if (!form || form.nodeName !== 'FORM') return false;
    if (siteKey && !explicitSelector) return isAutoLeadForm(form);
    try {
      return form.matches(formSelector);
    } catch (e) {
      return false;
    }
  }

  function targetForms() {
    var all = document.querySelectorAll('form');
    var out = [];
    for (var i = 0; i < all.length; i++) if (isTarget(all[i])) out.push(all[i]);
    return out;
  }

  // Bots fill every field; people never see this one.
  function addHoneypot(form) {
    if (form.querySelector('input[name="_ll_hp"]')) return;
    var hp = document.createElement('input');
    hp.type = 'text';
    hp.name = '_ll_hp';
    hp.tabIndex = -1;
    hp.autocomplete = 'off';
    hp.setAttribute('aria-hidden', 'true');
    hp.style.cssText = 'position:absolute;left:-9999px;top:auto;width:1px;height:1px;opacity:0;';
    form.appendChild(hp);
  }

  function fillAll() {
    var forms = targetForms();
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i];
      if (!form._llSeenAt) form._llSeenAt = Date.now();
      addConsentBox(form);
      if (siteKey) {
        addHoneypot(form);
      } else {
        fill(form); // classic mode: the site's own backend forwards the hidden fields
      }
    }
  }

  // --- 7. Snippet mode: send a copy of the submission to LeadLoop ------------
  var SENSITIVE = /pass|card|cvv|cvc|ssn|\bsin\b|iban|routing|account.?(num|no)|security.?code/i;
  var SKIP_TYPES = { password: 1, file: 1, submit: 1, button: 1, reset: 1, image: 1, hidden: 1 };

  function collect(form) {
    var out = {};
    var els = form.elements;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var name = el.name;
      if (!name || el.disabled || name.indexOf('_ll_') === 0) continue;
      var type = String(el.type || '').toLowerCase();
      if (SKIP_TYPES[type] || SENSITIVE.test(name)) continue;
      if (/^cc-/.test(el.getAttribute('autocomplete') || '')) continue;
      var val;
      if (type === 'checkbox') {
        if (!el.checked) continue;
        val = el.value && el.value !== 'on' ? el.value : 'yes';
      } else if (type === 'radio') {
        if (!el.checked) continue;
        val = el.value;
      } else if (el.multiple && el.options) {
        var picked = [];
        for (var j = 0; j < el.options.length; j++) if (el.options[j].selected) picked.push(el.options[j].value);
        val = picked.join(', ');
      } else {
        val = el.value;
      }
      val = String(val == null ? '' : val).trim().slice(0, 5000);
      if (!val) continue;
      out[name] = out[name] ? out[name] + ', ' + val : val;
    }
    return out;
  }

  function sendCopy(form) {
    if (!apiBase || !siteKey) return;
    var now = Date.now();
    if (form._llSentAt && now - form._llSentAt < 3000) return; // double submit
    form._llSentAt = now;

    var payload = collect(form);
    var f = fields();
    Object.keys(f).forEach(function (k) {
      if (f[k]) payload[k] = f[k];
    });
    var box = form.querySelector('input[type="checkbox"][name="ad_consent"]');
    if (box) {
      payload.ad_consent = box.checked ? 'yes' : 'no';
      var text = consentText(form);
      if (text) payload.consent_text = text;
    }
    var hp = form.querySelector('input[name="_ll_hp"]');
    payload._ll_hp = hp ? hp.value : '';
    payload._ll_elapsed = String(now - (form._llSeenAt || startedAt));
    payload._ll_v = '1';

    var body = JSON.stringify(payload);
    var url = apiBase + '/api/capture/' + encodeURIComponent(siteKey);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
    } catch (e) {
      /* fall through to fetch */
    }
    try {
      fetch(url, {
        method: 'POST',
        body: body,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        keepalive: true,
        credentials: 'omit',
      }).catch(function () {});
    } catch (e) {
      /* never break the site's own submit */
    }
  }

  // --- 8. Start ------------------------------------------------------------
  function start() {
    // Forms rendered after load (modals, client-side routes) get the same setup.
    if ((consentWording || siteKey) && window.MutationObserver) {
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
        var form = e.target;
        if (!isTarget(form)) return;
        if (siteKey) sendCopy(form);
        else fill(form);
      },
      true
    );

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fillAll);
    } else {
      fillAll();
    }
  }

  if (siteKey && apiBase && window.fetch) {
    // Settings live in LeadLoop. The request is refused (403) unless this page
    // is on the site key's allowed domain — then nothing is ever sent.
    fetch(apiBase + '/api/capture/' + encodeURIComponent(siteKey) + '/config', { credentials: 'omit' })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (cfg) {
        if (!cfg) {
          siteKey = '';
          apiBase = '';
          return;
        }
        if (!explicitSelector && cfg.formSelector) {
          try {
            document.querySelector(cfg.formSelector);
            formSelector = cfg.formSelector;
            explicitSelector = true;
          } catch (e) {
            /* invalid selector in settings → keep auto-detect */
          }
        }
        if (!consentWording && cfg.consentWording) consentWording = cfg.consentWording;
        if (!consentAccent && cfg.accent) consentAccent = cfg.accent;
      })
      .catch(function () {
        siteKey = '';
        apiBase = '';
      })
      .then(start);
  } else {
    siteKey = '';
    start();
  }

  window.LeadLoopCapture = { fields: fields, fill: fill, collect: collect };
})();
