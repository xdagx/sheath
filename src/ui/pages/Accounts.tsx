import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { isLegacyAddress } from '@/core/address';
import { hdPath } from '@/core/keys';
import { explorerLink } from '@/shared/networks';
import { call, openExternal } from '../api';
import { AddressLine, Button, CopyButton, Identicon, Notice, Page, PasswordField, Row, Sheet, TextField } from '../components';
import { fmtAmount, middle } from '../format';
import { Icon } from '../icons';
import { t, type MessageKey } from '../i18n';
import { navigate, route } from '../router';
import { accounts, applyState, balanceOf, describeError, network, refreshBalance, selectedAccount, settings, toast, toastError, wallet } from '../state';

/**
 * "Create account": the next account of the wallet's recovery phrase, or — for a wallet built only
 * from imported keys, which has none — a new phrase first. Returns false when it navigated away.
 */
export async function createAccount(): Promise<boolean> {
  if (!wallet.value?.hasMnemonic) {
    navigate('/create-wallet');
    return false;
  }
  applyState(await call('addHdAccount', {}));
  return true;
}

/** Asks for the wallet password, then runs `action`; errors are shown inline. */
export function PasswordSheet({
  open,
  title,
  children,
  confirmLabel,
  danger,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  children?: ComponentChildren;
  confirmLabel?: string;
  danger?: boolean;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setPw('');
      setErr(null);
    }
  }, [open]);
  const go = async () => {
    if (!pw || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(pw);
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div class="stack">
        {children}
        <PasswordField label={t('password')} value={pw} onValue={setPw} autoFocus error={err} onEnter={go} />
        <Button block variant={danger ? 'danger' : 'primary'} disabled={!pw} loading={busy} onClick={go}>
          {confirmLabel ?? t('confirm')}
        </Button>
      </div>
    </Sheet>
  );
}

export function AccountsPage() {
  const hide = settings.value.hideBalance;
  const [busy, setBusy] = useState(false);
  useEffect(() => accounts.value.forEach((a) => void refreshBalance(a.address)), []);
  return (
    <Page
      title={t('accountsTitle')}
      footer={
        <div class="button-row">
          <Button
            variant="secondary"
            icon="plus"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await createAccount();
              } catch (e) {
                toastError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('addAccount')}
          </Button>
          <Button variant="secondary" icon="download" onClick={() => navigate('/import')}>
            {t('importAccount')}
          </Button>
        </div>
      }
    >
      <div class="card list-card">
        {accounts.value.map((a) => (
          <button class="account-item" onClick={() => navigate('/account', { id: a.id })}>
            <Identicon address={a.address} size={36} />
            <span class="account-item-main">
              <span class="account-item-name">
                {a.name}
                {a.id === selectedAccount.value?.id && <span class="badge">●</span>}
              </span>
              <span class="row-sub">
                <span class="mono">{middle(a.address, 6, 6)}</span> · {t(`source_${a.source}` as MessageKey)}
              </span>
            </span>
            <span class="account-item-bal">{fmtAmount(balanceOf(a.address), { hide, decimals: 2 })}</span>
            <Icon name="chevronRight" size={16} class="row-chevron" />
          </button>
        ))}
      </div>
    </Page>
  );
}

export function AccountDetailPage() {
  const acct = accounts.value.find((a) => a.id === route.value.query.id);
  const [name, setName] = useState(acct?.name ?? '');
  const [editing, setEditing] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [blocks, setBlocks] = useState(acct?.legacyBlocks.join('\n') ?? '');
  const [savingBlocks, setSavingBlocks] = useState(false);
  if (!acct) return null;
  const link = explorerLink(network.value, acct.address);
  const blockLines = blocks.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const badBlock = blockLines.find((b) => !isLegacyAddress(b));
  const blocksChanged = blockLines.join(',') !== acct.legacyBlocks.join(',');

  return (
    <Page title={acct.name}>
      <div class="account-hero">
        <Identicon address={acct.address} size={56} />
        {editing ? (
          <div class="rename">
            <TextField value={name} onValue={setName} autoFocus maxLength={40} />
            <Button
              size="sm"
              onClick={async () => {
                try {
                  applyState(await call('renameAccount', { id: acct.id, name }));
                  setEditing(false);
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              {t('save')}
            </Button>
          </div>
        ) : (
          <button class="account-hero-name" onClick={() => setEditing(true)}>
            {acct.name} <Icon name="edit" size={15} />
          </button>
        )}
        <AddressLine address={acct.address} />
      </div>

      <div class="card list-card">
        <Row icon="wallet" title={t('type')} right={t(`source_${acct.source}` as MessageKey)} />
        {acct.hdIndex !== undefined && <Row icon="key" title={t('hdPath')} right={<span class="mono small">{hdPath(acct.hdIndex)}</span>} />}
        {link && <Row icon="globe" title={t('viewInExplorer')} onClick={() => openExternal(link)} right={<Icon name="external" size={16} />} />}
        <Row icon="key" title={t('showPrivateKey')} onClick={() => setShowKey(true)} />
      </div>

      <div class="section-head">
        <h3>{t('legacyBlocksLabel')}</h3>
      </div>
      <p class="muted small">{t('legacyBlocksEditDesc')}</p>
      <TextField
        multiline
        rows={2}
        mono
        value={blocks}
        onValue={setBlocks}
        placeholder={t('legacyBlocksPlaceholder')}
        error={badBlock ? t('invalidBlockLines', { v: badBlock }) : null}
      />
      {blocksChanged && (
        <Button
          variant="secondary"
          loading={savingBlocks}
          disabled={!!badBlock}
          onClick={async () => {
            setSavingBlocks(true);
            try {
              applyState(await call('setLegacyBlocks', { id: acct.id, blocks: blockLines }));
              toast(t('save'), 'success');
            } catch (e) {
              toastError(e);
            } finally {
              setSavingBlocks(false);
            }
          }}
        >
          {t('save')}
        </Button>
      )}

      <div class="section-head danger-head">
        <h3>{t('dangerZone')}</h3>
      </div>
      <div class="card list-card">
        <Row icon="trash" danger title={t('removeAccount')} onClick={() => (accounts.value.length > 1 ? setRemoving(true) : toast(t('cannotRemoveLast'), 'error'))} />
      </div>

      <PasswordSheet
        open={showKey && !privateKey}
        title={t('showPrivateKey')}
        onClose={() => setShowKey(false)}
        onSubmit={async (pw) => setPrivateKey((await call('exportPrivateKey', { id: acct.id, password: pw })).privateKey)}
      >
        <Notice kind="danger">{t('privateKeyWarn')}</Notice>
      </PasswordSheet>
      <Sheet open={!!privateKey} onClose={() => (setPrivateKey(null), setShowKey(false))} title={t('showPrivateKey')}>
        {privateKey && (
          <div class="stack">
            <Notice kind="danger">{t('privateKeyWarn')}</Notice>
            <div class="secret-box mono">{privateKey}</div>
            <div class="row-actions">
              <CopyButton text={privateKey} secret />
              <span class="muted small">{t('copy')}</span>
            </div>
          </div>
        )}
      </Sheet>
      <PasswordSheet
        open={removing}
        danger
        title={t('removeAccount')}
        confirmLabel={t('removeAccount')}
        onClose={() => setRemoving(false)}
        onSubmit={async (pw) => {
          applyState(await call('removeAccount', { id: acct.id, password: pw }));
          navigate('/accounts', undefined, true);
        }}
      >
        <Notice kind="warning">{t('removeWarn')}</Notice>
      </PasswordSheet>
    </Page>
  );
}
