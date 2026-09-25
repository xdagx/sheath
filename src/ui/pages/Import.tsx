import { signal } from '@preact/signals';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { isLegacyAddress } from '@/core/address';
import { toBase64 } from '@/core/bytes';
import { checkMnemonic, normalizeMnemonic } from '@/core/keys';
import { looksLikeXdagjWallet } from '@/core/xdagj-wallet';
import type { ImportPreview } from '@/shared/types';
import { call, isPopup, openInTab } from '../api';
import { Button, Checkbox, FileDrop, Identicon, Notice, Page, PasswordField, Segmented, Skeleton, TextField, type PickedFile } from '../components';
import { fmtAmount, middle } from '../format';
import { Icon } from '../icons';
import { errorText, t } from '../i18n';
import { goBack, navigate, route } from '../router';
import { applyState, describeError, onboardingPassword, rpc, settings, wallet } from '../state';

type Tab = 'mnemonic' | 'privateKey' | 'xdagj' | 'legacy';

export const stagedPreview = signal<ImportPreview | null>(null);

export function ImportPage() {
  const q = route.value.query;
  const onboarding = q.onboarding === '1';
  const [tab, setTab] = useState<Tab>((['mnemonic', 'privateKey', 'xdagj', 'legacy'].includes(q.tab ?? '') ? q.tab : 'mnemonic') as Tab);
  const [mnemonic, setMnemonic] = useState('');
  const [allowBad, setAllowBad] = useState(false);
  const [pk, setPk] = useState('');
  const [xfile, setXfile] = useState<PickedFile | null>(null);
  const [wdat, setWdat] = useState<PickedFile | null>(null);
  const [dnet, setDnet] = useState<PickedFile | null>(null);
  const [filePw, setFilePw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (onboarding && !onboardingPassword.value && !wallet.value?.initialized) navigate('/onboard/password', { flow: 'import' }, true);
  }, []);

  const words = normalizeMnemonic(mnemonic).split(' ').filter(Boolean);
  const mCheck = useMemo(() => (words.length >= 12 ? checkMnemonic(mnemonic) : null), [mnemonic]);
  const needsFullPage = isPopup() && (tab === 'xdagj' || tab === 'legacy');

  const xfileWarning = xfile && !looksLikeXdagjWallet(xfile.bytes) ? (xfile.bytes.length % 32 === 0 ? t('looksLikeLegacy') : t('notXdagjFile')) : null;

  const canSubmit =
    !busy &&
    (tab === 'mnemonic'
      ? mCheck?.status === 'ok' || (mCheck?.status === 'checksum' && allowBad)
      : tab === 'privateKey'
        ? /^(0x)?[0-9a-fA-F]{64}$/.test(pk.trim())
        : tab === 'xdagj'
          ? !!xfile
          : !!wdat);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const file = (f: PickedFile) => ({ name: f.name, data: toBase64(f.bytes) });
      const preview =
        tab === 'mnemonic'
          ? await call('previewImport', { kind: 'mnemonic', mnemonic, count: 5, allowBadChecksum: allowBad })
          : tab === 'privateKey'
            ? await call('previewImport', { kind: 'privateKey', privateKey: pk.trim() })
            : tab === 'xdagj'
              ? await call('previewImport', { kind: 'xdagj', file: file(xfile!), filePassword: filePw })
              : await call('previewImport', { kind: 'legacy', walletDat: file(wdat!), dnetKeyDat: dnet ? file(dnet) : null, filePassword: filePw });
      stagedPreview.value = preview;
      setPk('');
      setMnemonic('');
      navigate('/import/preview', onboarding ? { onboarding: '1' } : undefined);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const mnemonicError =
    mCheck && mCheck.status !== 'ok' ? errorText(`mnemonic_${mCheck.status}`, mCheck.badWord) : null;

  return (
    <Page
      title={t('importTitle')}
      footer={
        needsFullPage ? (
          <Button block size="lg" icon="external" onClick={() => openInTab(`#/import?tab=${tab}${onboarding ? '&onboarding=1' : ''}`)}>
            {t('openFullPage')}
          </Button>
        ) : (
          <Button block size="lg" disabled={!canSubmit} loading={busy} onClick={submit}>
            {busy && (tab === 'legacy' || tab === 'xdagj') ? t('decrypting') : t('continue')}
          </Button>
        )
      }
    >
      <Segmented<Tab>
        value={tab}
        onChange={(v) => {
          setTab(v);
          setError(null);
        }}
        options={[
          { value: 'mnemonic', label: t('tabMnemonic') },
          { value: 'privateKey', label: t('tabPrivateKey') },
          { value: 'xdagj', label: t('tabXdagj') },
          { value: 'legacy', label: t('tabLegacy') },
        ]}
      />
      <div class="tab-panel" key={tab}>
        {tab === 'mnemonic' && (
          <>
            <TextField
              label={t('mnemonicLabel')}
              multiline
              rows={4}
              mono
              value={mnemonic}
              onValue={setMnemonic}
              placeholder={t('mnemonicPlaceholder')}
              autoFocus
              error={mnemonicError}
              hint={t('wordsCount', { n: words.length })}
            />
            {mCheck?.status === 'checksum' && (
              <Checkbox checked={allowBad} onChange={setAllowBad}>
                {t('allowBadChecksum')}
              </Checkbox>
            )}
          </>
        )}
        {tab === 'privateKey' && (
          <PasswordField label={t('privateKeyLabel')} value={pk} onValue={setPk} placeholder={t('privateKeyPlaceholder')} autoFocus onEnter={submit} />
        )}
        {tab === 'xdagj' && !needsFullPage && (
          <>
            <p class="muted small">{t('xdagjDesc')}</p>
            <FileDrop label={t('xdagjFileLabel')} file={xfile} onFile={setXfile} />
            {xfileWarning && <Notice kind="warning">{xfileWarning}</Notice>}
            <PasswordField label={t('filePassword')} value={filePw} onValue={setFilePw} onEnter={submit} />
          </>
        )}
        {tab === 'legacy' && !needsFullPage && (
          <>
            <p class="muted small">{t('legacyDesc')}</p>
            <FileDrop label={t('walletDatLabel')} file={wdat} onFile={setWdat} hint={t('legacyWhere')} />
            <FileDrop label={t('dnetKeyLabel')} file={dnet} onFile={setDnet} hint={t('dnetKeyRecommended')} />
            <PasswordField label={t('filePassword')} value={filePw} onValue={setFilePw} hint={t('filePasswordLegacyHint')} onEnter={submit} />
          </>
        )}
        {needsFullPage && (
          <div class="fullpage-hint">
            <Icon name="file" size={28} />
            <p>{tab === 'xdagj' ? t('xdagjDesc') : t('legacyDesc')}</p>
          </div>
        )}
        {error && <Notice kind="danger">{error}</Notice>}
      </div>
    </Page>
  );
}

export function ImportPreviewPage() {
  const preview = stagedPreview.value;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bal, setBal] = useState<Record<string, bigint | null>>({});
  const [blocks, setBlocks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!preview) {
      navigate(wallet.value?.unlocked ? '/home' : '/welcome', undefined, true);
      return;
    }
    const fresh = preview.accounts.filter((a) => !a.alreadyExists);
    setSelected(new Set(preview.kind === 'mnemonic' ? fresh.filter((a) => a.hdIndex === 0).map((a) => a.address) : fresh.map((a) => a.address)));
    let alive = true;
    for (const a of preview.accounts) {
      rpc.value.getBalance(a.address).then(
        (v) => {
          if (!alive) return;
          setBal((b) => ({ ...b, [a.address]: v }));
          if (preview.kind === 'mnemonic' && v > 0n && !a.alreadyExists) setSelected((s) => new Set(s).add(a.address));
        },
        () => alive && setBal((b) => ({ ...b, [a.address]: null })),
      );
    }
    return () => {
      alive = false;
    };
  }, [preview?.token]);

  if (!preview) return null;

  const blockLines = blocks.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const badBlock = blockLines.find((b) => !isLegacyAddress(b));

  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      const st = await call('commitImport', {
        token: preview.token,
        addresses: [...selected],
        ...(onboardingPassword.value && !wallet.value?.initialized ? { newVaultPassword: onboardingPassword.value } : {}),
        legacyBlocks: blockLines,
      });
      onboardingPassword.value = null;
      stagedPreview.value = null;
      applyState(st);
      navigate('/home', undefined, true);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    void call('cancelImport', { token: preview.token });
    stagedPreview.value = null;
    goBack();
  };

  return (
    <Page
      title={t('previewTitle')}
      onBack={cancel}
      footer={
        <Button block size="lg" disabled={!selected.size || !!badBlock} loading={busy} onClick={commit}>
          {t('importN', { n: selected.size })}
        </Button>
      }
    >
      <p class="lead">{t('previewDesc')}</p>
      {preview.kind === 'legacy' && !preview.passwordVerified && <Notice kind="warning">{t('noPasswordCheck')}</Notice>}
      {preview.kind === 'legacy' && !preview.encrypted && <Notice kind="info">{t('unencryptedNotice')}</Notice>}
      <div class="list">
        {preview.accounts.map((a) => {
          const disabled = a.alreadyExists;
          const on = selected.has(a.address);
          return (
            <label class={`select-row ${disabled ? 'disabled' : ''} ${on ? 'on' : ''}`}>
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={() => {
                  const s = new Set(selected);
                  if (on) s.delete(a.address);
                  else s.add(a.address);
                  setSelected(s);
                }}
              />
              <Identicon address={a.address} size={34} />
              <span class="select-main">
                <span class="mono">{middle(a.address, 9, 8)}</span>
                <span class="row-sub">
                  {a.hdIndex !== undefined
                    ? t('hdIndex', { n: a.hdIndex })
                    : preview.kind === 'legacy' && a.index === 0
                      ? t('defaultKey')
                      : `#${a.index + 1}`}
                  {disabled && ` · ${t('alreadyAdded')}`}
                </span>
              </span>
              <span class="select-bal">
                {a.address in bal ? `${fmtAmount(bal[a.address], { decimals: 4, hide: settings.value.hideBalance })}` : <Skeleton width={56} />}
              </span>
            </label>
          );
        })}
      </div>
      {preview.kind === 'legacy' && (
        <TextField
          label={t('legacyBlocksLabel')}
          multiline
          rows={3}
          mono
          value={blocks}
          onValue={setBlocks}
          placeholder={t('legacyBlocksPlaceholder')}
          hint={t('legacyBlocksHint')}
          error={badBlock ? t('invalidBlockLines', { v: badBlock }) : null}
        />
      )}
      {error && <Notice kind="danger">{error}</Notice>}
    </Page>
  );
}
