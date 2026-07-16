import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { getPublicForm, submitPublicForm } from '../services/formService';

/**
 * PublicFormPage — the auth-free public renderer for `/f/:slug` (F13.5). No
 * navbar, no app shell, no store dependencies: it fetches the form config from
 * the public `/f/:slug` endpoint, renders the `fieldMap`, optionally mounts the
 * Cloudflare Turnstile widget, posts to `/f/:slug/submit`, then shows the
 * `welcomeMessage` (or redirects to `postSubmitRedirectUrl`).
 */

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

const fieldInputType = (type) => {
  if (type === 'email') return 'email';
  if (type === 'phone') return 'tel';
  if (type === 'number') return 'number';
  if (type === 'date') return 'date';
  return 'text';
};

const labelStyle = {
  display: 'block',
  marginBottom: 6,
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: '#475569',
};
const inputStyle = {
  width: '100%',
  height: 40,
  padding: '0 12px',
  fontSize: 14,
  border: '1.5px solid #E2E8F0',
  borderRadius: 8,
  background: '#fff',
  color: '#0F172A',
  fontFamily: "'Familjen Grotesk', sans-serif",
  outline: 'none',
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

  const page = useMemo(
    () => ({
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      background: 'linear-gradient(180deg, #F8FAFC 0%, #EEF2F7 100%)',
      padding: '48px 16px',
      fontFamily: "'Familjen Grotesk', sans-serif",
    }),
    []
  );
  const card = {
    width: '100%',
    maxWidth: 520,
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 10px 30px rgba(15,23,42,0.08)',
    padding: 32,
  };

  if (status === 'loading') {
    return (
      <div style={page}>
        <div style={card}>
          <p style={{ color: '#64748B', fontSize: 14 }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (status === 'notfound' || status === 'error') {
    return (
      <div style={page}>
        <div style={{ ...card, textAlign: 'center' }}>
          <AlertTriangle size={32} color="#D97706" style={{ margin: '0 auto 12px' }} />
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginBottom: 6 }}>
            {status === 'notfound' ? 'Form not found' : 'Something went wrong'}
          </h1>
          <p style={{ color: '#64748B', fontSize: 14 }}>
            {status === 'notfound'
              ? 'This form may have been unpublished or the link is incorrect.'
              : 'Please try again in a moment.'}
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={page}>
        <div style={{ ...card, textAlign: 'center' }}>
          <CheckCircle2 size={40} color="#16A34A" style={{ margin: '0 auto 14px' }} />
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', marginBottom: 8 }}>Thank you!</h1>
          <p style={{ color: '#475569', fontSize: 15, lineHeight: 1.5 }}>
            {done.welcomeMessage || 'Your submission has been received.'}
          </p>
        </div>
      </div>
    );
  }

  const brand = form.branding || {};
  const accent = brand.accentColor || '#3E6B4E';

  return (
    <div style={page}>
      <div style={card}>
        {/* Branding (Phase 1.7): cover image, logo, custom headline */}
        {brand.coverUrl && (
          <img
            src={brand.coverUrl}
            alt=""
            style={{
              width: '100%',
              height: 120,
              objectFit: 'cover',
              borderRadius: 8,
              marginBottom: 16,
            }}
          />
        )}
        {brand.logoUrl && (
          <img
            src={brand.logoUrl}
            alt=""
            style={{ height: 44, width: 'auto', objectFit: 'contain', marginBottom: 12, display: 'block' }}
          />
        )}
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', marginBottom: 24 }}>
          {brand.headline || form.name}
        </h1>
        <form onSubmit={handleSubmit} className="flex flex-col" style={{ gap: 18 }}>
          {(form.fieldMap || []).map((field) => {
            const id = field.formFieldId;
            const v = values[id] ?? '';
            return (
              <div key={id}>
                <label htmlFor={id} style={labelStyle}>
                  {field.label || 'Field'}
                  {field.required && <span style={{ color: '#DC2626', marginLeft: 4 }}>*</span>}
                </label>
                {field.type === 'dropdown' ? (
                  <select id={id} value={v} onChange={(e) => setValue(id, e.target.value)} style={inputStyle} required={field.required}>
                    <option value="">Select…</option>
                    {(field.options || []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'checkbox' ? (
                  <input id={id} type="checkbox" checked={!!v} onChange={(e) => setValue(id, e.target.checked)} style={{ width: 18, height: 18, accentColor: '#3E6B4E' }} />
                ) : field.type === 'long_text' ? (
                  <textarea id={id} value={v} onChange={(e) => setValue(id, e.target.value)} rows={4} style={{ ...inputStyle, height: 'auto', padding: 12, resize: 'vertical' }} required={field.required} />
                ) : (
                  <input id={id} type={fieldInputType(field.type)} value={v} onChange={(e) => setValue(id, e.target.value)} style={inputStyle} required={field.required} />
                )}
              </div>
            );
          })}

          {form.captchaSiteKey && (
            <div className="cf-turnstile" data-sitekey={form.captchaSiteKey} />
          )}

          {submitError && (
            <p style={{ color: '#DC2626', fontSize: 13 }}>{submitError}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              height: 44,
              borderRadius: 8,
              border: 'none',
              background: submitting ? '#93B4F5' : accent,
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontFamily: "'Familjen Grotesk', sans-serif",
            }}
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PublicFormPage;
