import { useEffect, useState } from 'preact/hooks';
import { isLegacyAddress, isValidAddress } from '@/core/address';
import { fromBase64 } from '@/core/bytes';
import { XdagRpc } from '@/core/rpc';
import type { NetworkKind } from '@/core/tx';
import { allNetworks, originPattern, validateNodeUrl } from '@/shared/networks';
import type { Contact, NetworkConfig, Settings } from '@/shared/types';
import { call, openExternal } from '../api';
import { Button, CopyButton, Empty, Identicon, IconButton, Notice, Page, PasswordField, Row, Segmented, Sheet, TextField, Toggle } from '../components';
import { middle } from '../format';
import { Icon } from '../icons';
import { errorText, t } from '../i18n';
import { navigate } from '../router';
import { applySettings, applyState, clearLocalCaches, contacts, describeError, loadContacts, network, settings, toast, toastError, wallet } from '../state';
import { PasswordSheet } from './Accounts';

async function patch(p: Partial<Settings>) {
  try {
    applySettings(await call('updateSettings', { patch: p }));
  } catch (e) {
    toastError(e);
  }
}

const LOCK_OPTIONS = [1, 5, 15, 30, 60, 240, 0];

export function SettingsPage() {
  const s = settings.value;
  const [sheet, setSheet] = useState<null | 'language' | 'autolock' | 'password' | 'phrase' | 'export' | 'reset'>(null);
  const [phrase, setPhrase] = useState<string | null>(null);
  const version = chrome.runtime.getManifest().version;
  const lockLabel = (m: number) => (m === 0 ? t('autoLockNever') : m >= 60 ? t('hours', { n: m / 60 }) : t('minutes', { n: m }));
  return (
    <Page title={t('settingsTitle')}>
      <div class="section-head">
        <h3>{t('general')}</h3>
      </div>
      <div class="card list-card">
        <Row
          icon="globe"
          title={t('language')}
          onClick={() => setSheet('language')}
          right={<span class="muted">{s.language === 'auto' ? t('languageAuto') : s.language === 'zh-CN' ? '简体中文' : 'English'}</span>}
        />
        <div class="row">
          <span class="row-icon">
            <Icon name="sun" size={18} />
          </span>
          <span class="row-main">
            <span class="row-title">{t('theme')}</span>
          </span>
          <span class="row-right compact-seg">
            <Segmented
              value={s.theme}
              onChange={(v) => patch({ theme: v })}
              options={[
                { value: 'system', label: t('themeSystem') },
                { value: 'dark', label: t('themeDark') },
                { value: 'light', label: t('themeLight') },
              ]}
            />
          </span>
        </div>
        <Row icon="eyeOff" title={t('hideBalance')} right={<Toggle checked={s.hideBalance} onChange={(v) => patch({ hideBalance: v })} label={t('hideBalance')} />} />
      </div>

      <div class="section-head">
        <h3>{t('network')}</h3>
      </div>
      <div class="card list-card">
        <Row icon="link" title={t('networks')} subtitle={network.value.rpcUrl} onClick={() => navigate('/settings/networks')} right={<span class={`net-dot net-${network.value.kind}`}>{network.value.name}</span>} />
        <Row icon="users" title={t('addressBook')} onClick={() => navigate('/settings/contacts')} />
      </div>

      <div class="section-head">
        <h3>{t('security')}</h3>
      </div>
      <div class="card list-card">
        <Row icon="clock" title={t('autoLock')} onClick={() => setSheet('autolock')} right={<span class="muted">{lockLabel(s.autoLockMinutes)}</span>} />
        <Row icon="lock" title={t('changePassword')} onClick={() => setSheet('password')} />
        {wallet.value?.hasMnemonic && <Row icon="key" title={t('showPhrase')} onClick={() => setSheet('phrase')} />}
        <Row icon="download" title={t('exportXdagj')} onClick={() => setSheet('export')} />
        <Row icon="lock" title={t('lockNow')} onClick={async () => applyState(await call('lock'))} />
      </div>

      <div class="section-head">
        <h3>{t('about')}</h3>
      </div>
      <div class="card list-card">
        <Row icon="info" title={t('version')} right={<span class="muted">{version}</span>} />
        <Row icon="external" title="XDagger/xdagj" subtitle={t('sourceCode')} onClick={() => openExternal('https://github.com/XDagger/xdagj')} />
        <Row icon="external" title="XDagger/xdag" subtitle="2018 C client · wallet.dat" onClick={() => openExternal('https://github.com/XDagger/xdag')} />
        <Row icon="external" title="XDagger/XDAG-Pro" onClick={() => openExternal('https://github.com/XDagger/xdag-pro')} />
      </div>

      <div class="section-head danger-head">
        <h3>{t('dangerZone')}</h3>
      </div>
      <div class="card list-card">
        <Row icon="trash" danger title={t('resetWallet')} onClick={() => setSheet('reset')} />
      </div>

      <Sheet open={sheet === 'language'} onClose={() => setSheet(null)} title={t('language')}>
        <div class="option-list">
          {(
            [
              ['auto', t('languageAuto')],
              ['zh-CN', '简体中文'],
              ['en', 'English'],
            ] as const
          ).map(([v, label]) => (
            <button class={`option ${s.language === v ? 'active' : ''}`} onClick={() => (void patch({ language: v }), setSheet(null))}>
              {label}
              {s.language === v && <Icon name="check" size={18} />}
            </button>
          ))}
        </div>
      </Sheet>
      <Sheet open={sheet === 'autolock'} onClose={() => setSheet(null)} title={t('autoLock')}>
        <div class="option-list">
          {LOCK_OPTIONS.map((m) => (
            <button class={`option ${s.autoLockMinutes === m ? 'active' : ''}`} onClick={() => (void patch({ autoLockMinutes: m }), setSheet(null))}>
              {lockLabel(m)}
              {s.autoLockMinutes === m && <Icon name="check" size={18} />}
            </button>
          ))}
        </div>
      </Sheet>
      <ChangePasswordSheet open={sheet === 'password'} onClose={() => setSheet(null)} />
      <PasswordSheet
        open={sheet === 'phrase' && !phrase}
        title={t('showPhrase')}
        onClose={() => setSheet(null)}
        onSubmit={async (pw) => setPhrase((await call('exportMnemonic', { password: pw })).mnemonic)}
      >
        <Notice kind="danger">{t('backupWarn1')}</Notice>
      </PasswordSheet>
      <Sheet open={!!phrase} onClose={() => (setPhrase(null), setSheet(null))} title={t('backupTitle')}>
        {phrase && (
          <div class="stack">
            <div class="phrase revealed">
              <ol>
                {phrase.split(' ').map((w, i) => (
                  <li>
                    <span class="phrase-n">{i + 1}</span>
                    <span class="phrase-w">{w}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div class="row-actions">
              <CopyButton text={phrase} secret />
              <span class="muted small">{t('copyPhrase')}</span>
            </div>
            <Notice kind="warning">{t('backupWarn2')}</Notice>
          </div>
        )}
      </Sheet>
      <ExportSheet open={sheet === 'export'} onClose={() => setSheet(null)} />
      <PasswordSheet
        open={sheet === 'reset'}
        danger
        title={t('resetWallet')}
        confirmLabel={t('resetButton')}
        onClose={() => setSheet(null)}
        onSubmit={async (pw) => {
          applyState(await call('resetWallet', { password: pw }));
          clearLocalCaches();
          navigate('/welcome', undefined, true);
        }}
      >
        <Notice kind="danger">{t('resetDesc')}</Notice>
      </PasswordSheet>
    </Page>
  );
}

function ChangePasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [oldPw, setOldPw] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) [setOldPw, setPw, setPw2].forEach((f) => f(''));
    setErr(null);
  }, [open]);
  const ok = oldPw && pw.length >= 8 && pw === pw2;
  return (
    <Sheet open={open} onClose={onClose} title={t('changePassword')}>
      <div class="stack">
        <PasswordField label={t('currentPassword')} value={oldPw} onValue={setOldPw} autoFocus />
        <PasswordField label={t('newPassword')} value={pw} onValue={setPw} error={pw && pw.length < 8 ? t('passwordTooShort') : null} />
        <PasswordField label={t('confirmPassword')} value={pw2} onValue={setPw2} error={pw2 && pw !== pw2 ? t('passwordMismatch') : null} />
        {err && <Notice kind="danger">{err}</Notice>}
        <Button
          block
          disabled={!ok}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await call('changePassword', { oldPassword: oldPw, newPassword: pw });
              toast(t('passwordChanged'), 'success');
              onClose();
            } catch (e) {
              setErr(describeError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('save')}
        </Button>
      </div>
    </Sheet>
  );
}

function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function ExportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [filePw, setFilePw] = useState('');
  const [filePw2, setFilePw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) [setPw, setFilePw, setFilePw2].forEach((f) => f(''));
    setErr(null);
  }, [open]);
  const ok = pw && filePw.length >= 8 && filePw === filePw2;
  return (
    <Sheet open={open} onClose={onClose} title={t('exportXdagj')}>
      <div class="stack">
        <p class="muted small">{t('exportXdagjDesc')}</p>
        <PasswordField label={t('currentPassword')} value={pw} onValue={setPw} autoFocus />
        <PasswordField label={t('exportFilePassword')} value={filePw} onValue={setFilePw} error={filePw && filePw.length < 8 ? t('passwordTooShort') : null} />
        <PasswordField label={t('confirmPassword')} value={filePw2} onValue={setFilePw2} error={filePw2 && filePw !== filePw2 ? t('passwordMismatch') : null} />
        {err && <Notice kind="danger">{err}</Notice>}
        <Button
          block
          icon="download"
          disabled={!ok}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const res = await call('exportXdagjWallet', { password: pw, filePassword: filePw });
              download('wallet.data', fromBase64(res.file));
              toast(t('exportDone', { n: res.count }), 'success');
              onClose();
            } catch (e) {
              setErr(describeError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('exportXdagj')}
        </Button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- networks

/** Must run inside a click handler: resolves immediately when access was already granted. */
async function ensurePermission(url: string): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: [originPattern(url)] });
  } catch {
    return false;
  }
}

export function NetworksPage() {
  const s = settings.value;
  const [editing, setEditing] = useState<NetworkConfig | null>(null);
  const select = async (n: NetworkConfig) => {
    // request host access synchronously within the click for custom nodes
    const granted = n.builtin || (await ensurePermission(n.rpcUrl));
    if (!granted) return toast(t('permissionDenied'), 'error');
    await patch({ networkId: n.id });
  };
  return (
    <Page
      title={t('networks')}
      footer={
        <Button block variant="secondary" icon="plus" onClick={() => setEditing({ id: '', name: '', kind: 'mainnet', rpcUrl: 'https://', explorerUrl: '', builtin: false })}>
          {t('addNetwork')}
        </Button>
      }
    >
      <div class="card list-card">
        {allNetworks(s).map((n) => (
          <div class={`net-row ${s.networkId === n.id ? 'active' : ''}`}>
            <button class="net-row-main" onClick={() => select(n)}>
              <span class={`radio ${s.networkId === n.id ? 'on' : ''}`} />
              <span class="row-main">
                <span class="row-title">
                  {n.name} <span class={`kind kind-${n.kind}`}>{n.kind}</span>
                  {n.builtin && <span class="badge-soft">{t('builtin')}</span>}
                </span>
                <span class="row-sub mono">{n.rpcUrl}</span>
              </span>
            </button>
            {!n.builtin && <IconButton icon="edit" label={t('edit')} onClick={() => setEditing(n)} size={16} />}
          </div>
        ))}
      </div>
      <NetworkEditor value={editing} onClose={() => setEditing(null)} />
    </Page>
  );
}

function NetworkEditor({ value, onClose }: { value: NetworkConfig | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [rpcUrl, setRpcUrl] = useState('');
  const [explorerUrl, setExplorerUrl] = useState('');
  const [kind, setKind] = useState<NetworkKind>('mainnet');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!value) return;
    setName(value.name);
    setRpcUrl(value.rpcUrl);
    setExplorerUrl(value.explorerUrl);
    setKind(value.kind);
    setStatus(null);
  }, [value]);
  const urlErr = rpcUrl && rpcUrl !== 'https://' ? validateNodeUrl(rpcUrl) : null;
  const expErr = explorerUrl ? validateNodeUrl(explorerUrl) : null;

  const test = async () => {
    setStatus(null);
    const granted = await ensurePermission(rpcUrl);
    if (!granted) return setStatus({ ok: false, text: t('permissionDenied') });
    setBusy(true);
    try {
      const r = new XdagRpc(rpcUrl, 10_000);
      const [net, h] = await Promise.all([r.netType(), r.blockNumber()]);
      if (net !== kind) setKind(net as NetworkKind);
      setStatus({ ok: true, text: t('connectionOk', { net, h }) });
    } catch (e) {
      setStatus({ ok: false, text: t('connectionFail', { msg: (e as Error).message }) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!value} onClose={onClose} title={value?.id ? t('edit') : t('addNetwork')}>
      {value && (
        <div class="stack">
          <TextField label={t('networkName')} value={name} onValue={setName} maxLength={32} autoFocus />
          <TextField label={t('rpcUrl')} value={rpcUrl} onValue={setRpcUrl} mono error={urlErr ? errorText(`node_url_${urlErr}`) : null} />
          <TextField label={`${t('explorerUrl')} · ${t('optional')}`} value={explorerUrl} onValue={setExplorerUrl} mono error={expErr ? errorText('explorer_url_invalid') : null} />
          <div class="field">
            <div class="field-label">{t('networkKind')}</div>
            <Segmented<NetworkKind>
              value={kind}
              onChange={setKind}
              options={[
                { value: 'mainnet', label: 'Mainnet' },
                { value: 'testnet', label: 'Testnet' },
                { value: 'devnet', label: 'Devnet' },
              ]}
            />
          </div>
          {status && <Notice kind={status.ok ? 'success' : 'danger'}>{status.text}</Notice>}
          <div class="button-row">
            <Button variant="secondary" loading={busy} disabled={!!urlErr || rpcUrl === 'https://'} onClick={test}>
              {t('testConnection')}
            </Button>
            <Button
              disabled={!!urlErr || !!expErr || !name.trim() || rpcUrl === 'https://'}
              onClick={async () => {
                if (!(await ensurePermission(rpcUrl))) return toast(t('permissionDenied'), 'error');
                try {
                  applySettings(await call('upsertNetwork', { network: { ...value, name, rpcUrl, explorerUrl, kind } }));
                  onClose();
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              {t('save')}
            </Button>
          </div>
          {value.id && (
            <Button
              variant="ghost"
              class="danger-text"
              icon="trash"
              onClick={async () => {
                applySettings(await call('removeNetwork', { id: value.id }));
                onClose();
              }}
            >
              {t('delete')}
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- contacts

export function ContactsPage() {
  const [editing, setEditing] = useState<Contact | null>(null);
  useEffect(() => void loadContacts(), []);
  return (
    <Page
      title={t('contactsTitle')}
      footer={
        <Button block variant="secondary" icon="plus" onClick={() => setEditing({ id: '', name: '', address: '' })}>
          {t('addContact')}
        </Button>
      }
    >
      {contacts.value.length === 0 ? (
        <Empty icon="users" title={t('noContacts')} />
      ) : (
        <div class="card list-card">
          {contacts.value.map((c) => (
            <button class="account-item" onClick={() => setEditing(c)}>
              <Identicon address={c.address} size={34} />
              <span class="account-item-main">
                <span class="account-item-name">{c.name}</span>
                <span class="row-sub mono">{middle(c.address, 8, 8)}</span>
              </span>
              <IconButton icon="send" label={t('send')} size={16} onClick={(e) => (e.stopPropagation(), navigate('/send', { to: c.address }))} />
            </button>
          ))}
        </div>
      )}
      <ContactEditor value={editing} onClose={() => setEditing(null)} />
    </Page>
  );
}

function ContactEditor({ value, onClose }: { value: Contact | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!value) return;
    setName(value.name);
    setAddress(value.address);
    setNote(value.note ?? '');
  }, [value]);
  const addrErr = address && !isValidAddress(address.trim()) ? (isLegacyAddress(address.trim()) ? t('legacyDestination') : t('invalidAddress')) : null;
  return (
    <Sheet open={!!value} onClose={onClose} title={value?.id ? t('editContact') : t('addContact')}>
      {value && (
        <div class="stack">
          <TextField label={t('contactName')} value={name} onValue={setName} maxLength={40} autoFocus />
          <TextField label={t('address')} value={address} onValue={setAddress} mono error={addrErr} />
          <TextField label={`${t('contactNote')} · ${t('optional')}`} value={note} onValue={setNote} maxLength={100} />
          <Button
            block
            disabled={!name.trim() || !address || !!addrErr}
            onClick={async () => {
              try {
                contacts.value = await call('saveContact', { contact: { id: value.id, name, address: address.trim(), note } });
                onClose();
              } catch (e) {
                toastError(e);
              }
            }}
          >
            {t('save')}
          </Button>
          {value.id && (
            <Button
              variant="ghost"
              class="danger-text"
              icon="trash"
              onClick={async () => {
                contacts.value = await call('deleteContact', { id: value.id });
                onClose();
              }}
            >
              {t('delete')}
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}

