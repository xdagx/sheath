import { signal } from '@preact/signals';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { isLegacyAddress } from '@/core/address';
import { toBase64 } from '@/core/bytes';
import { checkMnemonic, normalizeMnemonic } from '@/core/keys';
import type { OwnedBlock } from '@/core/legacy/storage';
import { looksLikeXdagjWallet } from '@/core/xdagj-wallet';
import type { ImportPreview } from '@/shared/types';
import { call, isPopup, openInTab } from '../api';
import { Button, Checkbox, FileDrop, FolderPick, Identicon, Notice, Page, PasswordField, Segmented, Skeleton, Spinner, TextField, type PickedFile } from '../components';
import { fmtAmount, fmtDateTime, middle } from '../format';
import { Icon } from '../icons';
import { errorText, t, type MessageKey } from '../i18n';
import { goBack, navigate, route } from '../router';
import { applyState, describeError, network, onboardingPassword, rpc, settings, toast, wallet } from '../state';
import { lookupBalances, pickedFolder, readFolder, scanFolder, type BlockStatus } from '../storage-scan';

const MAX_WALLET_FILE = 4 * 1024 * 1024;

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
      if (tab !== 'legacy') pickedFolder.value = null;
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

  const pickFolder = async (files: File[]) => {
    setError(null);
    const folder = readFolder(files);
    if (!folder.walletDat) {
      pickedFolder.value = null;
      setError(t('folderNoWallet'));
      return;
    }
    if (folder.walletDat.size > MAX_WALLET_FILE || (folder.dnetKeyDat?.size ?? 0) > MAX_WALLET_FILE) {
      toast(t('fileTooLarge'), 'error');
      return;
    }
    const read = async (f: File): Promise<PickedFile> => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    setWdat(await read(folder.walletDat));
    setDnet(folder.dnetKeyDat ? await read(folder.dnetKeyDat) : null);
    pickedFolder.value = folder;
  };
  const folder = pickedFolder.value;

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
            <FolderPick
              label={t('legacyFolderLabel')}
              summary={folder ? t('folderSummary', { name: folder.name, n: folder.storage.length }) : null}
              onFolder={(f) => void pickFolder(f)}
              hint={t('legacyFolderHint')}
            />
            {folder && (folder.storage.length ? <Notice kind="success">{t('folderReady', { n: folder.storage.length })}</Notice> : <Notice kind="warning">{t('folderNoStorage')}</Notice>)}
            <div class="or-divider">
              <span>{t('orPickFiles')}</span>
            </div>
            <FileDrop
              label={t('walletDatLabel')}
              file={wdat}
              onFile={(f) => {
                setWdat(f);
                if (!f) pickedFolder.value = null;
              }}
              hint={t('legacyWhere')}
            />
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

interface ScanState {
  state: 'idle' | 'running' | 'done' | 'failed';
  done: number;
  total: number;
  found: OwnedBlock[];
  partial: boolean;
  error?: string;
}

export function ImportPreviewPage() {
  const preview = stagedPreview.value;
  const folder = preview?.kind === 'legacy' ? pickedFolder.value : null;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bal, setBal] = useState<Record<string, bigint | null>>({});
  const [blocks, setBlocks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanState>({ state: 'idle', done: 0, total: 0, found: [], partial: false });
  const [status, setStatus] = useState<Record<string, BlockStatus>>({});
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [stopScan, setStopScan] = useState<(() => void) | null>(null);

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

    // old client folder: find the wallet's block addresses in storage/, then their balances
    if (folder?.storage.length) {
      setScan({ state: 'running', done: 0, total: folder.storage.length, found: [], partial: false });
      let latest: OwnedBlock[] = [];
      const handle = scanFolder(
        folder,
        preview.accounts.map((a) => a.publicKey),
        (done, total, found) => {
          latest = found;
          if (alive) setScan((st) => ({ ...st, done, total, found }));
        },
      );
      setStopScan(() => handle.cancel);
      const finish = (found: OwnedBlock[], partial: boolean, failure?: string) => {
        if (!alive) return;
        setStopScan(null);
        setScan((st) => ({ ...st, state: failure ? 'failed' : 'done', done: st.total, found, partial, ...(failure ? { error: failure } : {}) }));
        void lookupBalances(
          rpc.value,
          found,
          network.value.kind,
          (address, st) => {
            if (!alive) return;
            setStatus((m) => ({ ...m, [address]: st }));
            const b = found.find((x) => x.address === address)!;
            // pre-select what is worth keeping: anything with a balance, and the wallet's own address blocks
            if ((st.state === 'ok' && (st.balance > 0n || b.kind === 'address')) || (st.state === 'error' && b.kind === 'address')) {
              setPicked((p) => new Set(p).add(address));
            }
          },
          () => alive,
        );
      };
      handle.done.then(
        (r) => finish(r.found, r.stats.budgetExhausted),
        (e: Error) => (e.message === 'cancelled' ? finish(latest, true) : finish(latest, latest.length > 0, e.message)),
      );
    }
    return () => {
      alive = false;
    };
  }, [preview?.token]);

  if (!preview) return null;

  const blockLines = blocks.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const badBlock = blockLines.find((b) => !isLegacyAddress(b));
  const ownerOf = (b: OwnedBlock) => preview.accounts[b.owner]!;
  const usable = (b: OwnedBlock) => selected.has(ownerOf(b).address) || ownerOf(b).alreadyExists;
  const ownedBlocks = scan.found.filter((b) => picked.has(b.address) && usable(b)).map((b) => ({ block: b.address, owner: ownerOf(b).address }));
  const scanning = scan.state === 'running';

  const toggleAccount = (address: string, on: boolean) => {
    const s = new Set(selected);
    if (on) s.delete(address);
    else s.add(address);
    setSelected(s);
  };
  const toggleBlock = (b: OwnedBlock) => {
    const p = new Set(picked);
    if (p.has(b.address)) p.delete(b.address);
    else {
      p.add(b.address);
      // the block can only be spent with its own key: make sure that account is added too
      if (!ownerOf(b).alreadyExists) setSelected((s) => new Set(s).add(ownerOf(b).address));
    }
    setPicked(p);
  };

  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      const st = await call('commitImport', {
        token: preview.token,
        addresses: [...selected],
        ...(onboardingPassword.value && !wallet.value?.initialized ? { newVaultPassword: onboardingPassword.value } : {}),
        legacyBlocks: blockLines,
        ownedBlocks,
      });
      onboardingPassword.value = null;
      stagedPreview.value = null;
      pickedFolder.value = null;
      applyState(st);
      navigate('/home', undefined, true);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    stopScan?.();
    void call('cancelImport', { token: preview.token });
    stagedPreview.value = null;
    goBack();
  };

  const keyLabel = (index: number) => (index === 0 ? t('defaultKey') : t('keyN', { n: index + 1 }));
  const statusText = (b: OwnedBlock) => {
    const st = status[b.address];
    if (!st || st.state === 'loading') return <Skeleton width={56} />;
    if (st.state === 'ok') return fmtAmount(st.balance, { decimals: 4, hide: settings.value.hideBalance });
    return <span class="muted small">{t(st.state === 'unknown' ? 'notOnNode' : st.state === 'otherNet' ? 'otherNetwork' : 'balanceUnavailable')}</span>;
  };

  return (
    <Page
      title={t('previewTitle')}
      onBack={cancel}
      footer={
        <Button block size="lg" disabled={(!selected.size && !ownedBlocks.length) || !!badBlock || scanning} loading={busy} onClick={commit}>
          {selected.size || !ownedBlocks.length ? t('importN', { n: selected.size }) : t('addOldN', { n: ownedBlocks.length })}
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
              <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggleAccount(a.address, on)} />
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
      {folder && folder.storage.length > 0 && (
        <section class="found-blocks">
          <div class="field-label">{t('legacyBlocksLabel')}</div>
          {scanning && (
            <div class="scan-progress">
              <Spinner size={16} />
              <span>{t('scanning', { done: scan.done, total: scan.total })}</span>
              {stopScan && (
                <Button size="sm" variant="ghost" onClick={() => stopScan()}>
                  {t('cancel')}
                </Button>
              )}
            </div>
          )}
          {scan.found.length > 0 && <p class="muted small">{t('scanFoundHint')}</p>}
          {scan.found.length > 0 && (
            <div class="list">
              {scan.found.map((b) => {
                const on = picked.has(b.address) && usable(b);
                return (
                  <label class={`select-row ${on ? 'on' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => toggleBlock(b)} />
                    <span class="legacy-icon">
                      <Icon name="layers" size={16} />
                    </span>
                    <span class="select-main">
                      <span class="mono">
                        {middle(b.address, 8, 8)}
                        {b.highS && <span class="warn-mark" title={t('highSWarn')}> ⚠</span>}
                      </span>
                      <span class="row-sub">
                        {keyLabel(ownerOf(b).index)} · {fmtDateTime(b.time)}
                        {b.kind !== 'address' && ` · ${t(`blockKind_${b.kind}` as MessageKey)}`}
                      </span>
                    </span>
                    <span class="select-bal">{statusText(b)}</span>
                  </label>
                );
              })}
            </div>
          )}
          {scan.found.some((b) => b.highS && picked.has(b.address)) && <Notice kind="warning">{t('highSWarn')}</Notice>}
          {scan.state === 'done' && !scan.found.length && <Notice kind="info">{t('scanNone')}</Notice>}
          {scan.partial && <Notice kind="warning">{t('scanPartial')}</Notice>}
          {scan.state === 'failed' && <Notice kind="danger">{t('scanFailed', { v: scan.error ?? '' })}</Notice>}
        </section>
      )}
      {preview.kind === 'legacy' && (
        <TextField
          label={folder?.storage.length ? t('legacyBlocksMore') : t('legacyBlocksLabel')}
          multiline
          rows={folder?.storage.length ? 2 : 3}
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
