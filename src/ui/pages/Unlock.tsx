import { useState } from 'preact/hooks';
import { call } from '../api';
import { Button, Notice, PasswordField, Sheet, TextField } from '../components';
import { Logo } from '../icons';
import { t } from '../i18n';
import { navigate } from '../router';
import { applyState, describeError } from '../state';

export function Unlock() {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reset, setReset] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const go = async () => {
    if (!pw || busy) return;
    setBusy(true);
    setErr(null);
    try {
      applyState(await call('unlock', { password: pw }));
    } catch (e) {
      setErr(describeError(e));
      setPw('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="unlock">
      <div class="unlock-hero">
        <div class="welcome-glow" />
        <Logo size={64} />
        <h1>{t('unlockTitle')}</h1>
        <p class="muted">{t('unlockSubtitle')}</p>
      </div>
      <div class="unlock-form">
        <PasswordField value={pw} onValue={setPw} placeholder={t('password')} autoFocus error={err} onEnter={go} />
        <Button block size="lg" loading={busy} disabled={!pw} onClick={go}>
          {t('unlock')}
        </Button>
        <button class="link-btn" onClick={() => setReset(true)}>
          {t('forgotPassword')}
        </button>
      </div>
      <Sheet open={reset} onClose={() => setReset(false)} title={t('resetTitle')}>
        <div class="stack">
          <Notice kind="danger">{t('resetDesc')}</Notice>
          <TextField label={t('resetConfirmLabel')} value={confirmText} onValue={setConfirmText} />
          <Button
            block
            variant="danger"
            disabled={confirmText.trim().toUpperCase() !== 'RESET'}
            onClick={async () => {
              applyState(await call('resetWallet'));
              setReset(false);
              navigate('/welcome', undefined, true);
            }}
          >
            {t('resetButton')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
