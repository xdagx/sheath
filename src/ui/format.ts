import { formatXdag } from '@/core/amount';
import { lang, t } from './i18n';

export function fmtAmount(nano: bigint | null | undefined, opts: { hide?: boolean; decimals?: number; sign?: boolean } = {}): string {
  if (opts.hide) return '••••••';
  if (nano === null || nano === undefined) return '—';
  const s = formatXdag(nano, { maxDecimals: opts.decimals ?? 9, group: true });
  return opts.sign && nano > 0n ? `+${s}` : s;
}

export function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString(lang.value === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(lang.value === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return t('today');
  if (diff === 1) return t('yesterday');
  return d.toLocaleDateString(lang.value === 'zh' ? 'zh-CN' : 'en-US', {
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Middle-ellipsis for long identifiers. */
export function middle(s: string, head = 8, tail = 8): string {
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}
