import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BrandLogo from './BrandLogo';
import {
  DialogShell, SignInButton, SignedInBar, SelectField, TextField, RadioCard, CheckCard, SetupPanel,
  PrimaryButton, SecondaryButton, LinkButton, LockNote, Notice, LoadingBlock, Pill, FieldLabel, MUTED,
} from './AdsShared';
import { asList, tail, timeAgo } from './adsHelpers';
import * as adConnect from '../../../services/adConnectService';
import { sendMetaTestEvent } from '../../../services/adConversionService';
import useToastStore from '../../../store/toastStore';

/**
 * Connect Meta — 4 steps: Sign in (OAuth) → Choose accounts (business, ad
 * account, pixel) → Lead Ads (Pages → board) → Test (optional test event).
 */

const STEP_KEYS = ['signin', 'accounts', 'leadads', 'test'];
const NEW_PIXEL = '__new__';

const MetaConnectDialog = ({ workspaceId, overview, boards, initialStep, onClose, onChanged, onStartOAuth }) => {
  const { t } = useTranslation();
  const toast = useToastStore.getState();
  const meta = overview.meta;
  const signedIn = meta.status !== 'none';

  const [stepState, setStep] = useState(initialStep && STEP_KEYS.includes(initialStep) ? initialStep : 'accounts');
  const step = signedIn ? (stepState === 'signin' ? 'accounts' : stepState) : 'signin';
  const stepIndex = STEP_KEYS.indexOf(step);

  /* ---------------------------- assets ---------------------------- */
  const [assets, setAssets] = useState(null);
  const [assetsError, setAssetsError] = useState('');
  const [assetsKey, setAssetsKey] = useState(0);
  useEffect(() => {
    if (!signedIn) return undefined;
    let alive = true;
    adConnect
      .getMetaAssets(workspaceId)
      .then((d) => {
        if (!alive) return;
        const businesses = Array.isArray(d?.businesses) ? d.businesses.filter((b) => b && b.id) : [];
        const adAccounts = Array.isArray(d?.adAccounts) ? d.adAccounts.filter((a) => a && a.id) : [];
        const pages = Array.isArray(d?.pages) ? d.pages.filter((p) => p && p.id) : [];
        setAssets({ user: d?.user || {}, businesses, adAccounts, pages });
      })
      .catch((err) => alive && setAssetsError(adConnect.errorMessage(err, t('adsHub.meta.assetsError'))));
    return () => {
      alive = false;
    };
  }, [workspaceId, signedIn, assetsKey, t]);
  const retryAssets = () => {
    setAssets(null);
    setAssetsError('');
    setAssetsKey((k) => k + 1);
  };

  /* ---------------------- choose accounts state ---------------------- */
  const [businessIdState, setBusinessId] = useState('');
  const [adAccountIdState, setAdAccountId] = useState('');
  const businesses = useMemo(() => assets?.businesses || [], [assets]);
  const businessId =
    businessIdState ||
    (businesses.find((b) => b.name === meta.businessName)?.id ?? businesses[0]?.id ?? '');
  const adAccounts = useMemo(
    () => (assets?.adAccounts || []).filter((a) => !businessId || !a.businessId || String(a.businessId) === String(businessId)),
    [assets, businessId],
  );
  const adAccountId =
    (adAccounts.some((a) => a.id === adAccountIdState) && adAccountIdState) ||
    (adAccounts.find((a) => a.id === meta.adAccountId)?.id ?? adAccounts[0]?.id ?? '');
  const business = businesses.find((b) => b.id === businessId);
  const adAccount = adAccounts.find((a) => a.id === adAccountId);

  // pixels for the selected ad account
  const [pixelsFor, setPixelsFor] = useState({ id: '', pixels: [], error: '' });
  useEffect(() => {
    if (!adAccountId) return undefined;
    let alive = true;
    adConnect
      .getMetaPixels(workspaceId, adAccountId)
      .then((pixels) => alive && setPixelsFor({ id: adAccountId, pixels: pixels.filter((p) => p && p.id), error: '' }))
      .catch((err) => alive && setPixelsFor({ id: adAccountId, pixels: [], error: adConnect.errorMessage(err, t('adsHub.meta.pixelsError')) }));
    return () => {
      alive = false;
    };
  }, [workspaceId, adAccountId, t]);
  const pixelsLoading = !!adAccountId && pixelsFor.id !== adAccountId;
  const pixels = useMemo(() => (pixelsLoading ? [] : pixelsFor.pixels), [pixelsLoading, pixelsFor]);
  const recommendedPixelId = useMemo(() => {
    let best = null;
    pixels.forEach((p) => {
      const at = p.lastFiredAt ? new Date(p.lastFiredAt).getTime() : 0;
      if (at && (!best || at > best.at)) best = { id: p.id, at };
    });
    return best ? best.id : '';
  }, [pixels]);

  const [pixelChoiceState, setPixelChoice] = useState('');
  const pixelChoice =
    (pixelChoiceState === NEW_PIXEL || pixels.some((p) => p.id === pixelChoiceState)) ? pixelChoiceState
      : pixels.find((p) => p.id === meta.pixelId)?.id || recommendedPixelId || pixels[0]?.id || NEW_PIXEL;
  const defaultPixelName = `${business?.name || adAccount?.name || t('adsHub.meta.yourBusiness')} · LeadLoop`.slice(0, 100);
  const [pixelName, setPixelName] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const saveAccounts = async () => {
    if (!adAccountId) return;
    setSaving(true);
    setSaveError('');
    try {
      const body = { businessId, adAccountId };
      if (pixelChoice === NEW_PIXEL) {
        body.createPixel = true;
        body.pixelName = (pixelName.trim() || defaultPixelName).slice(0, 100);
      } else {
        body.pixelId = pixelChoice;
      }
      await adConnect.selectMeta(workspaceId, body);
      onChanged();
      setStep('leadads');
    } catch (err) {
      setSaveError(adConnect.errorMessage(err, t('adsHub.meta.saveError')));
    } finally {
      setSaving(false);
    }
  };

  /* ---------------------------- lead ads ---------------------------- */
  const subscribedIds = useMemo(() => meta.pages.filter((p) => p.subscribed).map((p) => p.pageId), [meta.pages]);
  const [pageSel, setPageSel] = useState(null); // null = untouched → use subscribedIds
  const selectedPages = pageSel || subscribedIds;
  const togglePage = (id, on) => {
    const base = new Set(selectedPages);
    if (on) base.add(id);
    else base.delete(id);
    setPageSel([...base]);
  };
  const [boardIdState, setBoardId] = useState('');
  const boardId = boardIdState || boards[0]?._id || '';
  const [failedPages, setFailedPages] = useState([]);

  const saveLeadAds = async () => {
    // Nothing chosen and nothing to turn off → behave like "skip".
    if (selectedPages.length === 0 && subscribedIds.length === 0) {
      setStep('test');
      return;
    }
    if (selectedPages.length > 0 && !boardId) return;
    setSaving(true);
    setSaveError('');
    try {
      const { failed } = await adConnect.setMetaLeadAds(workspaceId, { pageIds: selectedPages, boardId });
      onChanged();
      if (failed.length) {
        // Stay on this step so the user sees which Pages need attention.
        const names = failed.map((id) => assets?.pages.find((p) => String(p.id) === id)?.name || id);
        setFailedPages(names);
        const ok = selectedPages.length - failed.length;
        if (ok > 0) toast.success(t('adsHub.meta.leadAdsOn', { count: ok }));
        return;
      }
      setFailedPages([]);
      toast.success(
        selectedPages.length
          ? t('adsHub.meta.leadAdsOn', { count: selectedPages.length })
          : t('adsHub.meta.leadAdsOff'),
      );
      setStep('test');
    } catch (err) {
      setSaveError(adConnect.errorMessage(err, t('adsHub.meta.leadAdsError')));
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------ test ------------------------------ */
  const [testCode, setTestCode] = useState('');
  const [testResult, setTestResult] = useState(null);
  const runTest = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const r = await sendMetaTestEvent(workspaceId, testCode.trim());
      if (Array.isArray(r?.warnings) && r.warnings.length) {
        setTestResult({ tone: 'warn', text: `${t('adsHub.meta.testWarn')} ${r.warnings.map(String).join(' ').slice(0, 400)}` });
      } else {
        setTestResult({ tone: 'ok', text: t('adsHub.meta.testOk') });
        onChanged();
      }
    } catch (err) {
      setTestResult({ tone: 'error', text: adConnect.errorMessage(err, t('adsHub.meta.testFail')) });
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------ render ------------------------------ */
  const pixelGroupId = useId();
  const pagesGroupId = useId();
  const userName = assets?.user?.name || meta.userName;
  const steps = [t('adsHub.steps.signIn'), t('adsHub.steps.chooseAccounts'), t('adsHub.steps.leadAds'), t('adsHub.steps.test')];

  const switchAccount = <LinkButton onClick={() => onStartOAuth('meta')}>{t('adsHub.common.switchAccount')}</LinkButton>;

  let body;
  let footer;

  if (step === 'signin') {
    body = (
      <>
        <p style={{ margin: 0, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>{t('adsHub.meta.signInIntro')}</p>
        <SetupPanel title={t('adsHub.common.whatWeSetUp')} items={asList(t('adsHub.meta.setupItems', { returnObjects: true }))} />
        <div><SignInButton platform="meta" onClick={() => onStartOAuth('meta')} /></div>
      </>
    );
    footer = (
      <>
        <span className="flex-1"><LockNote>{t('adsHub.common.neverPost')}</LockNote></span>
        <SecondaryButton onClick={onClose}>{t('adsHub.common.cancel')}</SecondaryButton>
      </>
    );
  } else if (step !== 'test' && !assets && !assetsError) {
    body = <LoadingBlock label={t('adsHub.meta.loadingAssets')} />;
  } else if (step !== 'test' && assetsError) {
    body = (
      <Notice tone="error" action={<SecondaryButton size="sm" onClick={retryAssets}>{t('adsHub.common.retry')}</SecondaryButton>}>
        {assetsError}
      </Notice>
    );
    footer = (
      <>
        <span className="flex-1" />
        {switchAccount}
        <SecondaryButton onClick={onClose}>{t('adsHub.common.close')}</SecondaryButton>
      </>
    );
  } else if (step === 'accounts') {
    body = (
      <>
        <SignedInBar logo="facebook" action={switchAccount}>
          {userName ? <>{t('adsHub.meta.signedInAs')} <strong>{userName}</strong></> : t('adsHub.meta.signedIn')}
        </SignedInBar>
        {businesses.length > 0 && (
          <SelectField
            label={t('adsHub.meta.business')}
            value={businessId}
            onChange={(v) => {
              setBusinessId(v);
              setAdAccountId('');
              setPixelChoice('');
            }}
            options={businesses.map((b) => ({ value: b.id, label: String(b.name || b.id) }))}
          />
        )}
        {adAccounts.length === 0 ? (
          <Notice tone="warn">{t('adsHub.meta.noAdAccounts')}</Notice>
        ) : (
          <SelectField
            label={t('adsHub.meta.adAccount')}
            value={adAccountId}
            onChange={(v) => {
              setAdAccountId(v);
              setPixelChoice('');
            }}
            options={adAccounts.map((a) => ({ value: a.id, label: `${String(a.name || a.id)}  (${tail(a.id)})` }))}
            hint={t('adsHub.meta.foundAdAccounts', { count: adAccounts.length })}
          />
        )}
        {adAccountId && (
          <div className="flex flex-col gap-2">
            <FieldLabel id={pixelGroupId}>{t('adsHub.meta.pixel')}</FieldLabel>
            {pixelsLoading ? (
              <LoadingBlock label={t('adsHub.meta.loadingPixels')} />
            ) : (
              <div role="radiogroup" aria-labelledby={pixelGroupId} className="flex flex-col gap-2">
                {pixelsFor.error && <Notice tone="warn">{pixelsFor.error}</Notice>}
                {pixels.map((p) => (
                  <RadioCard
                    key={p.id}
                    name="meta-pixel"
                    value={p.id}
                    checked={pixelChoice === p.id}
                    onChange={setPixelChoice}
                    badge={p.id === recommendedPixelId ? <Pill tone="ok" small>{t('adsHub.common.recommended')}</Pill> : null}
                  >
                    <strong>{String(p.name || t('adsHub.meta.pixel'))}</strong> <span style={{ color: MUTED }}>{tail(p.id)}</span>
                    <br />
                    <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                      {p.lastFiredAt ? t('adsHub.common.lastActivity', { when: timeAgo(p.lastFiredAt) }) : t('adsHub.common.noActivity')}
                    </span>
                  </RadioCard>
                ))}
                <RadioCard name="meta-pixel" value={NEW_PIXEL} checked={pixelChoice === NEW_PIXEL} onChange={setPixelChoice}>
                  <strong>{t('adsHub.common.createPixel')}</strong>
                  <br />
                  <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                    {t('adsHub.common.createPixelDetail', { name: pixelName.trim() || defaultPixelName })}
                  </span>
                </RadioCard>
                {pixelChoice === NEW_PIXEL && (
                  <TextField
                    label={t('adsHub.common.pixelName')}
                    value={pixelName}
                    onChange={setPixelName}
                    placeholder={defaultPixelName}
                    maxLength={100}
                  />
                )}
              </div>
            )}
          </div>
        )}
        <SetupPanel title={t('adsHub.common.whatWeSetUp')} items={asList(t('adsHub.meta.setupItems', { returnObjects: true }))} />
        {saveError && <Notice tone="error">{saveError}</Notice>}
      </>
    );
    footer = (
      <>
        <span className="flex-1"><LockNote>{t('adsHub.common.neverPost')}</LockNote></span>
        <SecondaryButton onClick={onClose}>{t('adsHub.common.back')}</SecondaryButton>
        <PrimaryButton onClick={saveAccounts} loading={saving} disabled={!adAccountId || pixelsLoading}>
          {t('adsHub.common.continue')}
        </PrimaryButton>
      </>
    );
  } else if (step === 'leadads') {
    const pages = assets.pages;
    body = (
      <>
        <p style={{ margin: 0, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>{t('adsHub.meta.leadAdsIntro')}</p>
        {pages.length === 0 ? (
          <Notice tone="warn">{t('adsHub.meta.noPages')}</Notice>
        ) : (
          <fieldset className="flex flex-col gap-2 m-0 p-0 border-0" aria-labelledby={pagesGroupId}>
            <FieldLabel id={pagesGroupId}>{t('adsHub.meta.pages')}</FieldLabel>
            {pages.map((p) => (
              <CheckCard key={p.id} checked={selectedPages.includes(p.id)} onChange={(on) => togglePage(p.id, on)}>
                <span className="flex items-center gap-2.5">
                  <BrandLogo name="facebook" size={22} />
                  {p.hasInstagram && <BrandLogo name="instagram" size={22} />}
                  <span className="min-w-0">
                    <strong>{String(p.name || p.id)}</strong>
                    <br />
                    <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                      {p.hasInstagram ? t('adsHub.meta.pageWithInstagram') : t('adsHub.meta.pageFacebookOnly')}
                    </span>
                  </span>
                </span>
              </CheckCard>
            ))}
          </fieldset>
        )}
        {pages.length > 0 && (boards.length === 0 ? (
          <Notice tone="warn">{t('adsHub.common.noBoards')}</Notice>
        ) : (
          <SelectField
            label={t('adsHub.common.sendLeadsTo')}
            value={boardId}
            onChange={setBoardId}
            options={boards.map((b) => ({ value: b._id, label: String(b.name || '') }))}
          />
        ))}
        {failedPages.length > 0 && (
          <Notice tone="warn">{t('adsHub.meta.pagesFailed', { pages: failedPages.map(String).join(', ').slice(0, 400) })}</Notice>
        )}
        {saveError && <Notice tone="error">{saveError}</Notice>}
      </>
    );
    footer = (
      <>
        <span className="flex-1"><LockNote>{t('adsHub.meta.leadAdsNote')}</LockNote></span>
        <SecondaryButton onClick={() => setStep('test')}>{t('adsHub.common.skip')}</SecondaryButton>
        <PrimaryButton onClick={saveLeadAds} loading={saving} disabled={selectedPages.length > 0 && !boardId}>
          {t('adsHub.common.continue')}
        </PrimaryButton>
      </>
    );
  } else {
    body = (
      <>
        <p style={{ margin: 0, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>{t('adsHub.meta.testIntro')}</p>
        <div className="flex items-end gap-2 flex-wrap">
          <TextField
            label={t('adsHub.common.testEventCode')}
            value={testCode}
            onChange={setTestCode}
            placeholder="TEST12345"
            hint={t('adsHub.meta.testCodeHint')}
            maxLength={40}
            autoComplete="off"
          />
        </div>
        <div>
          <SecondaryButton onClick={runTest} loading={saving} disabled={!testCode.trim()}>
            {t('adsHub.common.sendTestEvent')}
          </SecondaryButton>
        </div>
        {testResult && <Notice tone={testResult.tone}>{testResult.text}</Notice>}
        <Notice tone="info">{t('adsHub.meta.stagesReminder')}</Notice>
      </>
    );
    footer = (
      <>
        <span className="flex-1"><LockNote>{t('adsHub.common.neverPost')}</LockNote></span>
        <PrimaryButton onClick={onClose}>{t('adsHub.common.done')}</PrimaryButton>
      </>
    );
  }

  return (
    <DialogShell
      title={t('adsHub.meta.dialogTitle')}
      subtitle={t('adsHub.meta.dialogSubtitle')}
      logo="meta"
      steps={steps}
      current={stepIndex}
      onClose={onClose}
      footer={footer}
    >
      {body}
    </DialogShell>
  );
};

export default MetaConnectDialog;
