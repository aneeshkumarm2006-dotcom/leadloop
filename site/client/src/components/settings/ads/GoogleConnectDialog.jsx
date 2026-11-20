import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import BrandLogo from './BrandLogo';
import {
  DialogShell, SignInButton, SignedInBar, SelectField, RadioCard, Switch, CopyField,
  PrimaryButton, SecondaryButton, LinkButton, Notice, LoadingBlock, Pill, FieldLabel, Tick, RichText, LINE, MUTED,
} from './AdsShared';
import { asList, formatCustomerId } from './adsHelpers';
import * as adConnect from '../../../services/adConnectService';
import useToastStore from '../../../store/toastStore';

/**
 * Connect Google Ads — one screen: pick the ad account (managers show their
 * client accounts indented; only non-manager accounts are selectable) and
 * choose what LeadLoop sets up automatically. When lead form ads are turned on
 * the server returns a webhook URL + key (shown once) to paste into Google Ads.
 */

const accountKey = (a) => `${a.customerId}|${a.loginCustomerId || ''}`;

const GoogleConnectDialog = ({ workspaceId, overview, boards, initialOptions = {}, onClose, onChanged, onStartOAuth, onOpenWebsite }) => {
  const { t } = useTranslation();
  const toast = useToastStore.getState();
  const google = overview.google;
  const signedIn = google.status !== 'none';
  const gtmAvailable = overview.availability.gtm;

  /* ---------------------------- accounts ---------------------------- */
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!signedIn) return undefined;
    let alive = true;
    adConnect
      .getGoogleAccounts(workspaceId)
      .then((d) => {
        if (!alive) return;
        const accounts = (Array.isArray(d?.accounts) ? d.accounts : [])
          .filter((a) => a && a.customerId)
          .map((a) => ({
            customerId: String(a.customerId),
            name: String(a.name || ''),
            manager: !!a.manager,
            loginCustomerId: a.loginCustomerId ? String(a.loginCustomerId) : '',
            parentId: a.parentId ? String(a.parentId) : '',
            level: Math.max(0, Math.min(4, Number(a.level) || 0)),
            currencyCode: String(a.currencyCode || ''),
            autoTagging: !!a.autoTagging,
            status: String(a.status || ''),
          }));
        setData({ email: String(d?.user?.email || ''), accounts });
      })
      .catch((err) => alive && setLoadError(adConnect.errorMessage(err, t('adsHub.google.accountsError'))));
    return () => {
      alive = false;
    };
  }, [workspaceId, signedIn, reloadKey, t]);

  const [query, setQuery] = useState('');
  const accounts = useMemo(() => data?.accounts || [], [data]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    const digits = q.replace(/\D/g, '');
    return accounts.filter((a) => a.name.toLowerCase().includes(q) || (digits && a.customerId.includes(digits)));
  }, [accounts, query]);
  const childCount = useMemo(() => {
    const m = {};
    accounts.forEach((a) => {
      if (a.parentId) m[a.parentId] = (m[a.parentId] || 0) + 1;
    });
    return m;
  }, [accounts]);

  const [selectedState, setSelected] = useState('');
  const selectable = accounts.filter((a) => !a.manager);
  const selected =
    (selectable.some((a) => accountKey(a) === selectedState) && selectedState) ||
    (selectable.find((a) => a.customerId === google.customerId.replace(/\D/g, '')) && accountKey(selectable.find((a) => a.customerId === google.customerId.replace(/\D/g, '')))) ||
    (selectable[0] ? accountKey(selectable[0]) : '');
  const account = selectable.find((a) => accountKey(a) === selected);

  /* ---------------------------- options ---------------------------- */
  const [createActions, setCreateActions] = useState(true);
  const [autoTag, setAutoTag] = useState(true);
  const [leadForms, setLeadForms] = useState(initialOptions.leadForms ?? !google.leadFormConnectionId);
  const [installGtm, setInstallGtm] = useState(!!initialOptions.gtm && gtmAvailable);
  const [boardIdState, setBoardId] = useState('');
  const boardId = boardIdState || boards[0]?._id || '';

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [leadFormResult, setLeadFormResult] = useState(null);

  const connect = async () => {
    if (!account) return;
    setSaving(true);
    setSaveError('');
    try {
      const body = {
        customerId: account.customerId,
        createConversionActions: createActions,
        enableAutoTagging: autoTag,
      };
      if (account.loginCustomerId) body.loginCustomerId = account.loginCustomerId;
      if (leadForms && boardId) body.leadForms = { enabled: true, boardId };
      const res = await adConnect.selectGoogle(workspaceId, body);
      onChanged();
      const lf = res?.leadForm;
      if (lf && typeof lf.webhookUrl === 'string' && typeof lf.key === 'string' && lf.webhookUrl && lf.key) {
        // First creation: the key is shown exactly once.
        setLeadFormResult({ webhookUrl: lf.webhookUrl, key: lf.key });
        return;
      }
      if (lf && lf.existing) {
        // Reused connection: the key can't be shown again.
        setLeadFormResult({ existing: true });
        return;
      }
      toast.success(t('adsHub.google.connected'));
      if (installGtm) onOpenWebsite('gtm');
      else onClose();
    } catch (err) {
      setSaveError(adConnect.errorMessage(err, t('adsHub.google.saveError')));
    } finally {
      setSaving(false);
    }
  };

  const groupId = useId();
  const setupItems = [
    { key: 'actions', icon: 'google-ads', title: t('adsHub.google.optActions'), detail: t('adsHub.google.optActionsDetail'), on: createActions, set: setCreateActions },
    { key: 'tagging', icon: 'google-ads', title: t('adsHub.google.optTagging'), detail: t('adsHub.google.optTaggingDetail'), on: autoTag, set: setAutoTag },
    { key: 'forms', icon: 'leadloop', title: t('adsHub.google.optLeadForms'), detail: t('adsHub.google.optLeadFormsDetail'), on: leadForms, set: setLeadForms },
  ];
  if (gtmAvailable) {
    setupItems.push({
      key: 'gtm',
      icon: 'gtm',
      title: t('adsHub.google.optGtm'),
      detail: google.gtm?.containerPublicId
        ? t('adsHub.google.optGtmDetailExisting', { container: google.gtm.containerPublicId })
        : t('adsHub.google.optGtmDetail'),
      on: installGtm,
      set: setInstallGtm,
    });
  }

  let body;
  let footer;

  if (leadFormResult?.existing) {
    body = <Notice tone="ok">{t('adsHub.google.leadFormsExisting')}</Notice>;
    footer = (
      <>
        <span className="flex-1" />
        {installGtm && <SecondaryButton onClick={() => onOpenWebsite('gtm')}>{t('adsHub.google.nextGtm')}</SecondaryButton>}
        <PrimaryButton onClick={onClose}>{t('adsHub.common.done')}</PrimaryButton>
      </>
    );
  } else if (leadFormResult) {
    body = (
      <>
        <Notice tone="ok">{t('adsHub.google.connectedLeadForms')}</Notice>
        <div className="flex flex-col gap-2">
          <FieldLabel>{t('adsHub.google.webhookUrl')}</FieldLabel>
          <CopyField value={leadFormResult.webhookUrl} label={t('adsHub.google.webhookUrl')} />
        </div>
        <div className="flex flex-col gap-2">
          <FieldLabel>{t('adsHub.google.webhookKey')}</FieldLabel>
          <CopyField value={leadFormResult.key} label={t('adsHub.google.webhookKey')} />
          <span style={{ fontSize: 12.5, color: 'var(--color-status-working)' }}>{t('adsHub.google.keyOnce')}</span>
        </div>
        <ol className="m-0 p-0 list-none flex flex-col gap-3">
          {asList(t('adsHub.google.leadFormSteps', { returnObjects: true })).map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="inline-flex items-center justify-center shrink-0 font-bold" style={{ width: 26, height: 26, borderRadius: 999, background: 'var(--color-accent-light)', color: 'var(--color-status-done)', fontSize: 13 }}>{i + 1}</span>
              <span style={{ paddingTop: 3 }}><RichText text={s} /></span>
            </li>
          ))}
        </ol>
      </>
    );
    footer = (
      <>
        <span className="flex-1" />
        {installGtm && <SecondaryButton onClick={() => onOpenWebsite('gtm')}>{t('adsHub.google.nextGtm')}</SecondaryButton>}
        <PrimaryButton onClick={onClose}>{t('adsHub.common.done')}</PrimaryButton>
      </>
    );
  } else if (!signedIn) {
    body = (
      <>
        <div>
          <div className="font-bold uppercase" style={{ fontSize: 12, letterSpacing: '.05em', color: MUTED, marginBottom: 10 }}>{t('adsHub.cards.afterSignIn')}</div>
          <ul className="m-0 p-0 list-none flex flex-col gap-[9px]" style={{ fontSize: 13.5 }}>
            {asList(t('adsHub.cards.google.benefits', { returnObjects: true })).map((b) => (
              <li key={b} className="flex gap-2.5 items-start"><Tick />{b}</li>
            ))}
          </ul>
        </div>
        <div><SignInButton platform="google" onClick={() => onStartOAuth('google')} /></div>
      </>
    );
    footer = (
      <>
        <span className="flex-1" style={{ fontSize: 12.5, color: MUTED }}>{t('adsHub.google.footerNote')}</span>
        <SecondaryButton onClick={onClose}>{t('adsHub.common.cancel')}</SecondaryButton>
      </>
    );
  } else if (!data && !loadError) {
    body = <LoadingBlock label={t('adsHub.google.loadingAccounts')} />;
  } else if (loadError) {
    body = (
      <Notice
        tone="error"
        action={<SecondaryButton size="sm" onClick={() => { setData(null); setLoadError(''); setReloadKey((k) => k + 1); }}>{t('adsHub.common.retry')}</SecondaryButton>}
      >
        {loadError}
      </Notice>
    );
    footer = (
      <>
        <span className="flex-1" />
        <LinkButton onClick={() => onStartOAuth('google')}>{t('adsHub.google.useAnother')}</LinkButton>
        <SecondaryButton onClick={onClose}>{t('adsHub.common.close')}</SecondaryButton>
      </>
    );
  } else {
    const email = data.email || google.email;
    body = (
      <>
        <SignedInBar logo="google-g" action={<LinkButton onClick={() => onStartOAuth('google')}>{t('adsHub.google.useAnother')}</LinkButton>}>
          {email ? <>{t('adsHub.google.signedInAs')} <strong>{email}</strong></> : t('adsHub.google.signedIn')}
        </SignedInBar>

        <div className="flex flex-col gap-[9px]">
          <div className="flex items-center justify-between gap-2.5 flex-wrap">
            <FieldLabel id={groupId}>{t('adsHub.google.adAccount')}</FieldLabel>
            {accounts.length > 5 && (
              <label className="flex items-center gap-2 w-full sm:w-[220px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[color:var(--color-accent)]" style={{ height: 36, padding: '0 12px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-bg-input)', color: MUTED }}>
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('adsHub.google.searchAccounts')}
                  aria-label={t('adsHub.google.searchAccounts')}
                  className="font-body"
                  style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, width: '100%', color: 'var(--color-text-primary)' }}
                />
              </label>
            )}
          </div>
          {accounts.length === 0 ? (
            <Notice tone="warn">{t('adsHub.google.noAccounts')}</Notice>
          ) : visible.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: MUTED }}>{t('adsHub.google.noMatches')}</p>
          ) : (
            <div role="radiogroup" aria-labelledby={groupId} style={{ border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden', maxHeight: 320, overflowY: 'auto' }}>
              {visible.map((a, i) => {
                const key = accountKey(a);
                const meta = a.manager
                  ? t('adsHub.google.managerMeta', { count: childCount[a.customerId] || 0 })
                  : [a.currencyCode, a.autoTagging ? t('adsHub.google.taggingOn') : t('adsHub.google.taggingOff'), a.status && a.status !== 'ENABLED' ? a.status.toLowerCase() : '']
                    .filter(Boolean)
                    .join(' · ');
                return (
                  <RadioCard
                    key={`${key}-${i}`}
                    name="google-account"
                    value={key}
                    checked={!a.manager && selected === key}
                    onChange={setSelected}
                    disabled={a.manager}
                    indent={a.level * 26}
                    flat
                    badge={!a.manager && !a.autoTagging && autoTag ? <Pill tone="warn" small>{t('adsHub.google.fixTagging')}</Pill> : null}
                  >
                    <span className="font-bold">{a.name || formatCustomerId(a.customerId)}</span>
                    <span style={{ color: MUTED, fontSize: 12.5 }}> · {formatCustomerId(a.customerId)}</span>
                    <br />
                    <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>{meta}</span>
                  </RadioCard>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-[9px]">
          <FieldLabel>{t('adsHub.google.setUpAuto')}</FieldLabel>
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden' }}>
            {setupItems.map((s, i) => (
              <div key={s.key} className="flex items-center gap-3" style={{ padding: '12px 14px', borderTop: i ? `1px solid ${LINE}` : 'none' }}>
                <BrandLogo name={s.icon} size={22} />
                <span className="flex-1 min-w-0">
                  <span className="font-bold">{s.title}</span>
                  <br />
                  <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>{s.detail}</span>
                </span>
                <Switch checked={s.on} onChange={s.set} label={s.title} />
              </div>
            ))}
          </div>
          {leadForms && (boards.length === 0 ? (
            <Notice tone="warn">{t('adsHub.common.noBoards')}</Notice>
          ) : (
            <SelectField
              label={t('adsHub.common.sendLeadsTo')}
              value={boardId}
              onChange={setBoardId}
              options={boards.map((b) => ({ value: b._id, label: String(b.name || '') }))}
            />
          ))}
          {!createActions && !google.conversionActions.qualified && <Notice tone="warn">{t('adsHub.google.actionsNeeded')}</Notice>}
        </div>
        {saveError && <Notice tone="error">{saveError}</Notice>}
      </>
    );
    footer = (
      <>
        <span className="flex-1 min-w-[180px]" style={{ fontSize: 12.5, color: MUTED }}>{t('adsHub.google.footerNote')}</span>
        <SecondaryButton onClick={onClose}>{t('adsHub.common.cancel')}</SecondaryButton>
        <PrimaryButton onClick={connect} loading={saving} disabled={!account || (leadForms && !boardId)}>
          {t('adsHub.google.connectAccount')}
        </PrimaryButton>
      </>
    );
  }

  return (
    <DialogShell
      title={t('adsHub.google.dialogTitle')}
      subtitle={t('adsHub.google.dialogSubtitle')}
      logo="google-ads"
      onClose={onClose}
      footer={footer}
    >
      {body}
    </DialogShell>
  );
};

export default GoogleConnectDialog;
