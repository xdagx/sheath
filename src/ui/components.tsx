import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import qrcode from 'qrcode-generator';
import { sha256 } from '@noble/hashes/sha2.js';
import { Icon, type IconName } from './icons';
import { t } from './i18n';
import { goBack } from './router';
import { toast, toasts } from './state';
import { middle } from './format';

// ---------------------------------------------------------------- buttons

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'primary',
  loading,
  block,
  icon,
  size = 'md',
  children,
  class: cls,
  disabled,
  ...rest
}: {
  variant?: ButtonVariant;
  loading?: boolean;
  block?: boolean;
  icon?: IconName;
  size?: 'sm' | 'md' | 'lg';
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'icon' | 'size'> & { disabled?: boolean; type?: 'button' | 'submit' }) {
  return (
    <button
      type="button"
      class={`btn btn-${variant} btn-${size} ${block ? 'btn-block' : ''} ${loading ? 'is-loading' : ''} ${cls ?? ''}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : icon ? <Icon name={icon} size={18} /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ icon, label, onClick, class: cls, size = 20 }: { icon: IconName; label: string; onClick?: (e: MouseEvent) => void; class?: string; size?: number }) {
  return (
    <button type="button" class={`icon-btn ${cls ?? ''}`} aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return <span class="spinner" style={{ width: `${size}px`, height: `${size}px` }} role="status" aria-label={t('loading')} />;
}

// ---------------------------------------------------------------- inputs

interface FieldProps {
  label?: ComponentChildren;
  hint?: ComponentChildren;
  error?: string | null;
  right?: ComponentChildren;
  mono?: boolean;
  multiline?: boolean;
  rows?: number;
}

export function TextField({
  label,
  hint,
  error,
  right,
  mono,
  multiline,
  rows = 3,
  value,
  onValue,
  ...rest
}: FieldProps & { value: string; onValue: (v: string) => void } & Omit<JSX.HTMLAttributes<HTMLInputElement>, 'label' | 'value'> & {
    type?: string;
    placeholder?: string;
    autoFocus?: boolean;
    inputMode?: string;
    maxLength?: number;
    autocomplete?: string;
  }) {
  const id = useMemo(() => `f${Math.random().toString(36).slice(2, 9)}`, []);
  const common = {
    id,
    value,
    class: `input ${mono ? 'mono' : ''} ${error ? 'has-error' : ''}`,
    spellcheck: false,
    autocomplete: 'off',
    'aria-invalid': !!error,
    onInput: (e: Event) => onValue((e.currentTarget as HTMLInputElement).value),
  };
  return (
    <div class="field">
      {label && <label for={id} class="field-label">{label}</label>}
      <div class="field-control">
        {multiline ? <textarea rows={rows} {...(common as object)} {...(rest as object)} /> : <input {...common} {...rest} />}
        {right && <div class="field-right">{right}</div>}
      </div>
      {error ? <div class="field-error">{error}</div> : hint ? <div class="field-hint">{hint}</div> : null}
    </div>
  );
}

export function PasswordField(props: FieldProps & { value: string; onValue: (v: string) => void; placeholder?: string; autoFocus?: boolean; onEnter?: () => void }) {
  const [shown, setShown] = useState(false);
  const { onEnter, ...rest } = props;
  return (
    <TextField
      {...rest}
      type={shown ? 'text' : 'password'}
      autocomplete="current-password"
      onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && onEnter?.()}
      right={<IconButton icon={shown ? 'eyeOff' : 'eye'} label={shown ? t('hide') : t('show')} onClick={() => setShown(!shown)} size={18} />}
    />
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div class="segmented" role="tablist" style={{ '--n': options.length, '--i': idx } as JSX.CSSProperties}>
      <span class="segmented-thumb" />
      {options.map((o) => (
        <button type="button" role="tab" aria-selected={o.value === value} class={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} class={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ComponentChildren }) {
  return (
    <label class="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)} />
      <span class="checkbox-box">
        <Icon name="check" size={14} />
      </span>
      <span class="checkbox-label">{children}</span>
    </label>
  );
}

// ---------------------------------------------------------------- layout

export function Page({
  title,
  back = true,
  onBack,
  actions,
  footer,
  children,
  class: cls,
}: {
  title?: ComponentChildren;
  back?: boolean;
  onBack?: () => void;
  actions?: ComponentChildren;
  footer?: ComponentChildren;
  children: ComponentChildren;
  class?: string;
}) {
  return (
    <div class={`page ${cls ?? ''}`}>
      {(title || back || actions) && (
        <header class="page-header">
          <div class="page-header-side">{back && <IconButton icon="back" label={t('back')} onClick={() => (onBack ? onBack() : goBack())} />}</div>
          <h1 class="page-title">{title}</h1>
          <div class="page-header-side right">{actions}</div>
        </header>
      )}
      <main class="page-body">{children}</main>
      {footer && <footer class="page-footer">{footer}</footer>}
    </div>
  );
}

export function Card({ children, class: cls, onClick }: { children: ComponentChildren; class?: string; onClick?: () => void }) {
  return (
    <div class={`card ${onClick ? 'clickable' : ''} ${cls ?? ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      {children}
    </div>
  );
}

export function Row({ icon, title, subtitle, right, onClick, danger }: { icon?: IconName; title: ComponentChildren; subtitle?: ComponentChildren; right?: ComponentChildren; onClick?: () => void; danger?: boolean }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} class={`row ${onClick ? 'clickable' : ''} ${danger ? 'danger' : ''}`} onClick={onClick}>
      {icon && (
        <span class="row-icon">
          <Icon name={icon} size={18} />
        </span>
      )}
      <span class="row-main">
        <span class="row-title">{title}</span>
        {subtitle && <span class="row-sub">{subtitle}</span>}
      </span>
      {right !== undefined ? <span class="row-right">{right}</span> : onClick ? <Icon name="chevronRight" size={16} class="row-chevron" /> : null}
    </Tag>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warning' | 'danger' | 'success'; children: ComponentChildren }) {
  return (
    <div class={`notice notice-${kind}`} role={kind === 'danger' ? 'alert' : 'note'}>
      <Icon name={kind === 'success' ? 'check' : kind === 'info' ? 'info' : 'alert'} size={16} />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ icon, title, desc }: { icon: IconName; title: string; desc?: string }) {
  return (
    <div class="empty">
      <span class="empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <div class="empty-title">{title}</div>
      {desc && <div class="empty-desc">{desc}</div>}
    </div>
  );
}

export function Skeleton({ width = '100%', height = 14 }: { width?: string | number; height?: number }) {
  return <span class="skeleton" style={{ width: typeof width === 'number' ? `${width}px` : width, height: `${height}px` }} />;
}

// ---------------------------------------------------------------- sheet / dialog

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ComponentChildren; children: ComponentChildren }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    } else {
      setVisible(false);
      const id = setTimeout(() => setMounted(false), 220);
      return () => clearTimeout(id);
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!mounted) return null;
  return (
    <div class={`sheet-root ${visible ? 'visible' : ''}`}>
      <div class="sheet-backdrop" onClick={onClose} />
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="sheet-handle" />
        {title && (
          <div class="sheet-header">
            <h2>{title}</h2>
            <IconButton icon="close" label={t('close')} onClick={onClose} />
          </div>
        )}
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Toasts() {
  return (
    <div class="toasts" aria-live="polite">
      {toasts.value.map((x) => (
        <div key={x.id} class={`toast toast-${x.kind}`}>
          <Icon name={x.kind === 'error' ? 'alert' : x.kind === 'success' ? 'check' : 'info'} size={16} />
          <span>{x.text}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- identity & data

export function Identicon({ address, size = 32 }: { address: string; size?: number }) {
  const style = useMemo(() => {
    const h = sha256(new TextEncoder().encode(address));
    const h1 = (h[0]! * 360) / 256, h2 = (h1 + 60 + (h[1]! * 120) / 256) % 360, a = (h[2]! * 360) / 256;
    const x = 20 + (h[3]! % 60), y = 20 + (h[4]! % 60);
    return {
      width: `${size}px`,
      height: `${size}px`,
      background: `radial-gradient(circle at ${x}% ${y}%, hsla(${(h1 + 180) % 360},90%,75%,.85) 0 18%, transparent 19%), linear-gradient(${a}deg, hsl(${h1} 78% 56%), hsl(${h2} 72% 44%))`,
    };
  }, [address, size]);
  return <span class="identicon" style={style} aria-hidden="true" />;
}

export async function copyText(text: string, secret = false): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(secret ? t('phraseCopiedWarn') : t('copied'), 'success');
    if (secret) {
      setTimeout(() => {
        navigator.clipboard.readText().then(
          (cur) => {
            if (cur === text) void navigator.clipboard.writeText('');
          },
          () => void navigator.clipboard.writeText('').catch(() => undefined),
        );
      }, 60_000);
    }
  } catch {
    toast(t('clipboardUnavailable'), 'error');
  }
}

export function CopyButton({ text, label, secret }: { text: string; label?: string; secret?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      class="icon-btn copy-btn"
      aria-label={label ?? t('copy')}
      title={label ?? t('copy')}
      onClick={async (e) => {
        e.stopPropagation();
        await copyText(text, secret);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={16} />
    </button>
  );
}

export function AddressLine({ address, short = true }: { address: string; short?: boolean }) {
  return (
    <span class="address-line">
      <span class="mono">{short ? middle(address, 7, 6) : address}</span>
      <CopyButton text={address} />
    </span>
  );
}

export function QRCode({ value, size = 188 }: { value: string; size?: number }) {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { d, n };
  }, [value]);
  return (
    <svg class="qr" width={size} height={size} viewBox={`-2 -2 ${path.n + 4} ${path.n + 4}`} shape-rendering="crispEdges" role="img" aria-label={value}>
      <rect x="-2" y="-2" width={path.n + 4} height={path.n + 4} fill="#fff" rx="1.5" />
      <path d={path.d} fill="#0b0f19" />
    </svg>
  );
}

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

export function FileDrop({ label, file, onFile, accept, hint }: { label: string; file: PickedFile | null; onFile: (f: PickedFile | null) => void; accept?: string; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const read = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) {
      toast(t('fileTooLarge'), 'error');
      return;
    }
    onFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  };
  return (
    <div class="field">
      <div class="field-label">{label}</div>
      <div
        class={`filedrop ${drag ? 'drag' : ''} ${file ? 'has-file' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void read(e.dataTransfer?.files?.[0]);
        }}
      >
        <Icon name={file ? 'file' : 'upload'} size={20} />
        <span class="filedrop-text">{file ? `${file.name} · ${file.bytes.length} B` : t('dropFile')}</span>
        {file && <IconButton icon="close" label={t('delete')} onClick={(e) => (e.stopPropagation(), onFile(null))} size={16} />}
        <input
          ref={input}
          type="file"
          hidden
          accept={accept}
          onChange={(e) => {
            void read((e.currentTarget as HTMLInputElement).files?.[0]);
            (e.currentTarget as HTMLInputElement).value = '';
          }}
        />
      </div>
      {hint && <div class="field-hint">{hint}</div>}
    </div>
  );
}

export function PasswordStrength({ password }: { password: string }) {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const level = password.length < 8 ? 0 : score <= 2 ? 1 : score <= 3 ? 2 : 3;
  const label = [t('passwordHint'), t('strengthWeak'), t('strengthFair'), t('strengthStrong')][level];
  return (
    <div class={`strength strength-${level}`}>
      <div class="strength-bar">
        <span />
        <span />
        <span />
      </div>
      <span class="strength-label">{label}</span>
    </div>
  );
}
