import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DialogShell, SignInButton, SignedInBar, SelectField, TextField, RadioCard, CheckCard, SetupPanel,
  PrimaryButton, SecondaryButton, LinkButton, LockNote, Notice, LoadingBlock, FieldLabel, MUTED,
} from './AdsShared';
import { asList, tail } from './adsHelpers';
import * as adConnect from '../../../services/adConnectService';
import useToastStore from '../../../store/toastStore';

/**
 * Connect TikTok Ads — Sign in → Choose accounts (Business Center, advertiser,
 * pixel, Instant Forms on/off) → Instant Forms (board) → Test.
 */

const STEP_KEYS = ['signin', 'accounts', 'forms', 'test'];
const NEW_PIXEL = '__new__';

const TikTokConnectDialog = ({ workspaceId, overview, boards, initialStep, initialInstantForms, onClose, onChanged, onStartOAuth }) => {
  const { t } = useTranslation();
  const toast = useToastStore.getState();
  const tiktok = overview.tiktok;
  const signedIn = tiktok.status !== 'none';

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
      .getTikTokAssets(workspaceId)
      .then((d) => {
        if (!alive) return;
        setAssets({
          user: d?.user || {},
          businessCenters: (Array.isArray(d?.businessCenters) ? d.businessCenters : []).filter((b) => b && b.id),
          advertisers: (Array.isArray(d?.advertisers) ? d.advertisers : []).filter((a) => a && a.id),
        });
      })
      .catch((err) => alive && setAssetsError(adConnect.errorMessage(err, t('adsHub.tiktok.assetsError'))));
    return () => {
      alive = false;
    };
  }, [workspaceId, signedIn, assetsKey, t]);

  const [bcIdState, setBcId] = useState('');
  const businessCenters = useMemo(() => assets?.businessCenters || [], [assets]);
  const advertisers = useMemo(() => assets?.advertisers || [], [assets]);
  const bcId = bcIdState || businessCenters[0]?.id || '';
  const [advertiserIdState, setAdvertiserId] = useState('');
  const advertiserId =
    (advertisers.some((a) => String(a.id) === advertiserIdState) && advertiserIdState) ||
    (advertisers.find((a) => String(a.id) === tiktok.advertiserId) ? tiktok.advertiserId : String(advertisers[0]?.id || ''));
  const advertiser = advertisers.find((a) => String(a.id) === advertiserId);

  const [pixelsFor, setPixelsFor] = useState({ id: '', pixels: [], error: '' });
  useEffect(() => {
    if (!advertiserId) return undefined;
    let alive = true;
    adConnect
      .getTikTokPixels(workspaceId, advertiserId)
      .then((pixels) => alive && setPixelsFor({ id: advertiserId, pixels: pixels.filter((p) => p && p.code), error: '' }))
      .catch((err) => alive && setPixelsFor({ id: advertiserId, pixels: [], error: adConnect.errorMessage(err, t('adsHub.tiktok.pixelsError')) }));
    return () => {
      alive = false;
    };
  }, [workspaceId, advertiserId, t]);
  const pixelsLoading = !!advertiserId && pixelsFor.id !== advertiserId;
  const pixels = useMemo(() => (pixelsLoading ? [] : pixelsFor.pixels), [pixelsLoading, pixelsFor]);

  const [pixelChoiceState, setPixelChoice] = useState('');
  const pixelChoice =
    (pixelChoiceState === NEW_PIXEL || pixels.some((p) => p.code === pixelChoiceState)) ? pixelChoiceState
      : pixels.find((p) => p.code === tiktok.pixelCode)?.code || pixels[0]?.code || NEW_PIXEL;
  const defaultPixelName = `${advertiser?.name || t('adsHub.meta.yourBusiness')} · LeadLoop`.slice(0, 100);
  const [pixelName, setPixelName] = useState('');
  const [instantForms, setInstantForms] = useState(initialInstantForms ?? (tiktok.status === 'ready' ? tiktok.instantForms.enabled : true));
  const [boardIdState, setBoardId] = useState('');
  const boardId = boardIdState || boards[0]?._id || '';

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const save = async (withForms) => {
    setSaving(true);
    setSaveError('');
    try {
      const body = { advertiserId };
      if (bcId) body.bcId = bcId;
      if (pixelChoice === NEW_PIXEL) {
        body.createPixel = true;
        body.pixelName = (pixelName.trim() || defaultPixelName).slice(0, 100);
      } else {
        body.pixelCode = pixelChoice;
      }
      body.instantForms = withForms && boardId ? { enabled: true, boardId } : { enabled: false };
      await adConnect.selectTikTok(workspaceId, body);
      onChanged();
      toast.success(t('adsHub.tiktok.connected'));
      setStep('test');
    } catch (err) {
      setSaveError(adConnect.errorMessage(err, t('adsHub.tiktok.saveError')));
    } finally {
      setSaving(false);
    }
  };

  const onContinueAccounts = () => {
    if (!advertiserId) return;
    if (instantForms) setStep('forms');
    else save(false);
  };

  /* ------------------------------ test ------------------------------ */
  const [testCode, setTestCode] = useState('');
  const [testResult, setTestResult] = useState(null);
  const runTest = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const r = await adConnect.testTikTok(workspaceId, testCode.trim());
      if (r?.ok) {
        setTestResult({ tone: 'ok', text: t('adsHub.tiktok.testOk') });
        onChanged();
      } else {
        setTestResult({ tone: 'error', text: typeof r?.error === 'string' ? r.error.slice(0, 300) : t('adsHub.tiktok.testFail') });
      }
    } catch (err) {
      setTestResult({ tone: 'error', text: adConnect.errorMessage(err, t('adsHub.tiktok.testFail')) });
    } finally {
      setSaving(false);
    }
  };

  const pixelGroupId = useId();
  const userName = assets?.user?.name || tiktok.userName;
  const steps = [t('adsHub.steps.signIn'), t('adsHub.steps.chooseAccounts'), t('adsHub.steps.instantForms'), t('adsHub.steps.test')];
  const setupItems = asList(t('adsHub.tiktok.setupItems', { returnObjects: true }));
  const switchAccount = <LinkButton onClick={() => onStartOAuth('tiktok')}>{t('adsHub.common.switchAccount')}</LinkButton>;

  let body;
  let footer;

  if (step === 'signin') {
    body = (
      <>
        <p style={{ margin: 0, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>{t('adsHub.tiktok.signInIntro')}</p>
        <SetupPanel title={t('adsHub.common.whatWeSetUp')} items={setupItems} />
        <div><SignInButton platform="tiktok" onClick={() => onStartOAuth('tiktok')} /></div>
      </>
    );
    footer = (
      <>
        <span className="flex-1"><LockNote>{t('adsHub.common.neverPost')}</LockNote></span>
        <SecondaryButton onClick={onClose}>{t('adsHub.common.cancel')}</SecondaryButton>
      </>
    );
  } else if (step !== 'test' && !assets && !assetsError) {
    body = <LoadingBlock label={t('adsHub.tiktok.loadingAssets')} />;
  } else if (step !== 'test' && assetsError) {
    body = (
      <Notice
        tone="error"
        action={<SecondaryButton size="sm" onClick={() => { setAssets(null); setAssetsError(''); setAssetsKey((k) => k + 1); }}>{t('adsHub.common.retry')}</SecondaryButton>}
      >
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
        <SignedInBar logo="tiktok" action={switchAccount}>
          {userName ? <>{t('adsHub.tiktok.signedInAs')} <strong>{userName}</strong></> : t('adsHub.tiktok.signedIn')}
        </SignedInBar>
        {advertisers.length === 0 ? (
          <Notice tone="warn">{t('adsHub.tiktok.noAdvertisers')}</Notice>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[14px]">
            {businessCenters.length > 0 && (
              <SelectField
                label={t('adsHub.tiktok.businessCenter')}
                value={bcId}
                onChange={setBcId}
                options={businessCenters.map((b) => ({ value: String(b.id), label: String(b.name || b.id) }))}
              />
            )}
            <SelectField
              label={t('adsHub.tiktok.advertiser')}
              value={advertiserId}
              onChange={(v) => {
                setAdvertiserId(v);
                setPixelChoice('');
              }}
              options={advertisers.map((a) => ({ value: String(a.id), label: `${String(a.name || a.id)} (${tail(a.id)})` }))}
            />
          </div>
        )}
        {advertiserId && (
          <div className="flex flex-col gap-2">
            <FieldLabel id={pixelGroupId}>{t('adsHub.tiktok.pixel')}</FieldLabel>
            {pixelsLoading ? (
              <LoadingBlock label={t('adsHub.meta.loadingPixels')} />
            ) : (
              <div role="radiogroup" aria-labelledby={pixelGroupId} className="flex flex-col gap-2">
                {pixelsFor.error && <Notice tone="warn">{pixelsFor.error}</Notice>}
                {pixels.map((p) => (
                  <RadioCard key={p.code} name="tiktok-pixel" value={p.code} checked={pixelChoice === p.code} onChange={setPixelChoice}>
                    <strong>{String(p.name || p.code)}</strong> <span style={{ color: MUTED }}>{tail(p.code)}</span>
                  </RadioCard>
                ))}
                <RadioCard name="tiktok-pixel" value={NEW_PIXEL} checked={pixelChoice === NEW_PIXEL} onChange={setPixelChoice}>
                  <strong>{t('adsHub.common.createPixel')}</strong>
                  <br />
                  <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                    {t('adsHub.common.createPixelDetail', { name: pixelName.trim() || defaultPixelName })}
                  </span>
                </RadioCard>
                {pixelChoice === NEW_PIXEL && (
                  <TextField label={t('adsHub.common.pixelName')} value={pixelName} onChange={setPixelName} placeholder={defaultPixelName} maxLength={100} />
                )}
              </div>
            )}
          </div>
        )}
        <CheckCard checked={instantForms} onChange={setInstantForms}>
          <strong>{t('adsHub.tiktok.instantForms')}</strong>
          <br />
          <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>{t('adsHub.tiktok.instantFormsDetail')}</span>
        </CheckCard>
        <SetupPanel title={t('adsHub.common.whatWeSetUp')} items={setupItems} />
        {saveError && <Notice tone="error">{saveError}</Notice>}
      </>
    );
    footer = (
      <>
        <span className="flex-1"><LockNote>{t('adsHub.common.neverPost')}</LockNote></span>
        <SecondaryButton onClick={onClose}>{t('adsHub.common.back')}</SecondaryButton>
        <PrimaryButton onClick={onContinueAccounts} loading={saving} disabled={!advertiserId || pixelsLoading}>
          {t('adsHub.common.continue')}
        </PrimaryButton>
      </>
    );
  } else if (step === 'forms') {
    body = (
      <>
        <p style={{ margin: 0, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>{t('adsHub.tiktok.formsIntro')}</p>
        {boards.length === 0 ? (
          <Notice tone="warn">{t('adsHub.common.noBoards')}</Notice>
        ) : (
          <SelectField
            label={t('adsHub.common.sendLeadsTo')}
            value={boardId}
            onChange={setBoardId}
            options={boards.map((b) => ({ value: b._id, label: String(b.name || '') }))}
          />
        )}
        {saveError && <Notice tone="error">{saveError}</Notice>}
      </>
    );
    footer = (
      <>
        <span className="flex-1"><LockNote>{t('adsHub.common.neverPost')}</LockNote></span>
        <SecondaryButton onClick={() => setStep('accounts')}>{t('adsHub.common.back')}</SecondaryButton>
        <PrimaryButton onClick={() => save(true)} loading={saving} disabled={!boardId}>
          {t('adsHub.common.continue')}
        </PrimaryButton>
      </>
    );
  } else {
    body = (
      <>
        <p style={{ margin: 0, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>{t('adsHub.tiktok.testIntro')}</p>
        <TextField
          label={t('adsHub.common.testEventCode')}
          value={testCode}
          onChange={setTestCode}
          placeholder="TEST12345"
          hint={t('adsHub.tiktok.testCodeHint')}
          maxLength={40}
          autoComplete="off"
        />
        <div>
          <SecondaryButton onClick={runTest} loading={saving} disabled={!testCode.trim()}>
            {t('adsHub.common.sendTestEvent')}
          </SecondaryButton>
        </div>
        {testResult && <Notice tone={testResult.tone}>{testResult.text}</Notice>}
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
      title={t('adsHub.tiktok.dialogTitle')}
      subtitle={t('adsHub.tiktok.dialogSubtitle')}
      logo="tiktok"
      steps={steps}
      current={stepIndex}
      onClose={onClose}
      footer={footer}
    >
      {body}
    </DialogShell>
  );
};

export default TikTokConnectDialog;
