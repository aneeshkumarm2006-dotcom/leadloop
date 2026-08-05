import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Check, AlertTriangle, Clock, Lock, MailCheck, ArrowRight,
  ChevronDown, Calendar, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { getPublicForm, submitPublicForm } from '../services/formService';

/**
 * PublicFormPage — the auth-free public renderer for `/f/:slug` (F13.5).
 *
 * Two-panel editorial layout on the LeadLoop brand (forest + cream): a branded
 * rail (logo / headline / trust signals) beside a focused single-CTA form. No
 * navbar, no app shell — it fetches the form config, renders the `fieldMap`,
 * optionally mounts Cloudflare Turnstile, posts to `/f/:slug/submit`, then shows
 * the `welcomeMessage` (or redirects to `postSubmitRedirectUrl`).
 */

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const FOREST = '#3E6B4E';

const fieldInputType = (type) => {
  if (type === 'email') return 'email';
  if (type === 'phone') return 'tel';
  if (type === 'number') return 'number';
  if (type === 'date') return 'date';
  return 'text';
};

const initial = (s) => (s || 'F').trim().charAt(0).toUpperCase();

/** Close a popover on outside click or Escape. */
const useDismiss = (ref, close) => {
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [ref, close]);
};

/** Custom dropdown — replaces the native <select> so it stays on-brand. */
const LfSelect = ({ id, value, options = [], onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false));
  return (
    <div className="lf-pop" ref={ref}>
      <button
        type="button" id={id}
        className={`lf-select${open ? ' open' : ''}${value ? '' : ' placeholder'}`}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="lf-select-val">{value || 'Select…'}</span>
        <ChevronDown size={17} className="lf-caret" />
      </button>
      {open && (
        <ul className="lf-menu" role="listbox">
          {options.length === 0 && <li className="lf-menu-empty">No options</li>}
          {options.map((opt) => (
            <li
              key={opt} role="option" aria-selected={value === opt}
              className={`lf-opt${value === opt ? ' on' : ''}`}
              onClick={() => { onChange(opt); setOpen(false); }}
            >
              {opt}{value === opt && <Check size={15} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const isoOf = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

/** Custom calendar — replaces the native date input. */
const LfDate = ({ id, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(ref, () => setOpen(false));
  const now = new Date();
  const start = value
    ? { y: +value.split('-')[0], m: +value.split('-')[1] - 1 }
    : { y: now.getFullYear(), m: now.getMonth() };
  const [view, setView] = useState(start);
  const firstDow = new Date(view.y, view.m, 1).getDay();
  const daysIn = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  const shift = (delta) => setView((v) => { const d = new Date(v.y, v.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  return (
    <div className="lf-pop" ref={ref}>
      <button
        type="button" id={id}
        className={`lf-select${open ? ' open' : ''}${value ? '' : ' placeholder'}`}
        aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="lf-select-val">{value ? fmtDate(value) : 'Pick a date'}</span>
        <Calendar size={16} className="lf-caret" />
      </button>
      {open && (
        <div className="lf-cal" role="dialog" aria-label="Choose a date">
          <div className="lf-cal-head">
            <button type="button" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={17} /></button>
            <span>{MONTHS[view.m]} {view.y}</span>
            <button type="button" onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={17} /></button>
          </div>
          <div className="lf-cal-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
          <div className="lf-cal-grid">
            {cells.map((d, i) => (d === null
              ? <span key={`e${i}`} />
              : (
                <button
                  type="button" key={d}
                  className={`lf-day${value === isoOf(view.y, view.m, d) ? ' sel' : ''}`}
                  onClick={() => { onChange(isoOf(view.y, view.m, d)); setOpen(false); }}
                >
                  {d}
                </button>
              )))}
          </div>
        </div>
      )}
    </div>
  );
};

const PublicFormPage = () => {
  const { slug } = useParams();
  const [form, setForm] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | notfound | error
  const [values, setValues] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState(null); // { welcomeMessage }
  const captchaMounted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getPublicForm(slug)
      .then((f) => {
        if (cancelled) return;
        setForm(f);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus(err?.response?.status === 404 ? 'notfound' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Inject the Turnstile script once when the form opts into captcha.
  useEffect(() => {
    if (!form?.captchaSiteKey || captchaMounted.current) return;
    captchaMounted.current = true;
    if (!document.querySelector(`script[src="${TURNSTILE_SCRIPT}"]`)) {
      const s = document.createElement('script');
      s.src = TURNSTILE_SCRIPT;
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
  }, [form]);

  const setValue = (id, v) => setValues((prev) => ({ ...prev, [id]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');

    // Client-side required check (the server re-validates).
    const missing = (form.fieldMap || []).filter((f) => f.required && !String(values[f.formFieldId] ?? '').trim());
    if (missing.length > 0) {
      setSubmitError(`Please fill in: ${missing.map((f) => f.label || 'field').join(', ')}`);
      return;
    }

    let token;
    if (form.captchaSiteKey) {
      const el = document.querySelector('[name="cf-turnstile-response"]');
      token = el ? el.value : '';
      if (!token) {
        setSubmitError('Please complete the captcha challenge.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await submitPublicForm(slug, values, token);
      if (res.redirectUrl) {
        window.location.assign(res.redirectUrl);
        return;
      }
      setDone({ welcomeMessage: res.welcomeMessage || form.welcomeMessage || '' });
    } catch (err) {
      setSubmitError(err?.response?.data?.error || 'Something went wrong submitting the form. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ---- non-form states (loading / not found / error) ----
  if (status === 'loading') {
    return (
      <div className="lf">
        <div className="lf-msg">Loading…</div>
        <Styles accent={FOREST} />
      </div>
    );
  }

  if (status === 'notfound' || status === 'error') {
    return (
      <div className="lf">
        <div className="lf-note">
          <span className="lf-note-ic"><AlertTriangle size={26} /></span>
          <h1>{status === 'notfound' ? 'Form not found' : 'Something went wrong'}</h1>
          <p>
            {status === 'notfound'
              ? 'This form may have been unpublished, or the link is incorrect.'
              : 'Please try again in a moment.'}
          </p>
        </div>
        <Styles accent={FOREST} />
      </div>
    );
  }

  const brand = form.branding || {};
  const accent = brand.accentColor || FOREST;
  const headline = brand.headline || form.name;
  const railStyle = brand.coverUrl
    ? { backgroundImage: `linear-gradient(160deg, rgba(20,32,24,.72), rgba(16,26,20,.86)), url(${brand.coverUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : undefined;

  // ---- success ----
  if (done) {
    return (
      <div className="lf">
        <div className="lf-done" style={{ '--acc': accent }}>
          <span className="lf-done-ring"><Check size={40} strokeWidth={3} /></span>
          <h1>Thank you!</h1>
          <p>{done.welcomeMessage || 'Your details have been received — we’ll be in touch shortly.'}</p>
        </div>
        <Styles accent={accent} />
      </div>
    );
  }

  // ---- the form ----
  return (
    <div className="lf">
      <div className="lf-stage" style={{ '--acc': accent }}>
        <div className="lf-card">
          {/* brand rail */}
          <aside className="lf-rail" style={railStyle}>
            <div className="lf-rail-inner">
              {brand.logoUrl ? (
                <img className="lf-logo-img" src={brand.logoUrl} alt="" />
              ) : (
                <span className="lf-logo">{initial(headline)}</span>
              )}
              <div>
                {brand.headline && <div className="lf-org">{form.name}</div>}
                <h1 className="lf-title">{headline}</h1>
              </div>
              <ul className="lf-trust">
                <li><span className="lf-trust-ic"><Clock size={14} /></span>Takes about a minute</li>
                <li><span className="lf-trust-ic"><MailCheck size={14} /></span>We’ll follow up by email</li>
                <li><span className="lf-trust-ic"><Lock size={14} /></span>Your details stay private</li>
              </ul>
              <div className="lf-rail-foot">Secure form</div>
            </div>
          </aside>

          {/* form panel */}
          <section className="lf-panel">
            <div className="lf-steps">
              <span className="lf-step on"><span className="lf-step-n">1</span>Your details</span>
              <span className="lf-step-bar" />
              <span className="lf-step"><span className="lf-step-n">2</span>Done</span>
            </div>

            <form onSubmit={handleSubmit} className="lf-form" noValidate>
              {(form.fieldMap || []).map((field) => {
                const id = field.formFieldId;
                const v = values[id] ?? '';
                if (field.type === 'checkbox') {
                  return (
                    <label key={id} className="lf-check">
                      <input id={id} type="checkbox" checked={!!v} onChange={(e) => setValue(id, e.target.checked)} />
                      <span>{field.label || 'Field'}{field.required && <span className="lf-req"> *</span>}</span>
                    </label>
                  );
                }
                return (
                  <div key={id} className="lf-field">
                    <label htmlFor={id}>
                      {field.label || 'Field'}
                      {field.required && <span className="lf-req"> *</span>}
                    </label>
                    {field.type === 'dropdown' ? (
                      <LfSelect id={id} value={v} options={field.options || []} onChange={(val) => setValue(id, val)} />
                    ) : field.type === 'date' ? (
                      <LfDate id={id} value={v} onChange={(val) => setValue(id, val)} />
                    ) : field.type === 'long_text' ? (
                      <textarea id={id} value={v} onChange={(e) => setValue(id, e.target.value)} rows={4} required={field.required} />
                    ) : (
                      <input id={id} type={fieldInputType(field.type)} value={v} onChange={(e) => setValue(id, e.target.value)} required={field.required} />
                    )}
                  </div>
                );
              })}

              {form.captchaSiteKey && <div className="cf-turnstile" data-sitekey={form.captchaSiteKey} />}

              {submitError && (
                <p className="lf-error" role="alert">
                  <AlertTriangle size={14} /> {submitError}
                </p>
              )}

              <button type="submit" className="lf-cta" disabled={submitting}>
                {submitting ? 'Sending…' : (<>Send my request <ArrowRight size={17} /></>)}
              </button>
              <p className="lf-privacy">By sending, you agree to be contacted about your enquiry. No account needed.</p>
            </form>
          </section>
        </div>
      </div>
      <Styles accent={accent} />
    </div>
  );
};

/* Scoped styles — self-contained so the public page never depends on the app shell. */
const Styles = () => (
  <style>{`
.lf{ --acc:#3E6B4E; --cream:#F6F1E7; --sand:#FCFAF4; --surface:#FFFFFF; --ink:#211E18;
  --clay:#5C554A; --taupe:#9A9184; --line:#E4DCCB; --line-strong:#D6CCB6; --forest-deep:#284A36;
  --done:#2F6B47; --red:#C0392E;
  --font-d:var(--font-display,"Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif);
  --font-b:var(--font-body,"Familjen Grotesk",ui-sans-serif,system-ui,sans-serif);
  --font-m:var(--font-mono,"Space Mono",ui-monospace,monospace);
  min-height:100vh; background:#EFE9DB; color:var(--ink); font-family:var(--font-b);
  display:flex; align-items:center; justify-content:center; padding:48px 18px; line-height:1.5;
  -webkit-font-smoothing:antialiased; }
.lf *{ box-sizing:border-box; }
.lf-stage{ width:100%; max-width:940px; }

.lf-card{ display:grid; grid-template-columns:320px 1fr; background:var(--surface);
  border:1px solid var(--line); border-radius:20px; overflow:hidden;
  box-shadow:0 1px 2px rgba(33,30,24,.05), 0 30px 64px -28px rgba(33,30,24,.34); }

/* rail */
.lf-rail{ background:linear-gradient(160deg,var(--acc),var(--forest-deep)); position:relative; }
.lf-rail-inner{ padding:34px 28px; display:flex; flex-direction:column; gap:22px; min-height:100%; color:#EDF3EC; }
.lf-logo{ width:48px; height:48px; border-radius:13px; background:rgba(255,255,255,.15);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.28); display:grid; place-items:center;
  font-family:var(--font-d); font-weight:800; font-size:21px; color:#fff; }
.lf-logo-img{ height:44px; width:auto; max-width:160px; object-fit:contain; display:block; }
.lf-org{ font-size:12.5px; color:rgba(233,243,234,.72); font-weight:600; margin-bottom:4px; }
.lf-title{ font-family:var(--font-d); font-weight:700; font-size:27px; line-height:1.1;
  letter-spacing:-.02em; margin:0; color:#fff; text-wrap:balance; }
.lf-trust{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:12px; }
.lf-trust li{ display:flex; align-items:center; gap:10px; font-size:13px; color:rgba(233,243,234,.9); }
.lf-trust-ic{ width:26px; height:26px; border-radius:8px; background:rgba(255,255,255,.13);
  display:grid; place-items:center; flex:0 0 auto; color:#C7E7CE; }
.lf-rail-foot{ margin-top:auto; font-family:var(--font-m); font-size:10px; letter-spacing:.1em;
  text-transform:uppercase; color:rgba(199,231,206,.6); }

/* panel */
.lf-panel{ padding:34px 38px 30px; min-width:0; }
.lf-steps{ display:flex; align-items:center; gap:9px; margin-bottom:24px; }
.lf-step{ display:flex; align-items:center; gap:7px; font-size:12px; font-weight:600; color:var(--taupe); }
.lf-step.on{ color:var(--acc); }
.lf-step-n{ width:21px; height:21px; border-radius:99px; display:grid; place-items:center; font-size:11px;
  background:color-mix(in srgb, var(--acc) 12%, transparent); color:var(--acc); font-weight:700; }
.lf-step.on .lf-step-n{ background:var(--acc); color:#fff; }
.lf-step-bar{ flex:1; height:1.5px; background:var(--line); }

.lf-form{ display:flex; flex-direction:column; gap:17px; }
.lf-field label{ display:block; font-size:12px; font-weight:700; letter-spacing:.03em;
  text-transform:uppercase; color:var(--clay); margin-bottom:7px; }
.lf-req{ color:var(--red); }
.lf-field input, .lf-field select, .lf-field textarea{ width:100%; height:48px; border-radius:11px;
  border:1.5px solid var(--line-strong); background:var(--sand); padding:0 14px; font-size:15px;
  color:var(--ink); font-family:var(--font-b); outline:none; transition:border-color .15s, box-shadow .15s, background .15s; }
.lf-field textarea{ height:auto; padding:12px 14px; resize:vertical; }
.lf-field input:focus, .lf-field select:focus, .lf-field textarea:focus{
  border-color:var(--acc); box-shadow:0 0 0 3px color-mix(in srgb, var(--acc) 15%, transparent); background:var(--surface); }
.lf-check{ display:flex; align-items:center; gap:10px; font-size:14.5px; color:var(--ink); cursor:pointer; }
.lf-check input{ width:19px; height:19px; accent-color:var(--acc); flex:0 0 auto; }

/* custom dropdown + calendar (no native select / date control) */
.lf-pop{ position:relative; }
.lf-select{ width:100%; height:48px; border-radius:11px; border:1.5px solid var(--line-strong); background:var(--sand);
  padding:0 12px 0 14px; font-size:15px; color:var(--ink); font-family:var(--font-b); cursor:pointer; text-align:left;
  display:flex; align-items:center; justify-content:space-between; gap:10px;
  transition:border-color .15s, box-shadow .15s, background .15s; }
.lf-select-val{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.lf-select.placeholder .lf-select-val{ color:var(--taupe); }
.lf-select:hover{ border-color:var(--acc); }
.lf-select.open{ border-color:var(--acc); box-shadow:0 0 0 3px color-mix(in srgb, var(--acc) 15%, transparent); background:var(--surface); }
.lf-caret{ color:var(--taupe); flex:0 0 auto; transition:transform .18s var(--ease, ease), color .15s; }
.lf-select.open .lf-caret{ color:var(--acc); transform:rotate(180deg); }
.lf-cal .lf-caret, .lf-select[aria-haspopup="dialog"].open .lf-caret{ transform:none; }

.lf-menu{ position:absolute; top:calc(100% + 6px); left:0; right:0; z-index:40; list-style:none; margin:0; padding:6px;
  background:var(--surface); border:1px solid var(--line); border-radius:12px;
  box-shadow:0 18px 44px -14px rgba(33,30,24,.32); max-height:244px; overflow-y:auto; animation:lfdrop .14s ease; }
.lf-opt{ display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px; border-radius:8px;
  font-size:14.5px; color:var(--ink); cursor:pointer; }
.lf-opt:hover{ background:var(--sand); }
.lf-opt.on{ color:var(--acc); font-weight:600; background:color-mix(in srgb, var(--acc) 9%, transparent); }
.lf-menu-empty{ padding:10px 12px; font-size:13.5px; color:var(--taupe); }

.lf-cal{ position:absolute; top:calc(100% + 6px); left:0; z-index:40; width:290px; padding:14px;
  background:var(--surface); border:1px solid var(--line); border-radius:14px;
  box-shadow:0 18px 44px -14px rgba(33,30,24,.32); animation:lfdrop .14s ease; }
.lf-cal-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
.lf-cal-head span{ font-family:var(--font-d); font-weight:700; font-size:15px; }
.lf-cal-head button{ width:32px; height:32px; border-radius:8px; border:none; background:transparent; color:var(--clay);
  cursor:pointer; display:grid; place-items:center; transition:background .12s, color .12s; }
.lf-cal-head button:hover{ background:var(--sand); color:var(--acc); }
.lf-cal-dow{ display:grid; grid-template-columns:repeat(7,1fr); margin-bottom:6px; }
.lf-cal-dow span{ text-align:center; font-size:10.5px; font-weight:700; letter-spacing:.03em; color:var(--taupe); text-transform:uppercase; }
.lf-cal-grid{ display:grid; grid-template-columns:repeat(7,1fr); gap:3px; }
.lf-day{ aspect-ratio:1; border:none; background:transparent; border-radius:9px; font-size:13.5px; color:var(--ink);
  font-family:var(--font-b); cursor:pointer; transition:background .12s, color .12s; }
.lf-day:hover{ background:var(--sand); color:var(--acc); }
.lf-day.sel{ background:var(--acc); color:#fff; font-weight:700; }
@keyframes lfdrop{ from{ opacity:0; transform:translateY(-4px); } to{ opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce){ .lf-menu, .lf-cal{ animation:none; } }

.lf-error{ display:flex; align-items:center; gap:7px; font-size:13px; color:var(--red); margin:0; }
.lf-cta{ height:52px; border-radius:99px; border:none; background:var(--acc); color:#fff;
  font-family:var(--font-b); font-weight:700; font-size:16px; cursor:pointer; margin-top:4px;
  display:inline-flex; align-items:center; justify-content:center; gap:9px;
  box-shadow:0 12px 26px -12px var(--acc); transition:transform .15s, filter .15s; }
.lf-cta:hover:not(:disabled){ filter:brightness(1.07); transform:translateY(-1px); }
.lf-cta:disabled{ opacity:.65; cursor:not-allowed; }
.lf-privacy{ text-align:center; font-size:12px; color:var(--taupe); margin:11px 0 0; }

/* misc states */
.lf-msg{ background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:28px 32px;
  color:var(--clay); font-size:14px; box-shadow:0 8px 26px -14px rgba(33,30,24,.2); }
.lf-note{ max-width:420px; text-align:center; background:var(--surface); border:1px solid var(--line);
  border-radius:18px; padding:40px 32px; box-shadow:0 20px 50px -24px rgba(33,30,24,.28); }
.lf-note-ic{ display:inline-grid; place-items:center; width:52px; height:52px; border-radius:14px;
  background:#FBF0DD; color:#B07A18; margin-bottom:14px; }
.lf-note h1{ font-family:var(--font-d); font-weight:700; font-size:21px; margin:0 0 8px; color:var(--ink); }
.lf-note p{ color:var(--clay); font-size:14px; margin:0; }
.lf-done{ max-width:460px; text-align:center; background:var(--surface); border:1px solid var(--line);
  border-radius:20px; padding:48px 36px; box-shadow:0 26px 60px -24px rgba(33,30,24,.32); }
.lf-done-ring{ display:inline-grid; place-items:center; width:82px; height:82px; border-radius:50%;
  background:linear-gradient(135deg,var(--done),#15823F); color:#fff; margin:0 auto 20px;
  box-shadow:0 14px 34px -10px rgba(31,155,87,.5); animation:lfpop .5s cubic-bezier(.22,.61,.36,1) both; }
.lf-done h1{ font-family:var(--font-d); font-weight:700; font-size:26px; letter-spacing:-.02em; margin:0 0 8px; }
.lf-done p{ color:var(--clay); font-size:15px; line-height:1.55; margin:0; }
@keyframes lfpop{ 0%{ transform:scale(.4); opacity:0; } 55%{ transform:scale(1.12); } 100%{ transform:scale(1); opacity:1; } }
@media (prefers-reduced-motion: reduce){ .lf-done-ring{ animation:none; } }

@media (max-width:760px){
  .lf-card{ grid-template-columns:1fr; }
  .lf-rail-inner{ padding:26px 24px; gap:16px; }
  .lf-trust{ display:none; }
  .lf-panel{ padding:26px 22px; }
}
  `}</style>
);

export default PublicFormPage;
