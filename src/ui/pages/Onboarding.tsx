import { useEffect, useMemo, useState } from 'preact/hooks';
import { call, isPopup, openInTab } from '../api';
import { Button, Checkbox, CopyButton, Notice, Page, PasswordField, PasswordStrength } from '../components';
import { Icon, Logo } from '../icons';
import { t } from '../i18n';
import { navigate, route } from '../router';
import { applyState, describeError, onboardingPassword, toastError } from '../state';

export function Welcome() {
  const popup = isPopup();
  return (
    <div class="welcome">
      <div class="welcome-hero">
        <div class="welcome-glow" />
        <Logo size={72} />
        <h1>{t('welcomeTitle')}</h1>
        <p>{t('welcomeSubtitle')}</p>
        <ul class="welcome-features">
          <li>
            <Icon name="history" size={16} /> {t('featureLegacy')}
          </li>
          <li>
            <Icon name="link" size={16} /> {t('featureCompat')}
          </li>
          <li>
            <Icon name="shield" size={16} /> {t('featureSecure')}
          </li>
        </ul>
        <p class="unofficial">{t('unofficialNote')}</p>
      </div>
      <div class="welcome-actions">
        {popup ? (
          <>
            <Button block size="lg" onClick={() => openInTab('#/welcome')}>
              {t('getStarted')}
            </Button>
            <p class="muted center small">{t('getStartedDesc')}</p>
          </>
        ) : (
          <>
            <button class="choice" onClick={() => navigate('/onboard/password', { flow: 'create' })}>
              <span class="choice-icon">
                <Icon name="plus" />
              </span>
              <span class="choice-text">
                <strong>{t('createWallet')}</strong>
                <small>{t('createWalletDesc')}</small>
              </span>
              <Icon name="chevronRight" size={18} />
            </button>
            <button class="choice" onClick={() => navigate('/onboard/password', { flow: 'import' })}>
              <span class="choice-icon alt">
                <Icon name="download" />
              </span>
              <span class="choice-text">
                <strong>{t('importWallet')}</strong>
                <small>{t('importWalletDesc')}</small>
              </span>
              <Icon name="chevronRight" size={18} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function SetPassword() {
  const flow = route.value.query.flow === 'import' ? 'import' : 'create';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [ack, setAck] = useState(false);
  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = pw2.length > 0 && pw !== pw2;
  const ok = pw.length >= 8 && pw === pw2 && ack;
  const next = () => {
    if (!ok) return;
    onboardingPassword.value = pw;
    navigate(flow === 'create' ? '/onboard/phrase' : '/import', flow === 'import' ? { onboarding: '1' } : undefined);
  };
  return (
    <Page
      title={t('setPasswordTitle')}
      footer={
        <Button block size="lg" disabled={!ok} onClick={next}>
          {t('continue')}
        </Button>
      }
    >
      <p class="lead">{t('setPasswordDesc')}</p>
      <PasswordField label={t('newPassword')} value={pw} onValue={setPw} autoFocus error={tooShort ? t('passwordTooShort') : null} />
      <PasswordStrength password={pw} />
      <PasswordField label={t('confirmPassword')} value={pw2} onValue={setPw2} error={mismatch ? t('passwordMismatch') : null} onEnter={next} />
      <Checkbox checked={ack} onChange={setAck}>
        {t('passwordAck')}
      </Checkbox>
    </Page>
  );
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  const r = crypto.getRandomValues(new Uint32Array(a.length));
  for (let i = a.length - 1; i > 0; i--) {
    const j = r[i]! % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Shows a phrase, then quizzes 3 random words. Used for new wallets and later backups. */
export function PhraseBackup({
  mnemonic,
  onConfirmed,
  onSkip,
  busy,
  title,
  note,
}: {
  mnemonic: string;
  onConfirmed: () => void;
  onSkip?: () => void;
  busy?: boolean;
  title?: string;
  /** extra explanation shown above the phrase */
  note?: string;
}) {
  const words = mnemonic.split(' ');
  const [revealed, setRevealed] = useState(false);
  const [step, setStep] = useState<'show' | 'quiz'>('show');
  const quiz = useMemo(() => {
    const positions = shuffle(words.map((_, i) => i)).slice(0, 3).sort((a, b) => a - b);
    return positions.map((pos) => {
      const decoys = shuffle(words.filter((w, i) => i !== pos && w !== words[pos])).slice(0, 3);
      return { pos, options: shuffle([words[pos]!, ...decoys]) };
    });
  }, [mnemonic]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [wrong, setWrong] = useState(false);

  if (step === 'show') {
    return (
      <Page
        title={title ?? t('backupTitle')}
        footer={
          <div class="stack-sm">
            <Button block size="lg" disabled={!revealed} onClick={() => setStep('quiz')}>
              {t('writtenDown')}
            </Button>
            {onSkip && (
              <Button block variant="ghost" onClick={onSkip} loading={busy}>
                {t('remindLater')}
              </Button>
            )}
          </div>
        }
      >
        <p class="lead">{t('backupDesc')}</p>
        {note && <Notice kind="info">{note}</Notice>}
        <div class={`phrase ${revealed ? 'revealed' : ''}`} onClick={() => setRevealed(true)}>
          <ol>
            {words.map((w, i) => (
              <li key={i}>
                <span class="phrase-n">{i + 1}</span>
                <span class="phrase-w">{w}</span>
              </li>
            ))}
          </ol>
          {!revealed && (
            <div class="phrase-cover">
              <Icon name="eye" size={22} />
              <strong>{t('revealPhrase')}</strong>
              <small>{t('revealHint')}</small>
            </div>
          )}
        </div>
        {revealed && (
          <div class="row-actions">
            <CopyButton text={mnemonic} secret label={t('copyPhrase')} />
            <span class="muted small">{t('copyPhrase')}</span>
          </div>
        )}
        <Notice kind="warning">
          {t('backupWarn1')} {t('backupWarn2')}
        </Notice>
      </Page>
    );
  }

  const complete = quiz.every((q) => answers[q.pos]);
  const check = () => {
    if (quiz.every((q) => answers[q.pos] === words[q.pos])) onConfirmed();
    else {
      setWrong(true);
      setAnswers({});
    }
  };
  return (
    <Page
      title={t('confirmPhraseTitle')}
      onBack={() => setStep('show')}
      footer={
        <Button block size="lg" disabled={!complete} loading={busy} onClick={check}>
          {t('confirm')}
        </Button>
      }
    >
      <p class="lead">{t('confirmPhraseDesc')}</p>
      {wrong && <Notice kind="danger">{t('confirmWrong')}</Notice>}
      {quiz.map((q) => (
        <div class="quiz" key={q.pos}>
          <div class="field-label">{t('wordN', { n: q.pos + 1 })}</div>
          <div class="chips">
            {q.options.map((o) => (
              <button
                type="button"
                class={`chip ${answers[q.pos] === o ? 'active' : ''}`}
                onClick={() => {
                  setWrong(false);
                  setAnswers({ ...answers, [q.pos]: o });
                }}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Page>
  );
}

export function CreatePhrase() {
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!onboardingPassword.value) {
      navigate('/onboard/password', { flow: 'create' }, true);
      return;
    }
    call('generateMnemonic', { words: 12 }).then((r) => setMnemonic(r.mnemonic), toastError);
  }, []);
  if (!mnemonic) return <div class="splash" />;
  const finish = async (backedUp: boolean) => {
    setBusy(true);
    try {
      const st = await call('createVault', { password: onboardingPassword.value!, mnemonic, backedUp });
      onboardingPassword.value = null;
      applyState(st);
      navigate('/home', undefined, true);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return <PhraseBackup mnemonic={mnemonic} busy={busy} onConfirmed={() => finish(true)} onSkip={() => finish(false)} />;
}

/**
 * "Create account" in a wallet without a recovery phrase (built from imported keys): creates a
 * phrase for it, shows it for backup, then adds the phrase's first account.
 */
export function CreateWalletPhrase() {
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call('generateMnemonic', { words: 12 }).then((r) => setMnemonic(r.mnemonic), toastError);
  }, []);
  if (!mnemonic) return <div class="splash" />;
  const finish = async (backedUp: boolean) => {
    setBusy(true);
    try {
      applyState(await call('createHdWallet', { mnemonic, backedUp }));
      navigate('/home', undefined, true);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <PhraseBackup
      title={t('newPhraseTitle')}
      note={t('newPhraseNote')}
      mnemonic={mnemonic}
      busy={busy}
      onConfirmed={() => finish(true)}
      onSkip={() => finish(false)}
    />
  );
}

/** Backup flow for an existing wallet that skipped it during onboarding. */
export function BackupExisting() {
  const [pw, setPw] = useState('');
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!mnemonic) {
    const go = async () => {
      setBusy(true);
      setErr(null);
      try {
        setMnemonic((await call('exportMnemonic', { password: pw })).mnemonic);
      } catch (e) {
        setErr(describeError(e));
      } finally {
        setBusy(false);
      }
    };
    return (
      <Page
        title={t('backupTitle')}
        footer={
          <Button block size="lg" disabled={!pw} loading={busy} onClick={go}>
            {t('continue')}
          </Button>
        }
      >
        <p class="lead">{t('enterPassword')}</p>
        <PasswordField value={pw} onValue={setPw} autoFocus error={err} onEnter={go} />
      </Page>
    );
  }
  return (
    <PhraseBackup
      mnemonic={mnemonic}
      busy={busy}
      onConfirmed={async () => {
        setBusy(true);
        try {
          applyState(await call('markBackedUp', { password: pw }));
          navigate('/home', undefined, true);
        } catch (e) {
          toastError(e);
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

