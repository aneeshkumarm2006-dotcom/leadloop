import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clock, MapPin, Check, ChevronLeft, ChevronRight, Globe, Download, ArrowLeft, ArrowRight, Calendar, Video,
} from 'lucide-react';

/**
 * BookingExperience — the visitor-facing booking UI (neutral-ink 3-pane design,
 * scoped under `.pubook`). Used by BOTH the real public page (`/book/:slug`,
 * with live slots + a real submit) and the admin editor's live preview (with
 * synthetic slots + submit disabled). Sharing one component guarantees the
 * preview always matches what visitors actually see.
 *
 * Props:
 *   config      { title, durationMinutes, location, branding, questions }
 *   (the visitor picks in-person vs virtual on the form — not predefined)
 *   slots       [{ start, end }] absolute UTC instants
 *   lang        resolved language
 *   preview     when true: no network, submit disabled, sample confirmation
 *   submitting  live submit in flight
 *   error       live submit error string
 *   done        confirmation result { booking, icsUrl, cancelUrl } (live)
 *   onSubmit    ({ slotStart, visitor, answers }) => void   (live)
 */

const detectTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
const allTimezones = () => {
  try { if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone'); } catch { /* ignore */ }
  return ['UTC', 'America/Toronto', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Calcutta', 'Asia/Tokyo'];
};
const dayKey = (iso, tz) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
};
const todayKey = (tz) => dayKey(new Date().toISOString(), tz);

const BookingExperience = ({ config, slots = [], lang: langProp, preview = false, submitting = false, error = '', done = null, onSubmit }) => {
  const { t, i18n } = useTranslation();
  const lang = langProp || i18n.resolvedLanguage || undefined;

  const [tz, setTz] = useState(detectTz());
  const [viewMonth, setViewMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [step, setStep] = useState('datetime');
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [answers, setAnswers] = useState({});
  // The visitor chooses how to meet — it is NOT predefined on the link.
  const [meetingType, setMeetingType] = useState('in_person');

  const accent = config?.branding?.accentColor || '#3E6B4E';
  const accVars = { '--acc': accent, '--acc2': accent, '--acc-tint': `${accent}1A`, '--acc-tint2': `${accent}0D` };
  const isVirtual = meetingType === 'virtual';
  const whereText = isVirtual ? t('bookPublic.whatsappVideo', 'WhatsApp video call') : (config?.location || '');

  const slotsByDay = useMemo(() => {
    const map = new Map();
    for (const s of slots) {
      const k = dayKey(s.start, tz);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    }
    for (const arr of map.values()) arr.sort((a, b) => new Date(a.start) - new Date(b.start));
    return map;
  }, [slots, tz]);
  const availableDates = useMemo(() => new Set(slotsByDay.keys()), [slotsByDay]);

  useEffect(() => {
    if (availableDates.size === 0) return;
    const first = [...availableDates].sort()[0];
    const [y, m] = first.split('-').map(Number);
    // Jump to the first month that has availability when slots load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewMonth({ y, m: m - 1 });
  }, [availableDates.size]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtTime = (iso) => new Date(iso).toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const fmtLongDate = (key) => new Date(`${key}T12:00:00`).toLocaleDateString(lang, { weekday: 'long', month: 'long', day: 'numeric' });
  const slotSummary = () => {
    if (!selectedSlot) return '';
    const s = slots.find((x) => x.start === selectedSlot);
    if (!s) return '';
    const start = new Date(s.start).toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit', timeZone: tz });
    const end = new Date(s.end).toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit', timeZone: tz });
    const day = new Date(s.start).toLocaleDateString(lang, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: tz });
    return `${start} – ${end}, ${day}`;
  };

  // Virtual visits need a phone number (that's how the agent reaches them).
  const phoneOk = !isVirtual || form.phone.trim().length >= 6;
  const canSubmit = useMemo(
    () => !preview && selectedSlot && form.name.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim()) && phoneOk,
    [preview, selectedSlot, form, phoneOk]
  );

  const submit = () => {
    if (preview || !canSubmit) return;
    onSubmit?.({
      slotStart: selectedSlot,
      meetingType,
      visitor: { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() },
      answers: (config.questions || []).map((q) => ({ label: q.label, value: answers[q.id] || '' })),
    });
  };

  const logoChar = (config?.branding?.headline || config?.title || 'V').trim().charAt(0).toUpperCase();

  // ---- confirmation ----
  if (done) {
    const s = done.booking;
    const when = s ? `${new Date(s.slotStart).toLocaleString(lang, { weekday: 'short', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz })}` : '';
    return (
      <Frame narrow>
        <div className="card confirm" style={accVars}>
          <div className="logo">{logoChar}</div>
          <div className="ring"><Check size={42} strokeWidth={3} /></div>
          <h1>{t('bookPublic.confirmedTitle')}</h1>
          <p className="sub">{form.name ? <>Thanks, <b>{form.name}</b> — {t('bookPublic.confirmedSub', { title: config.title })}</> : t('bookPublic.confirmedSub', { title: config.title })}</p>
          <div className="ticket">
            <div className="ticket-top"><div className="tt">{config.branding?.headline || config.title}</div><div className="to">{config.title} · {t('bookPublic.propertyVisit', 'Property visit')}</div></div>
            <div className="perf" />
            <div className="ticket-body">
              <div className="trow"><span className="ic"><Calendar size={16} /></span><div><div className="l">{t('bookPublic.when', 'When')}</div><div className="v">{when}</div></div></div>
              {whereText && <div className="trow"><span className="ic">{isVirtual ? <Video size={16} /> : <MapPin size={16} />}</span><div><div className="l">{t('bookPublic.where', 'Where')}</div><div className="v">{whereText}{isVirtual && form.phone ? ` · ${form.phone}` : ''}</div></div></div>}
              <div className="trow"><span className="ic"><Globe size={16} /></span><div><div className="l">{t('bookPublic.timezone')}</div><div className="v">{tz.replace(/_/g, ' ')}</div></div></div>
            </div>
          </div>
          <div className="actions">
            {done.icsUrl && <a className="btn btn-p" href={done.icsUrl}><Download size={16} />{t('bookPublic.addToCalendar')}</a>}
            {done.cancelUrl && <a className="btn btn-g" href={done.cancelUrl}>{t('bookPublic.cancel', 'Cancel')}</a>}
          </div>
        </div>
        <Styles />
      </Frame>
    );
  }

  const dayList = selectedDate ? slotsByDay.get(selectedDate) || [] : [];
  const isDetails = step === 'details';
  const hasSlots = !isDetails && !!selectedDate;
  const cardClass = 'card' + (isDetails ? ' details' : hasSlots ? ' has-slots' : '');

  return (
    <Frame>
      <div className={cardClass} style={accVars}>
        <div className="logo">{logoChar}</div>

        {/* RAIL */}
        <aside className="rail">
          <div className="org">{config.title}</div>
          <h1>{config.branding?.headline || t('bookPublic.bookYourTour', 'Book your tour')}</h1>
          <div className="meta">
            <div className="m"><Clock size={18} />{t('bookPublic.duration', { count: config.durationMinutes })}</div>
            <div className="m"><Globe size={18} />{tz.replace(/_/g, ' ')}</div>
          </div>
          {isDetails && selectedSlot && (
            <div className="selbox">
              <div className="l"><Check size={13} strokeWidth={2.4} />{t('bookPublic.selected')}</div>
              <div className="v">{slotSummary()}</div>
            </div>
          )}
        </aside>

        {isDetails ? (
          <section className="formpane">
            <button type="button" className="back" onClick={() => setStep('datetime')}><ArrowLeft size={16} />{t('bookPublic.back')}</button>
            <h2>{t('bookPublic.enterDetails')}</h2>

            {/* Visitor chooses how to meet */}
            <div className="field">
              <label>{t('bookPublic.howToMeet', 'How would you like to meet?')}</label>
              <div className="mtype">
                <button type="button" className={'mt' + (!isVirtual ? ' on' : '')} onClick={() => setMeetingType('in_person')}>
                  <MapPin size={17} /><span>{t('bookPublic.inPerson', 'In person')}</span>
                </button>
                <button type="button" className={'mt' + (isVirtual ? ' on' : '')} onClick={() => setMeetingType('virtual')}>
                  <Video size={17} /><span>{t('bookPublic.whatsappVideo', 'WhatsApp video call')}</span>
                </button>
              </div>
              {!isVirtual && config.location && <div className="hint" style={{ marginTop: 8 }}><MapPin size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />{config.location}</div>}
            </div>

            <Field label={t('bookPublic.name')} required value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
            <Field label={t('bookPublic.email')} required type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
            <Field label={t('bookPublic.phone')} required={isVirtual} type="tel" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
            {isVirtual && <div className="hint" style={{ marginTop: -10, marginBottom: 14 }}>{t('bookPublic.virtualPhoneHint', 'Your agent will call you on WhatsApp video at this number.')}</div>}
            {(config.questions || []).map((q) => (
              <Field key={q.id} label={q.label} required={q.required} textarea={q.type === 'textarea'} value={answers[q.id] || ''} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
            ))}
            {error && <p style={{ fontSize: 13, color: '#DC2626', margin: '4px 0 10px' }}>{error}</p>}
            <button type="button" className="submit" onClick={submit} disabled={!canSubmit || submitting}>
              {preview ? t('bookPublic.previewSubmit', 'Schedule (preview)') : submitting ? t('bookPublic.booking') : t('bookPublic.scheduleEvent')}
            </button>
            <div className="hint">{t('bookPublic.detailsHint', 'By proceeding, you confirm the visit details above. You can reschedule any time from your confirmation email.')}</div>
          </section>
        ) : (
          <>
            <section className="mid">
              <h2>{t('bookPublic.selectDateTime')}</h2>
              {availableDates.size === 0 ? (
                <p style={{ fontSize: 14, color: 'var(--muted)', padding: '20px 0' }}>{t('bookPublic.noSlotsSub')}</p>
              ) : (
                <>
                  <CalGrid view={viewMonth} setView={setViewMonth} availableDates={availableDates} today={todayKey(tz)} selected={selectedDate} onSelect={(k) => { setSelectedDate(k); setSelectedSlot(null); }} lang={lang} />
                  <div className="tz">
                    <label><Globe size={15} />{t('bookPublic.timezone')}</label>
                    <div className="sel-wrap">
                      <select value={tz} onChange={(e) => { setTz(e.target.value); setSelectedDate(null); setSelectedSlot(null); }}>
                        {allTimezones().map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
                      </select>
                      <span className="caret"><ChevronLeft size={16} style={{ transform: 'rotate(-90deg)' }} /></span>
                    </div>
                  </div>
                </>
              )}
            </section>

            {selectedDate && (
              <aside className="slots">
                <div className="slots-head">{fmtLongDate(selectedDate)}</div>
                <div className="slots-list">
                  {dayList.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--muted)' }}>{t('bookPublic.noTimes')}</p>
                  ) : dayList.map((s) => {
                    if (selectedSlot === s.start) {
                      return (
                        <div key={s.start} className="slot-pair">
                          <button type="button" className="slot-sel">{fmtTime(s.start)}</button>
                          <button type="button" className="slot-next" onClick={() => setStep('details')}>{t('bookPublic.next')} <ArrowRight size={15} /></button>
                        </div>
                      );
                    }
                    return <button key={s.start} type="button" className="slot" onClick={() => setSelectedSlot(s.start)}>{fmtTime(s.start)}</button>;
                  })}
                </div>
              </aside>
            )}
          </>
        )}
      </div>
      <Styles />
    </Frame>
  );
};

// ---- month calendar (design: circular days, neutral tint) ----
const CalGrid = ({ view, setView, availableDates, today, selected, onSelect, lang }) => {
  const { y, m } = view;
  const monthLabel = new Date(y, m, 1).toLocaleDateString(lang, { month: 'long', year: 'numeric' });
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 0, 4 + i)).toLocaleDateString(lang, { weekday: 'short' }).slice(0, 2).toUpperCase()), [lang]);
  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const now = new Date();
  const canGoPrev = y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth());
  const shift = (delta) => setView(() => { const d = new Date(y, m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const cells = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);

  return (
    <>
      <div className="cal-head">
        <span className="mlabel">{monthLabel}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" className="cal-nav" disabled={!canGoPrev} onClick={() => canGoPrev && shift(-1)}><ChevronLeft size={20} /></button>
          <button type="button" className="cal-nav" onClick={() => shift(1)}><ChevronRight size={20} /></button>
        </div>
      </div>
      <div className="dow">{weekdays.map((w, i) => <span key={i}>{w}</span>)}</div>
      <div className="grid">
        {cells.map((d, i) => {
          if (d == null) return <div key={`e${i}`} className="day blank" />;
          const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const avail = availableDates.has(key) && key >= today;
          const isToday = key === today;
          const isSel = key === selected;
          const cls = 'day ' + (avail ? 'avail' : 'off') + (isToday ? ' today' : '') + (isSel ? ' sel' : '');
          return (
            <div key={key} className={cls} onClick={avail ? () => onSelect(key) : undefined}>
              {d}{avail && <span className="dot" />}
            </div>
          );
        })}
      </div>
    </>
  );
};

const Field = ({ label, value, onChange, type = 'text', required, textarea }) => (
  <div className="field">
    <label>{label}{required && <span className="req"> *</span>}</label>
    {textarea
      ? <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} style={{ height: 'auto', padding: '12px 15px', resize: 'vertical' }} />
      : <input type={type} value={value} onChange={(e) => onChange(e.target.value)} />}
  </div>
);

export const Frame = ({ narrow, children }) => (
  <div className="pubook">
    <div className="stage" style={narrow ? { maxWidth: 620 } : undefined}>{children}</div>
  </div>
);

export const Styles = () => (
  <style>{`
.pubook{ --ink:#211E18; --text-2:#5C554A; --muted:#9A9184; --faint:#C9C3B8;
  --bg:#F6F1E7; --surface:#FFFFFF; --border:#E4DCCB; --border-2:#DFD9CE;
  --done:#1F9B57; --r-sm:9px; --r-md:12px; --r-lg:18px; --r-xl:22px;
  --font-d:var(--font-display,"Bricolage Grotesque",system-ui,sans-serif);
  --font-b:var(--font-body,"Familjen Grotesk",system-ui,sans-serif);
  --ease:cubic-bezier(.22,1,.36,1);
  min-height:100vh; background:var(--bg); color:var(--ink); font-family:var(--font-b); line-height:1.5; -webkit-font-smoothing:antialiased;
  display:flex; align-items:center; justify-content:center; padding:56px 20px; }
.pubook *{box-sizing:border-box;}
.pubook .pb-msg{ padding:90px 24px; text-align:center; color:var(--muted); font-size:15px; }
.pubook .stage{ width:100%; max-width:1080px; }
.pubook .card{ background:var(--surface); border:1px solid var(--border); border-radius:var(--r-xl);
  box-shadow:0 1px 2px rgba(26,23,18,.04),0 18px 50px -24px rgba(26,23,18,.22);
  position:relative; display:grid; grid-template-columns:330px 1fr; transition:grid-template-columns .4s var(--ease); }
.pubook .card.has-slots{ grid-template-columns:300px 1fr 290px; }
.pubook .card.details{ grid-template-columns:360px 1fr; }
.pubook .card.confirm{ display:block; padding:54px 40px 40px; text-align:center; }
.pubook .logo{ position:absolute; top:-34px; left:36px; width:66px; height:66px; border-radius:16px;
  background:linear-gradient(140deg,var(--acc),var(--acc2)); color:#fff; display:grid; place-items:center;
  font-family:var(--font-d); font-weight:800; font-size:27px; box-shadow:0 8px 22px -8px rgba(26,23,18,.45),0 0 0 4px var(--surface); }
.pubook .rail{ padding:54px 32px 36px; border-right:1px solid var(--border); }
.pubook .rail .org{ font-size:14px; color:var(--muted); font-weight:500; }
.pubook .rail h1{ font-family:var(--font-d); font-weight:700; font-size:30px; letter-spacing:-.022em; line-height:1.1; margin-top:6px; }
.pubook .rail .meta{ margin-top:26px; display:flex; flex-direction:column; gap:16px; }
.pubook .rail .meta .m{ display:flex; align-items:center; gap:12px; font-size:15px; color:var(--text-2); font-weight:500; }
.pubook .rail .meta .m svg{ color:var(--muted); flex:0 0 auto; }
.pubook .selbox{ margin-top:26px; background:var(--acc-tint2); border:1px solid var(--acc-tint); border-radius:var(--r-md); padding:16px 18px; }
.pubook .selbox .l{ font-size:11.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--acc); margin-bottom:8px; display:flex; align-items:center; gap:7px; }
.pubook .selbox .v{ font-size:15px; font-weight:600; color:var(--ink); line-height:1.5; }
.pubook .mid{ padding:36px 34px; min-width:0; }
.pubook .card.has-slots .mid{ border-right:1px solid var(--border); }
.pubook .mid h2{ font-family:var(--font-d); font-weight:700; font-size:21px; letter-spacing:-.01em; margin-bottom:22px; }
.pubook .cal-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; }
.pubook .cal-head .mlabel{ font-family:var(--font-d); font-weight:700; font-size:18px; }
.pubook .cal-nav{ width:36px; height:36px; border-radius:10px; display:grid; place-items:center; color:var(--text-2); background:none; border:none; cursor:pointer; transition:.15s; }
.pubook .cal-nav:hover{ background:var(--acc-tint); color:var(--acc); }
.pubook .cal-nav:disabled{ opacity:.3; pointer-events:none; }
.pubook .dow{ display:grid; grid-template-columns:repeat(7,1fr); margin-bottom:8px; }
.pubook .dow span{ text-align:center; font-size:11.5px; font-weight:700; letter-spacing:.04em; color:var(--muted); }
.pubook .grid{ display:grid; grid-template-columns:repeat(7,1fr); gap:6px; }
.pubook .day{ aspect-ratio:1; border-radius:50%; display:grid; place-items:center; font-size:15px; font-weight:600; position:relative; transition:.16s var(--ease); color:var(--ink); }
.pubook .day.blank{ pointer-events:none; }
.pubook .day.off{ color:var(--faint); }
.pubook .day.avail{ cursor:pointer; background:var(--acc-tint); color:var(--acc); }
.pubook .day.avail:hover{ background:var(--acc); color:#fff; transform:translateY(-1px); box-shadow:0 5px 14px -5px var(--acc); }
.pubook .day.today{ box-shadow:inset 0 0 0 1.5px var(--acc); }
.pubook .day.sel{ background:var(--acc)!important; color:#fff!important; box-shadow:0 6px 16px -5px var(--acc); }
.pubook .day .dot{ position:absolute; bottom:7px; width:4px; height:4px; border-radius:50%; background:var(--acc); }
.pubook .day.avail:hover .dot,.pubook .day.sel .dot{ background:#fff; }
.pubook .tz{ margin-top:26px; max-width:420px; }
.pubook .tz label{ display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; color:var(--text-2); margin-bottom:9px; }
.pubook .tz .sel-wrap{ position:relative; }
.pubook .tz select{ width:100%; height:46px; padding:0 38px 0 14px; border:1px solid var(--border-2); border-radius:var(--r-sm);
  background:var(--surface); font-size:14.5px; color:var(--ink); appearance:none; cursor:pointer; font-family:var(--font-b); }
.pubook .tz select:focus{ outline:none; border-color:var(--acc); box-shadow:0 0 0 3px var(--acc-tint); }
.pubook .tz .caret{ position:absolute; right:13px; top:50%; transform:translateY(-50%); color:var(--muted); pointer-events:none; }
.pubook .slots{ padding:36px 28px; display:flex; flex-direction:column; min-width:0; }
.pubook .slots-head{ font-size:16px; font-weight:700; margin-bottom:16px; }
.pubook .slots-list{ display:flex; flex-direction:column; gap:10px; overflow-y:auto; max-height:520px; padding-right:6px; }
.pubook .slot{ height:50px; border:1px solid var(--border-2); border-radius:var(--r-sm); font-weight:700; font-size:15px; color:var(--ink);
  background:var(--surface); transition:.15s var(--ease); flex:0 0 auto; cursor:pointer; font-family:var(--font-b); }
.pubook .slot:hover{ border-color:var(--acc); color:var(--acc); }
.pubook .slot-pair{ display:grid; grid-template-columns:1fr 1fr; gap:8px; flex:0 0 auto; }
.pubook .slot-sel{ height:50px; border-radius:var(--r-sm); background:var(--ink); color:#fff; font-weight:700; font-size:15px; border:none; }
.pubook .slot-next{ height:50px; border-radius:var(--r-sm); background:linear-gradient(135deg,var(--acc),var(--acc2)); color:#fff; font-weight:700; font-size:15px;
  display:inline-flex; align-items:center; justify-content:center; gap:7px; border:none; cursor:pointer; transition:.15s var(--ease); }
.pubook .slot-next:hover{ filter:brightness(1.1); box-shadow:0 6px 18px -6px var(--acc); }
.pubook .formpane{ padding:48px 44px 44px; min-width:0; max-width:640px; }
.pubook .back{ display:inline-flex; align-items:center; gap:7px; color:var(--acc); font-weight:600; font-size:14px; margin-bottom:18px; background:none; border:none; cursor:pointer; transition:.15s; }
.pubook .back:hover{ gap:10px; }
.pubook .formpane h2{ font-family:var(--font-d); font-weight:700; font-size:22px; margin-bottom:24px; }
.pubook .field{ margin-bottom:20px; }
.pubook .field label{ display:block; font-size:14px; font-weight:600; margin-bottom:9px; }
.pubook .field .req{ color:var(--acc); }
.pubook .field input,.pubook .field textarea{ width:100%; height:50px; padding:0 15px; border:1px solid var(--border-2); border-radius:var(--r-sm);
  background:var(--surface); font-size:15px; color:var(--ink); transition:.15s; font-family:var(--font-b); }
.pubook .field input:focus,.pubook .field textarea:focus{ outline:none; border-color:var(--acc); box-shadow:0 0 0 3px var(--acc-tint); }
.pubook .mtype{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.pubook .mtype .mt{ display:flex; align-items:center; gap:9px; height:50px; padding:0 14px; border:1px solid var(--border-2); border-radius:var(--r-sm);
  background:var(--surface); color:var(--text-2); font-size:14px; font-weight:600; cursor:pointer; transition:.15s var(--ease); font-family:var(--font-b); text-align:left; }
.pubook .mtype .mt svg{ flex:0 0 auto; color:var(--muted); }
.pubook .mtype .mt:hover{ border-color:var(--acc); }
.pubook .mtype .mt.on{ border-color:var(--acc); background:var(--acc-tint); color:var(--ink); box-shadow:0 0 0 3px var(--acc-tint); }
.pubook .mtype .mt.on svg{ color:var(--acc); }
.pubook .submit{ width:100%; height:54px; border-radius:99px; font-weight:700; font-size:16px; color:#fff; margin-top:8px; border:none; cursor:pointer; transition:.18s var(--ease);
  background:linear-gradient(135deg,var(--acc),var(--acc2)); box-shadow:0 8px 22px -8px var(--acc); font-family:var(--font-b); }
.pubook .submit:hover{ filter:brightness(1.08); transform:translateY(-1px); }
.pubook .submit:disabled{ background:#D9D5CD; box-shadow:none; cursor:not-allowed; transform:none; filter:none; }
.pubook .hint{ font-size:12.5px; color:var(--muted); margin-top:14px; }
/* confirmation */
.pubook .ring{ width:84px; height:84px; border-radius:50%; display:grid; place-items:center; color:#fff; margin:8px auto 22px;
  background:linear-gradient(135deg,var(--done),#15823F); box-shadow:0 14px 34px -10px rgba(31,155,87,.55); animation:pbpop .5s var(--ease) both; }
@keyframes pbpop{0%{transform:scale(.4);opacity:0;}55%{transform:scale(1.12);}100%{transform:scale(1);opacity:1;}}
.pubook .confirm h1{ font-family:var(--font-d); font-weight:700; font-size:27px; letter-spacing:-.02em; }
.pubook .confirm .sub{ color:var(--text-2); font-size:15px; margin-top:8px; }
.pubook .confirm .sub b{ color:var(--ink); }
.pubook .ticket{ margin:28px auto 0; text-align:left; max-width:420px; border:1px solid var(--border); border-radius:var(--r-lg); overflow:hidden; box-shadow:0 6px 18px -12px rgba(26,23,18,.25); }
.pubook .ticket-top{ padding:16px 20px; background:linear-gradient(135deg,var(--acc),var(--acc2)); color:#fff; }
.pubook .ticket-top .tt{ font-family:var(--font-d); font-weight:700; font-size:16px; }
.pubook .ticket-top .to{ font-size:12.5px; opacity:.92; margin-top:2px; }
.pubook .perf{ height:0; border-top:2px dashed var(--border); position:relative; }
.pubook .perf::before,.pubook .perf::after{ content:""; position:absolute; top:-9px; width:18px; height:18px; border-radius:50%; background:var(--bg); }
.pubook .perf::before{ left:-9px; } .pubook .perf::after{ right:-9px; }
.pubook .ticket-body{ padding:18px 20px; display:flex; flex-direction:column; gap:14px; }
.pubook .trow{ display:flex; align-items:center; gap:12px; }
.pubook .trow .ic{ width:32px; height:32px; border-radius:9px; background:var(--acc-tint); color:var(--acc); display:grid; place-items:center; flex:0 0 auto; }
.pubook .trow .l{ font-size:11.5px; color:var(--muted); font-weight:600; }
.pubook .trow .v{ font-size:14.5px; font-weight:600; }
.pubook .actions{ display:flex; gap:10px; justify-content:center; margin-top:26px; flex-wrap:wrap; }
.pubook .btn{ height:46px; padding:0 20px; border-radius:99px; font-weight:600; font-size:14.5px; display:inline-flex; align-items:center; gap:8px; border:none; cursor:pointer; text-decoration:none; transition:.16s var(--ease); }
.pubook .btn-p{ background:var(--ink); color:#fff; }
.pubook .btn-p:hover{ transform:translateY(-1px); box-shadow:0 8px 20px -8px rgba(26,23,18,.5); }
.pubook .btn-g{ background:var(--surface); border:1px solid var(--border-2); color:var(--ink); }
.pubook .btn-g:hover{ border-color:var(--muted); }
@media(max-width:880px){
  .pubook .card,.pubook .card.has-slots,.pubook .card.details{ grid-template-columns:1fr; }
  .pubook .rail{ border-right:none; border-bottom:1px solid var(--border); padding-top:44px; }
  .pubook .card.has-slots .mid{ border-right:none; border-bottom:1px solid var(--border); }
  .pubook .formpane{ padding:32px 24px; }
}
  `}</style>
);

export default BookingExperience;
