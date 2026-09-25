import { useEffect, useMemo, useState } from 'preact/hooks';
import { isLegacyAddress, isValidAddress } from '@/core/address';
import { MIN_FEE_NANO, formatXdag, tryParseXdag } from '@/core/amount';
import { isValidRemark, totalFee } from '@/core/tx';
import { explorerLink } from '@/shared/networks';
import type { SendResult } from '@/shared/types';
import { call, openExternal } from '../api';
import { Button, CopyButton, Identicon, IconButton, Notice, Page, QRCode, Sheet, Spinner, TextField, Toggle, copyText } from '../components';
import { fmtAmount, middle } from '../format';
import { Icon } from '../icons';
import { networkLabel, t } from '../i18n';
import { navigate, route } from '../router';
import { accounts, balanceOf, contacts, errorInfo, loadContacts, network, refreshBalance, rpc, selectedAccount, settings } from '../state';

function RecipientPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (a: string) => void }) {
  const me = selectedAccount.value;
  const own = accounts.value.filter((a) => a.id !== me?.id);
  return (
    <Sheet open={open} onClose={onClose} title={t('contacts')}>
      {own.length > 0 && <div class="list-label">{t('myAccounts')}</div>}
      <div class="account-list">
        {own.map((a) => (
          <button class="account-item" onClick={() => (onPick(a.address), onClose())}>
            <Identicon address={a.address} size={32} />
            <span class="account-item-main">
              <span class="account-item-name">{a.name}</span>
              <span class="row-sub mono">{middle(a.address, 8, 6)}</span>
            </span>
          </button>
        ))}
      </div>
      <div class="list-label">{t('addressBook')}</div>
      {contacts.value.length === 0 ? (
        <p class="muted small center">{t('noContacts')}</p>
      ) : (
        <div class="account-list">
          {contacts.value.map((c) => (
            <button class="account-item" onClick={() => (onPick(c.address), onClose())}>
              <Identicon address={c.address} size={32} />
              <span class="account-item-main">
                <span class="account-item-name">{c.name}</span>
                <span class="row-sub mono">{middle(c.address, 8, 6)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

type SendError = { code: string; text: string; detail: string };

export function SendResultView({ result, error, onDone, onRetry }: { result: SendResult | null; error: SendError | null; onDone: () => void; onRetry?: () => void }) {
  // the node did not give a clear answer: the transfer may still go through, so never offer a retry
  const unknown = error?.code === 'broadcast_unknown';
  const txAddress = result?.blockAddress ?? (unknown && /^[A-Za-z0-9+/]{32}$/.test(error!.detail) ? error!.detail : undefined);
  const link = txAddress ? explorerLink(network.value, txAddress) : null;
  return (
    <Page
      back={false}
      footer={
        <div class="stack-sm">
          {link && (
            <Button block variant="secondary" icon="external" onClick={() => openExternal(link)}>
              {t('viewInExplorer')}
            </Button>
          )}
          {error && !unknown && onRetry && (
            <Button block variant="secondary" onClick={onRetry}>
              {t('back')}
            </Button>
          )}
          <Button block size="lg" onClick={onDone}>
            {t('done')}
          </Button>
        </div>
      }
    >
      <div class="result">
        <div class={`result-icon ${result ? 'ok' : unknown ? 'unknown' : 'fail'}`}>
          <Icon name={result ? 'check' : unknown ? 'clock' : 'close'} size={34} />
        </div>
        <h2>{result ? t('sentSuccess') : unknown ? t('broadcastUnknownTitle') : t('sendFailed')}</h2>
        {result ? (
          <>
            <p class="muted">{t('sentDesc')}</p>
            <div class="result-amount">
              {fmtAmount(BigInt(result.pending.amount))} <small>XDAG</small>
            </div>
            <div class="result-hash">
              <span class="mono">{middle(result.blockAddress, 10, 10)}</span>
              <CopyButton text={result.blockAddress} />
            </div>
          </>
        ) : unknown ? (
          <>
            <Notice kind="warning">{t('broadcastUnknownDesc')}</Notice>
            {txAddress && (
              <div class="result-hash">
                <span class="mono">{middle(txAddress, 10, 10)}</span>
                <CopyButton text={txAddress} />
              </div>
            )}
          </>
        ) : (
          <Notice kind="danger">{error?.text}</Notice>
        )}
      </div>
    </Page>
  );
}

interface Review {
  to: string;
  amount: bigint;
  extraFee: bigint;
  remark: string;
}

export function SendPage() {
  const acct = selectedAccount.value!;
  const q = route.value.query;
  const [to, setTo] = useState(q.to ?? '');
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');
  const [feeOn, setFeeOn] = useState(false);
  const [extra, setExtra] = useState('');
  const [avgFee, setAvgFee] = useState<bigint | null>(null);
  const [picker, setPicker] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<SendError | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    void refreshBalance(acct.address);
    void loadContacts();
    rpc.value.getAverageFee().then(setAvgFee, () => setAvgFee(null));
  }, []);

  const balance = balanceOf(acct.address);
  const hide = settings.value.hideBalance;
  const toTrim = to.trim();
  const toError = !toTrim ? null : isLegacyAddress(toTrim) ? t('legacyDestination') : !isValidAddress(toTrim) ? t('invalidAddress') : null;
  const toName = useMemo(() => {
    if (!toTrim || toError) return null;
    if (toTrim === acct.address) return t('selfSend');
    const own = accounts.value.find((a) => a.address === toTrim);
    if (own) return t('ownAccount', { name: own.name });
    return contacts.value.find((c) => c.address === toTrim)?.name ?? null;
  }, [toTrim, toError, contacts.value]);

  const amt = tryParseXdag(amount);
  const extraFee = feeOn ? (tryParseXdag(extra || '0') ?? -1n) : 0n;
  const fee = extraFee >= 0n ? totalFee(extraFee) : null;
  const amountError = !amount
    ? null
    : amt === null || amt <= 0n
      ? t('invalidAmount')
      : balance !== null && amt > balance
        ? t('insufficient')
        : fee !== null && amt <= fee
          ? t('amountTooLow', { v: formatXdag(fee) })
          : null;
  const remarkError = remark && !isValidRemark(remark) ? t('invalidRemark') : null;
  const feeError = feeOn && extraFee < 0n ? t('invalidAmount') : null;
  const valid = !!toTrim && !toError && amt !== null && !amountError && !remarkError && !feeError && fee !== null;
  const receives = amt !== null && fee !== null && amt > fee ? amt - fee : null;

  const doSend = async () => {
    if (!review) return;
    setSending(true);
    try {
      const res = await call('send', {
        accountId: acct.id,
        to: review.to,
        amount: review.amount.toString(),
        fee: review.extraFee.toString(),
        remark: review.remark,
      });
      setResult(res);
      setError(null);
    } catch (e) {
      setError(errorInfo(e));
      setResult(null);
    } finally {
      setSending(false);
      setReview(null);
      void refreshBalance(acct.address);
    }
  };

  if (result || error) {
    return (
      <SendResultView
        result={result}
        error={error}
        onDone={() => navigate('/home', undefined, true)}
        onRetry={
          error
            ? () => {
                setError(null);
              }
            : undefined
        }
      />
    );
  }

  return (
    <Page
      title={t('sendTitle')}
      footer={
        <Button
          block
          size="lg"
          disabled={!valid}
          onClick={() => {
            setTouched(true);
            if (valid) setReview({ to: toTrim, amount: amt!, extraFee, remark });
          }}
        >
          {t('review')}
        </Button>
      }
    >
      <div class="from-card">
        <Identicon address={acct.address} size={30} />
        <span class="from-main">
          <span class="from-name">{acct.name}</span>
          <span class="row-sub">{t('available', { v: fmtAmount(balance, { hide }) })}</span>
        </span>
      </div>

      <TextField
        label={t('to')}
        value={to}
        onValue={setTo}
        mono
        placeholder={t('toPlaceholder')}
        autoFocus={!q.to}
        error={toError}
        hint={toName ?? undefined}
        right={<IconButton icon="users" label={t('contacts')} onClick={() => setPicker(true)} size={18} />}
      />
      <TextField
        label={t('amount')}
        value={amount}
        onValue={(v) => setAmount(v.replace(/[^\d.]/g, ''))}
        inputMode="decimal"
        placeholder="0.0"
        error={amountError}
        right={
          <span class="amount-adorn">
            <span class="muted">XDAG</span>
            <button type="button" class="max-btn" disabled={!balance} onClick={() => balance && setAmount(formatXdag(balance))}>
              {t('max')}
            </button>
          </span>
        }
      />
      <TextField label={`${t('remark')} · ${t('optional')}`} value={remark} onValue={setRemark} placeholder={t('remarkPlaceholder')} maxLength={32} error={remarkError} />

      <div class="fee-box">
        <div class="fee-line">
          <span>{t('networkFee')}</span>
          <span>{fmtAmount(MIN_FEE_NANO)} XDAG</span>
        </div>
        <div class="fee-line">
          <span>{t('priorityFee')}</span>
          <Toggle checked={feeOn} onChange={setFeeOn} label={t('priorityFee')} />
        </div>
        {feeOn && (
          <TextField
            value={extra}
            onValue={(v) => setExtra(v.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            placeholder="0.1"
            error={feeError}
            hint={t('priorityFeeDesc', { v: avgFee === null ? '0.1' : formatXdag(avgFee) })}
            right={<span class="muted">XDAG</span>}
          />
        )}
        <div class="fee-line strong">
          <span>{t('recipientGets')}</span>
          <span>{receives === null ? '—' : `${fmtAmount(receives)} XDAG`}</span>
        </div>
        <p class="muted small">{t('feeNote')}</p>
      </div>
      {touched && !valid && !toTrim && <Notice kind="warning">{t('invalidAddress')}</Notice>}

      <RecipientPicker open={picker} onClose={() => setPicker(false)} onPick={setTo} />
      <ReviewSheet
        review={review}
        fromName={acct.name}
        fromAddress={acct.address}
        sending={sending}
        onClose={() => !sending && setReview(null)}
        onConfirm={doSend}
      />
    </Page>
  );
}

function ReviewSheet({
  review,
  fromName,
  fromAddress,
  sending,
  onClose,
  onConfirm,
  legacy,
}: {
  review: Review | null;
  fromName: string;
  fromAddress: string;
  sending: boolean;
  onClose: () => void;
  onConfirm: () => void;
  legacy?: boolean;
}) {
  const fee = review ? (legacy ? MIN_FEE_NANO : totalFee(review.extraFee)) : 0n;
  const toName = review ? (accounts.value.find((a) => a.address === review.to)?.name ?? contacts.value.find((c) => c.address === review.to)?.name) : null;
  return (
    <Sheet open={!!review} onClose={onClose} title={t('review')}>
      {review && (
        <div class="review">
          <div class="review-amount">
            {fmtAmount(review.amount)} <small>XDAG</small>
          </div>
          <dl class="kv">
            <dt>{legacy ? t('legacyFrom') : t('from')}</dt>
            <dd>
              <span>{fromName}</span>
              <span class="mono muted small">{middle(fromAddress, 8, 8)}</span>
            </dd>
            <dt>{t('to')}</dt>
            <dd>
              {toName && <span>{toName}</span>}
              <span class="mono small break">{review.to}</span>
            </dd>
            <dt>{t('fee')}</dt>
            <dd>{fmtAmount(fee)} XDAG</dd>
            <dt>{t('recipientGets')}</dt>
            <dd class="strong">{fmtAmount(review.amount - fee)} XDAG</dd>
            {review.remark && (
              <>
                <dt>{t('remark')}</dt>
                <dd>{review.remark}</dd>
              </>
            )}
            <dt>{t('network')}</dt>
            <dd>{networkLabel(network.value)}</dd>
          </dl>
          <Button block size="lg" loading={sending} onClick={onConfirm}>
            {sending ? t('sending') : t('confirmSend')}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

export function LegacySendPage() {
  const acct = selectedAccount.value!;
  const [block, setBlock] = useState(route.value.query.block ?? acct.legacyBlocks[0] ?? '');
  const [to, setTo] = useState(acct.address);
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<SendError | null>(null);

  useEffect(() => {
    if (!block) return;
    refreshBalance(block).then((b) => b !== null && !amount && setAmount(formatXdag(b)));
  }, [block]);

  const balance = balanceOf(block);
  const amt = tryParseXdag(amount);
  const toError = !to.trim() ? null : isValidAddress(to.trim()) ? null : isLegacyAddress(to.trim()) ? t('legacyDestination') : t('invalidAddress');
  const amountError = !amount
    ? null
    : amt === null || amt <= 0n
      ? t('invalidAmount')
      : balance !== null && amt > balance
        ? t('insufficient')
        : amt <= MIN_FEE_NANO
          ? t('amountTooLow', { v: formatXdag(MIN_FEE_NANO) })
          : null;
  const remarkError = remark && !isValidRemark(remark) ? t('invalidRemark') : null;
  const valid = !!block && !!to.trim() && !toError && amt !== null && !amountError && !remarkError;

  if (result || error) {
    return <SendResultView result={result} error={error} onDone={() => navigate('/home', undefined, true)} onRetry={error ? () => setError(null) : undefined} />;
  }

  return (
    <Page
      title={t('legacySendTitle')}
      footer={
        <Button block size="lg" disabled={!valid} onClick={() => setReview({ to: to.trim(), amount: amt!, extraFee: 0n, remark })}>
          {t('review')}
        </Button>
      }
    >
      <div class="field">
        <div class="field-label">{t('legacyFrom')}</div>
        {acct.legacyBlocks.length > 1 ? (
          <select class="input mono" value={block} onChange={(e) => (setBlock((e.currentTarget as HTMLSelectElement).value), setAmount(''))}>
            {acct.legacyBlocks.map((b) => (
              <option value={b}>{middle(b, 10, 10)}</option>
            ))}
          </select>
        ) : (
          <div class="input mono readonly">{block}</div>
        )}
        <div class="field-hint">{balance === null ? <Spinner size={12} /> : t('available', { v: fmtAmount(balance) })}</div>
      </div>
      <TextField label={t('to')} value={to} onValue={setTo} mono error={toError} hint={to === acct.address ? t('ownAccount', { name: acct.name }) : undefined} />
      <TextField
        label={t('amount')}
        value={amount}
        onValue={(v) => setAmount(v.replace(/[^\d.]/g, ''))}
        inputMode="decimal"
        error={amountError}
        right={
          <span class="amount-adorn">
            <span class="muted">XDAG</span>
            <button type="button" class="max-btn" disabled={!balance} onClick={() => balance && setAmount(formatXdag(balance))}>
              {t('max')}
            </button>
          </span>
        }
      />
      <TextField label={`${t('remark')} · ${t('optional')}`} value={remark} onValue={setRemark} placeholder={t('remarkPlaceholder')} maxLength={32} error={remarkError} />
      <Notice kind="info">{t('legacyFeeNote')}</Notice>
      <ReviewSheet
        legacy
        review={review}
        fromName={t('legacyFrom')}
        fromAddress={block}
        sending={sending}
        onClose={() => !sending && setReview(null)}
        onConfirm={async () => {
          if (!review) return;
          setSending(true);
          try {
            setResult(
              await call('sendLegacy', { accountId: acct.id, fromBlock: block, to: review.to, amount: review.amount.toString(), remark: review.remark }),
            );
          } catch (e) {
            setError(errorInfo(e));
          } finally {
            setSending(false);
            setReview(null);
          }
        }}
      />
    </Page>
  );
}

export function ReceivePage() {
  const acct = selectedAccount.value!;
  return (
    <Page title={t('receiveTitle')}>
      <div class="receive">
        <p class="muted center">{t('receiveDesc')}</p>
        <div class="qr-card">
          <QRCode value={acct.address} size={196} />
          <div class="qr-name">
            <Identicon address={acct.address} size={22} />
            {acct.name}
          </div>
        </div>
        <div class="address-box mono">{acct.address}</div>
        <Button block icon="copy" onClick={() => copyText(acct.address)}>
          {t('copyAddress')}
        </Button>
        <Notice kind="info">{t('receiveWarn')}</Notice>
      </div>
    </Page>
  );
}
