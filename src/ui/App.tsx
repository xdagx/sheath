import { useEffect } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { call } from './api';
import { Toasts } from './components';
import { navDirection, navigate, route } from './router';
import { applyTheme, balances, loadCachedBalances, loadContacts, loadPending, refreshState, settings, wallet } from './state';
import { BackupExisting, CreatePhrase, SetPassword, Welcome } from './pages/Onboarding';
import { ImportPage, ImportPreviewPage } from './pages/Import';
import { Unlock } from './pages/Unlock';
import { Home } from './pages/Home';
import { LegacySendPage, ReceivePage, SendPage } from './pages/Send';
import { AccountDetailPage, AccountsPage } from './pages/Accounts';
import { ContactsPage, NetworksPage, SettingsPage } from './pages/Settings';

const PUBLIC: Record<string, ComponentType> = {
  '/welcome': Welcome,
  '/onboard/password': SetPassword,
  '/onboard/phrase': CreatePhrase,
  '/import': ImportPage,
  '/import/preview': ImportPreviewPage,
};

const PRIVATE: Record<string, ComponentType> = {
  '/home': Home,
  '/send': SendPage,
  '/legacy-send': LegacySendPage,
  '/receive': ReceivePage,
  '/accounts': AccountsPage,
  '/account': AccountDetailPage,
  '/settings': SettingsPage,
  '/settings/networks': NetworksPage,
  '/settings/contacts': ContactsPage,
  '/backup': BackupExisting,
  '/import': ImportPage,
  '/import/preview': ImportPreviewPage,
};

let lastTouch = 0;
function touch() {
  const now = Date.now();
  if (now - lastTouch < 30_000 || !wallet.value?.unlocked) return;
  lastTouch = now;
  void call('touch').catch(() => undefined);
}

export function App() {
  useEffect(() => {
    loadCachedBalances();
    refreshState().then(() => {
      void loadContacts();
      void loadPending();
    });
    // keep the service worker (and any staged import) alive while a page is open
    const ping = setInterval(() => void call('ping').catch(() => undefined), 20_000);
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if ((area === 'session' && 'vaultKey' in changes) || (area === 'local' && ('vault' in changes || 'settings' in changes))) {
        void refreshState().then((st) => {
          if (!st.unlocked) balances.value = {};
        });
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => applyTheme(settings.value.theme);
    mq.addEventListener('change', onScheme);
    window.addEventListener('pointerdown', touch, { passive: true });
    window.addEventListener('keydown', touch, { passive: true });
    return () => {
      clearInterval(ping);
      chrome.storage.onChanged.removeListener(onStorage);
      mq.removeEventListener('change', onScheme);
    };
  }, []);

  const w = wallet.value;
  const path = route.value.path;

  useEffect(() => {
    if (!w) return;
    if (!w.initialized && !PUBLIC[path]) navigate('/welcome', undefined, true);
    else if (w.unlocked && (path === '/' || path === '/welcome' || path.startsWith('/onboard'))) navigate('/home', undefined, true);
    else if (w.unlocked && !PRIVATE[path]) navigate('/home', undefined, true);
  }, [w?.initialized, w?.unlocked, path]);

  if (!w) return <div class="splash" />;

  let View: ComponentType | undefined;
  if (!w.initialized) View = PUBLIC[path];
  else if (!w.unlocked) View = Unlock;
  else View = PRIVATE[path] ?? (w.accounts.length ? Home : undefined);

  return (
    <>
      <div class={`view view-${navDirection.value}`} key={w.unlocked ? path : `locked-${w.initialized}`}>
        {View ? <View /> : <div class="splash" />}
      </div>
      <Toasts />
    </>
  );
}
