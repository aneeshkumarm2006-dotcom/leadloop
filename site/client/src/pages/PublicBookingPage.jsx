import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, Calendar } from 'lucide-react';
import * as bookingService from '../services/bookingService';
import BookingExperience, { Frame, Styles } from '../components/booking/BookingExperience';

/**
 * PublicBookingPage — the public `/book/:slug` page. Owns the data (config +
 * slots), the submit, and the cancel flow; the actual visitor UI is the shared
 * <BookingExperience> (so the admin editor preview matches it exactly).
 */
const PublicBookingPage = () => {
  const { slug } = useParams();
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const cancelToken = params.get('cancel');

  const [config, setConfig] = useState(null);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const [cancelState, setCancelState] = useState(cancelToken ? 'prompt' : null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([bookingService.getPublicBooking(slug), bookingService.getPublicSlots(slug)])
      .then(([cfg, sl]) => { if (cancelled) return; setConfig(cfg); setSlots((sl.days || []).flatMap((d) => d.slots)); })
      .catch(() => { if (!cancelled) setNotFound(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  const handleSubmit = async (payload) => {
    if (submitting) return;
    setSubmitting(true); setError('');
    try {
      const res = await bookingService.submitBooking(slug, payload);
      setDone(res);
    } catch (err) {
      setError(err?.response?.data?.error || t('bookPublic.submitError'));
      if (err?.response?.status === 409) {
        bookingService.getPublicSlots(slug).then((sl) => setSlots((sl.days || []).flatMap((d) => d.slots))).catch(() => {});
      }
    } finally { setSubmitting(false); }
  };

  const handleCancel = async () => {
    setCancelState('working');
    try { await bookingService.cancelBooking(slug, cancelToken); setCancelState('done'); }
    catch { setCancelState('error'); }
  };

  if (loading) return <Frame><div className="pb-msg">{t('bookPublic.loading')}</div></Frame>;
  if (notFound) return <Frame><div className="pb-msg">{t('bookPublic.notAvailable')}</div></Frame>;

  const accent = config?.branding?.accentColor || '#26221C';
  const accVars = { '--acc': accent, '--acc2': accent, '--acc-tint': `${accent}1A`, '--acc-tint2': `${accent}0D` };
  const logoChar = (config?.branding?.headline || config?.title || 'V').trim().charAt(0).toUpperCase();

  // ---- cancel flow (its own minimal screen) ----
  if (cancelState) {
    return (
      <Frame narrow>
        <div className="card confirm" style={accVars}>
          <div className="logo">{logoChar}</div>
          {cancelState === 'done' ? (
            <><div className="ring" style={{ background: 'linear-gradient(135deg,#1F9B57,#15823F)' }}><Check size={42} strokeWidth={3} /></div><h1>{t('bookPublic.cancelledTitle')}</h1><p className="sub">{t('bookPublic.cancelledSub')}</p></>
          ) : cancelState === 'error' ? (
            <><div className="ring" style={{ background: 'linear-gradient(135deg,#DC2626,#B91C1C)' }}><Calendar size={40} /></div><h1>{t('bookPublic.cancelErrorTitle')}</h1><p className="sub">{t('bookPublic.cancelErrorSub')}</p></>
          ) : (
            <><h1 style={{ marginTop: 6 }}>{t('bookPublic.cancelPromptTitle')}</h1><p className="sub">{t('bookPublic.cancelPromptSub', { title: config?.title || '' })}</p>
              <div className="actions"><button type="button" className="btn btn-p" style={{ background: '#DC2626' }} onClick={handleCancel} disabled={cancelState === 'working'}>{cancelState === 'working' ? t('bookPublic.cancelling') : t('bookPublic.confirmCancel')}</button></div></>
          )}
        </div>
        <Styles />
      </Frame>
    );
  }

  return (
    <BookingExperience
      config={config}
      slots={slots}
      submitting={submitting}
      error={error}
      done={done}
      onSubmit={handleSubmit}
    />
  );
};

export default PublicBookingPage;
