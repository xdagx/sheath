import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { parseNodeAmount } from '@/core/amount';
import type { BlockResponse, TxLink } from '@/core/rpc';
import { explorerLink } from '@/shared/networks';
import type { Account, PendingTx } from '@/shared/types';
import { call, openExternal } from '../api';
import { AddressLine, Button, CopyButton, Empty, IconButton, Identicon, Notice, Sheet, Skeleton, Spinner } from '../components';
import { dayLabel, fmtAmount, fmtDateTime, fmtTime, middle } from '../format';
import { Icon, type IconName } from '../icons';
import { t } from '../i18n';
import { navigate } from '../router';
import {
  accounts,
  applySettings,
  applyState,
  balanceOf,
  balances,
  loadPending,
  lookupName,
  network,
  nodeError,
  pendingTxs,
  refreshBalance,
  rpc,
  selectedAccount,
  settings,
  toastError,
  wallet,
} from '../state';

interface ActivityItem {
  key: string;
  kind: 'sent' | 'received' | 'reward' | 'snapshot' | 'other';
  amount: bigint | null;
  time: number;
  remark: string;
  txAddress: string;
  pending?: PendingTx;
}

const kindMeta: Record<ActivityItem['kind'], { icon: IconName; label: () => string; cls: string }> = {
  sent: { icon: 'send', label: () => t('sentTx'), cls: 'out' },
  received: { icon: 'receive', label: () => t('receivedTx'), cls: 'in' },
  reward: { icon: 'star', label: () => t('rewardTx'), cls: 'in' },
  snapshot: { icon: 'layers', label: () => t('snapshotTx'), cls: 'in' },
  other: { icon: 'swap', label: () => t('otherTx'), cls: '' },
};

function toItem(tx: TxLink): ActivityItem {
  const kind = tx.direction === 0 ? 'sent' : tx.direction === 1 ? 'received' : tx.direction === 2 ? 'reward' : tx.remark === 'snapshot' ? 'snapshot' : 'other';
  let amount: bigint | null = null;
  try {
    amount = parseNodeAmount(tx.amount);
  } catch {
    /* keep null */
  }
  return { key: `${tx.hashlow}-${tx.direction}`, kind, amount, time: tx.time, remark: (tx.remark ?? '').trim(), txAddress: tx.address };
}

// in-memory cache so re-opening the popup paints instantly
const historyCache = new Map<string, { items: ActivityItem[]; page: number; totalPage: number }>();

function useHistory(address: string | undefined) {
  const cacheKey = `${network.value.id}:${address}`;
  const cached = address ? historyCache.get(cacheKey) : undefined;
  const [items, setItems] = useState<ActivityItem[] | null>(cached?.items ?? null);
  const [page, setPage] = useState(cached?.page ?? 1);
  const [totalPage, setTotalPage] = useState(cached?.totalPage ?? 1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (p: number) => {
      if (!address) return;
      setLoading(true);
      try {
        const res = await rpc.value.getBlock(address, p, 20);
        const list = (res?.transactions ?? []).map(toItem);
        setItems((prev) => {
          const merged = p === 1 ? list : [...(prev ?? []), ...list];
          historyCache.set(cacheKey, { items: merged, page: p, totalPage: res?.totalPage ?? 1 });
          return merged;
        });
        setPage(p);
        setTotalPage(res?.totalPage ?? 1);
        nodeError.value = null;
      } catch (e) {
        nodeError.value = (e as Error).message;
        setItems((prev) => prev ?? []);
      } finally {
        setLoading(false);
      }
    },
    [address, cacheKey],
  );

  useEffect(() => {
    const c = address ? historyCache.get(cacheKey) : undefined;
    setItems(c?.items ?? null);
    setPage(c?.page ?? 1);
    setTotalPage(c?.totalPage ?? 1);
    void load(1);
  }, [cacheKey]);

  return { items, page, totalPage, loading, reload: () => load(1), more: () => load(page + 1) };
}

export function Home() {
  const acct = selectedAccount.value;
  const hide = settings.value.hideBalance;
  const [switcher, setSwitcher] = useState(false);
  const [detail, setDetail] = useState<ActivityItem | null>(null);
  const history = useHistory(acct?.address);
  const net = network.value;

  const refreshAll = useCallback(async () => {
    if (!acct) return;
    await Promise.all([refreshBalance(acct.address), ...acct.legacyBlocks.map((b) => refreshBalance(b)), loadPending()]);
  }, [acct?.address, acct?.legacyBlocks.join(',')]);

  useEffect(() => {
    void refreshAll();
    const id = setInterval(() => {
      void refreshAll();
      if (pendingTxs.value.length) void history.reload();
    }, 20_000);
    return () => clearInterval(id);
  }, [refreshAll]);

  // pending transfers for this account; drop them once the node lists them
  const pending = useMemo(() => {
    if (!acct) return [];
    const mine = new Set([acct.address, ...acct.legacyBlocks]);
    return pendingTxs.value.filter((p) => p.networkId === net.id && (mine.has(p.from) || mine.has(p.to)));
  }, [pendingTxs.value, acct?.address, net.id]);

  useEffect(() => {
    if (!history.items || !pending.length) return;
    const seen = new Set(history.items.map((i) => i.txAddress));
    const done = pending.filter((p) => seen.has(p.blockAddress) || Date.now() - p.time > 24 * 3600_000).map((p) => p.blockAddress);
    if (done.length) call('dropPending', { blockAddresses: done }).then((l) => (pendingTxs.value = l));
  }, [history.items, pending]);

  if (!acct) return null;
  const balance = balanceOf(acct.address);

  const pendingItems: ActivityItem[] = pending.map((p) => ({
    key: `p-${p.blockAddress}`,
    kind: p.to === acct.address && p.from !== acct.address ? 'received' : 'sent',
    amount: BigInt(p.amount),
    time: p.time,
    remark: p.remark,
    txAddress: p.blockAddress,
    pending: p,
  }));
  const all = [...pendingItems, ...(history.items ?? [])];
  const groups: { label: string; items: ActivityItem[] }[] = [];
  for (const it of all) {
    const label = it.pending ? t('pending') : dayLabel(it.time);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(it);
    else groups.push({ label, items: [it] });
  }
  const explorer = explorerLink(net, acct.address);

  return (
    <div class="home">
      <header class="topbar">
        <button class="account-chip" onClick={() => setSwitcher(true)}>
          <Identicon address={acct.address} size={28} />
          <span class="account-chip-name">{acct.name}</span>
          <Icon name="chevronDown" size={16} />
        </button>
        <div class="topbar-right">
          <button class={`net-pill net-${net.kind}`} onClick={() => navigate('/settings/networks')} title={net.rpcUrl}>
            <span class="dot" />
            {net.name}
          </button>
          <IconButton icon="lock" label={t('lock')} onClick={async () => applyState(await call('lock'))} />
          <IconButton icon="sliders" label={t('settingsTitle')} onClick={() => navigate('/settings')} />
        </div>
      </header>

      <main class="home-scroll">
        <section class="balance-card">
          <div class="balance-label">
            {t('totalBalance')}
            <button
              class="icon-btn tiny"
              aria-label={hide ? t('show') : t('hide')}
              onClick={async () => applySettings(await call('updateSettings', { patch: { hideBalance: !hide } }))}
            >
              <Icon name={hide ? 'eyeOff' : 'eye'} size={15} />
            </button>
          </div>
          <div class="balance-value" key={`${acct.address}-${balance}`}>
            {balance === null ? <Skeleton width={150} height={30} /> : fmtAmount(balance, { hide, decimals: 4 })}
            <span class="unit">XDAG</span>
          </div>
          <div class="balance-address">
            <AddressLine address={acct.address} />
          </div>
          <div class="balance-actions">
            <button class="action" onClick={() => navigate('/send')}>
              <span>
                <Icon name="send" />
              </span>
              {t('send')}
            </button>
            <button class="action" onClick={() => navigate('/receive')}>
              <span>
                <Icon name="receive" />
              </span>
              {t('receive')}
            </button>
            {acct.legacyBlocks.length > 0 && (
              <button class="action" onClick={() => navigate('/legacy-send', { block: acct.legacyBlocks[0]! })}>
                <span>
                  <Icon name="swap" />
                </span>
                {t('migrate')}
              </button>
            )}
            {explorer && (
              <button class="action" onClick={() => openExternal(explorer)}>
                <span>
                  <Icon name="globe" />
                </span>
                {t('explorer')}
              </button>
            )}
          </div>
        </section>

        {wallet.value?.needsBackup && (
          <div class="banner" onClick={() => navigate('/backup')} role="button">
            <Icon name="shield" size={18} />
            <span>{t('backupBanner')}</span>
            <strong>{t('backupNow')}</strong>
          </div>
        )}
        {nodeError.value && <Notice kind="warning">{t('nodeError')}</Notice>}

        {acct.legacyBlocks.length > 0 && (
          <section class="section">
            <div class="section-head">
              <h3>{t('legacyTitle')}</h3>
            </div>
            <div class="card list-card">
              {acct.legacyBlocks.map((b) => (
                <div class="legacy-row">
                  <span class="legacy-icon">
                    <Icon name="layers" size={16} />
                  </span>
                  <span class="legacy-main">
                    <span class="mono">{middle(b, 8, 8)}</span>
                    <span class="row-sub">{balances.value[b] ? `${fmtAmount(balanceOf(b), { hide, decimals: 4 })} XDAG` : <Skeleton width={70} height={11} />}</span>
                  </span>
                  <Button size="sm" variant="secondary" disabled={!balanceOf(b)} onClick={() => navigate('/legacy-send', { block: b })}>
                    {t('moveFunds')}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section class="section">
          <div class="section-head">
            <h3>{t('activity')}</h3>
            <IconButton icon="refresh" label={t('refresh')} class={history.loading ? 'spinning' : ''} onClick={() => (void refreshAll(), void history.reload())} size={16} />
          </div>
          {history.items === null ? (
            <div class="card list-card">
              {[0, 1, 2].map(() => (
                <div class="tx-row">
                  <Skeleton width={34} height={34} />
                  <span class="tx-main">
                    <Skeleton width={90} />
                    <Skeleton width={140} height={11} />
                  </span>
                </div>
              ))}
            </div>
          ) : all.length === 0 ? (
            <Empty icon="history" title={t('noActivity')} desc={t('noActivityDesc')} />
          ) : (
            groups.map((g) => (
              <div class="tx-group">
                <div class="tx-group-label">{g.label}</div>
                <div class="card list-card">
                  {g.items.map((it) => (
                    <TxRow item={it} hide={hide} onClick={() => setDetail(it)} />
                  ))}
                </div>
              </div>
            ))
          )}
          {history.items && history.page < history.totalPage && (
            <Button block variant="ghost" loading={history.loading} onClick={history.more}>
              {t('loadMore')}
            </Button>
          )}
        </section>
      </main>

      <AccountSwitcher open={switcher} onClose={() => setSwitcher(false)} />
      <TxDetail item={detail} onClose={() => setDetail(null)} account={acct} />
    </div>
  );
}

function TxRow({ item, hide, onClick }: { item: ActivityItem; hide: boolean; onClick: () => void }) {
  const meta = kindMeta[item.kind];
  const out = item.kind === 'sent';
  return (
    <button class="tx-row" onClick={onClick}>
      <span class={`tx-icon ${meta.cls} ${item.pending ? 'pending' : ''}`}>
        {item.pending ? <Spinner size={16} /> : <Icon name={meta.icon} size={17} />}
      </span>
      <span class="tx-main">
        <span class="tx-title">{meta.label()}</span>
        <span class="row-sub">
          {fmtTime(item.time)}
          {item.remark ? ` · ${item.remark}` : ''}
        </span>
      </span>
      <span class={`tx-amount ${out ? 'out' : 'in'}`}>
        {item.amount === null ? '—' : `${out ? '−' : '+'}${fmtAmount(item.amount, { hide, decimals: 4 })}`}
      </span>
    </button>
  );
}

function TxDetail({ item, onClose, account }: { item: ActivityItem | null; onClose: () => void; account: Account }) {
  const [block, setBlock] = useState<BlockResponse | null | undefined>(undefined);
  useEffect(() => {
    setBlock(undefined);
    if (!item) return;
    rpc.value.getBlock(item.txAddress, 0).then(setBlock, () => setBlock(null));
  }, [item?.txAddress]);
  const link = item ? explorerLink(network.value, item.txAddress) : null;
  const hide = settings.value.hideBalance;
  const inputs = block?.refs?.filter((r) => r.direction === 0) ?? [];
  const outputs = block?.refs?.filter((r) => r.direction === 1) ?? [];
  const feeRef = block?.refs?.find((r) => r.direction === 2);
  return (
    <Sheet open={!!item} onClose={onClose} title={t('txDetails')}>
      {item && (
        <div class="tx-detail">
          <div class={`tx-detail-amount ${item.kind === 'sent' ? 'out' : 'in'}`}>
            {item.amount === null ? '—' : `${item.kind === 'sent' ? '−' : '+'}${fmtAmount(item.amount, { hide })}`} <small>XDAG</small>
          </div>
          <dl class="kv">
            <dt>{t('status')}</dt>
            <dd>
              {item.pending && (!block || !block.state)
                ? item.pending.uncertain
                  ? t('statusUnknown')
                  : t('pending')
                : block === undefined
                  ? <Spinner size={14} />
                  : (block?.state ?? t('notFoundYet'))}
            </dd>
            <dt>{t('time')}</dt>
            <dd>{fmtDateTime(item.time)}</dd>
            {inputs.map((r) => (
              <>
                <dt>{t('from')}</dt>
                <dd class="mono">
                  {lookupName(r.address) ?? middle(r.address, 8, 8)} <CopyButton text={r.address} />
                </dd>
              </>
            ))}
            {item.pending && !inputs.length && (
              <>
                <dt>{t('to')}</dt>
                <dd class="mono">
                  {lookupName(item.pending.to) ?? middle(item.pending.to, 8, 8)} <CopyButton text={item.pending.to} />
                </dd>
              </>
            )}
            {outputs.map((r) => (
              <>
                <dt>{t('to')}</dt>
                <dd class="mono">
                  {r.address === account.address ? account.name : (lookupName(r.address) ?? middle(r.address, 8, 8))} <CopyButton text={r.address} />
                </dd>
              </>
            ))}
            {feeRef && feeRef.amount && parseFloat(feeRef.amount) > 0 && (
              <>
                <dt>{t('fee')}</dt>
                <dd>{feeRef.amount} XDAG</dd>
              </>
            )}
            {item.pending && (
              <>
                <dt>{t('fee')}</dt>
                <dd>{fmtAmount(BigInt(item.pending.fee))} XDAG</dd>
              </>
            )}
            {item.remark && (
              <>
                <dt>{t('remark')}</dt>
                <dd>{item.remark}</dd>
              </>
            )}
            <dt>{t('blockAddress')}</dt>
            <dd class="mono">
              {middle(item.txAddress, 10, 8)} <CopyButton text={item.txAddress} />
            </dd>
          </dl>
          {link && (
            <Button block variant="secondary" icon="external" onClick={() => openExternal(link)}>
              {t('viewInExplorer')}
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}

export function AccountSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const sel = selectedAccount.value;
  const hide = settings.value.hideBalance;
  useEffect(() => {
    if (open) accounts.value.forEach((a) => void refreshBalance(a.address));
  }, [open]);
  const pick = async (id: string) => {
    try {
      applyState(await call('selectAccount', { id }));
      onClose();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('accountsTitle')}>
      <div class="account-list">
        {accounts.value.map((a) => (
          <button class={`account-item ${a.id === sel?.id ? 'selected' : ''}`} onClick={() => pick(a.id)}>
            <Identicon address={a.address} size={36} />
            <span class="account-item-main">
              <span class="account-item-name">{a.name}</span>
              <span class="row-sub mono">{middle(a.address, 6, 6)}</span>
            </span>
            <span class="account-item-bal">{fmtAmount(balanceOf(a.address), { hide, decimals: 2 })}</span>
            {a.id === sel?.id && <Icon name="check" size={18} class="account-check" />}
          </button>
        ))}
      </div>
      <div class="sheet-actions">
        {wallet.value?.hasMnemonic && (
          <Button
            variant="secondary"
            icon="plus"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                applyState(await call('addHdAccount', {}));
                onClose();
              } catch (e) {
                toastError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('addAccount')}
          </Button>
        )}
        <Button variant="secondary" icon="download" onClick={() => (onClose(), navigate('/import'))}>
          {t('importAccount')}
        </Button>
        <Button variant="ghost" icon="sliders" onClick={() => (onClose(), navigate('/accounts'))}>
          {t('manageAccounts')}
        </Button>
      </div>
    </Sheet>
  );
}
