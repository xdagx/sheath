/**
 * The keyring owns all secrets. It lives in the MV3 service worker; the decrypted vault is
 * kept in memory and the vault key in chrome.storage.session (RAM only, trusted contexts) so
 * the worker can be restarted by Chrome without asking for the password again.
 */
import { isLegacyAddress, isValidAddress, publicKeyToAddress } from '@/core/address';
import { MAX_NANO, MIN_FEE_NANO, formatXdag } from '@/core/amount';
import { fromBase64, fromHex, randomBytes, toBase64, toHex, wipe } from '@/core/bytes';
import {
  checkMnemonic,
  deriveHdKey,
  generateMnemonic,
  getPublicKey,
  isValidPrivateKey,
  mnemonicToSeed,
  normalizeMnemonic,
  parsePrivateKey,
} from '@/core/keys';
import { decryptLegacyWallet } from '@/core/legacy/wallet';
import { RpcError, XdagRpc } from '@/core/rpc';
import { buildAccountTransfer, buildLegacyTransfer, isValidRemark, totalFee } from '@/core/tx';
import { EncryptedVault, VAULT_KDF_ITERATIONS, deriveVaultKey, keyFromPassword, openVault, sealVault } from '@/core/vault';
import { decryptXdagjWallet, encryptXdagjWallet, InvalidFileError, WrongPasswordError } from '@/core/xdagj-wallet';
import type { RequestOf } from '@/shared/messages';
import { currentNetwork } from '@/shared/networks';
import type { Account, AccountSource, ImportPreview, Keyring as KeyringEntry, PendingTx, SendResult, VaultData, WalletState } from '@/shared/types';
import { MAX_LEGACY_BLOCKS } from '@/shared/types';

type HdKeyring = Extract<KeyringEntry, { type: 'hd' }>;
import { clearSession, getLocal, getSession, loadSettings, removeLocal, setLocal, setSession } from './store';

export class WalletError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'WalletError';
  }
}

interface StagedImport {
  kind: ImportPreview['kind'];
  keys: { priv: Uint8Array; address: string; hdIndex?: number }[];
  mnemonic?: string;
  nextIndex?: number;
  createdAt: number;
}

const newId = () => toHex(randomBytes(8));
const PASSWORD_MIN = 8;

function lang(): 'zh' | 'en' {
  return (globalThis.navigator?.language ?? 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function defaultName(source: AccountSource, n: number, language: string): string {
  const zh = language === 'zh-CN' || (language === 'auto' && lang() === 'zh');
  const names: Record<AccountSource, [string, string]> = {
    created: ['Account', '账户'],
    mnemonic: ['Account', '账户'],
    privateKey: ['Imported', '导入账户'],
    xdagj: ['XDAGJ', 'XDAGJ 钱包'],
    legacy: ['Legacy', '旧钱包'],
  };
  return `${names[source][zh ? 1 : 0]} ${n}`;
}

/** Serialises async critical sections (FIFO). */
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

interface KdfParams {
  salt: Uint8Array;
  iterations: number;
}

export class Keyring {
  private vault: VaultData | null = null;
  private key: Uint8Array | null = null;
  /** KDF parameters that belong to `key`; kept together so a save never pairs a key with another salt. */
  private kdf: KdfParams | null = null;
  /** Incremented by lock(): async work started under an older epoch must not unlock or sign. */
  private epoch = 0;
  private restoring: Promise<void> | null = null;
  private staged = new Map<string, StagedImport>();
  /** Every vault write (and password change) runs here, one at a time. */
  private readonly vaultMutex = new Mutex();
  /** Password checks run one at a time so the rate limit cannot be raced. */
  private readonly authMutex = new Mutex();
  private readonly sendMutex = new Mutex();
  private failures: { count: number; until: number } | null = null;

  // ---------------------------------------------------------------- lifecycle

  async isInitialized(): Promise<boolean> {
    return !!(await getLocal('vault'));
  }

  /** Restores the unlocked state after a service-worker restart. */
  async restore(): Promise<boolean> {
    if (this.vault) return true;
    if (!this.restoring) {
      const epoch = this.epoch;
      this.restoring = (async () => {
        const [stored, keyB64] = await Promise.all([getLocal('vault'), getSession('vaultKey')]);
        if (!stored || !keyB64) return;
        try {
          const key = fromBase64(keyB64);
          const data = await openVault<VaultData>(stored, key);
          if (epoch !== this.epoch || this.vault) return; // locked (or unlocked) meanwhile
          this.vault = data;
          this.key = key;
          this.kdf = { salt: fromBase64(stored.kdf.salt), iterations: stored.kdf.iterations };
        } catch {
          if (epoch === this.epoch) await clearSession();
        }
      })().finally(() => (this.restoring = null));
    }
    await this.restoring;
    return !!this.vault;
  }

  private async requireUnlocked(): Promise<VaultData> {
    if (!(await this.restore()) || !this.vault) throw new WalletError('locked', 'Wallet is locked');
    return this.vault;
  }

  /** Guards writes to settings/contacts: allowed before onboarding, otherwise only while unlocked. */
  async requireUnlockedIfInitialized(): Promise<void> {
    if (await this.isInitialized()) await this.requireUnlocked();
  }

  async state(): Promise<WalletState> {
    const initialized = await this.isInitialized();
    const unlocked = initialized && (await this.restore());
    const settings = await loadSettings();
    const v = this.vault;
    return {
      initialized,
      unlocked,
      accounts: unlocked && v ? v.accounts : [],
      selectedAccountId: unlocked && v ? v.selectedAccountId : null,
      needsBackup: !!v?.keyrings.some((k) => k.type === 'hd' && !k.backedUp),
      hasMnemonic: !!v?.keyrings.some((k) => k.type === 'hd'),
      settings,
    };
  }

  /** Seals the in-memory vault with the in-memory key and its own KDF parameters. Call under vaultMutex. */
  private async persist(): Promise<void> {
    const { vault, key, kdf } = this;
    if (!vault || !key || !kdf) throw new WalletError('locked', 'Wallet is locked');
    await setLocal('vault', await sealVault(vault, key, kdf.salt, kdf.iterations));
  }

  /** Call under vaultMutex. */
  private async createStorage(password: string, data: VaultData): Promise<void> {
    if (await this.isInitialized()) throw new WalletError('already_initialized');
    if (password.length < PASSWORD_MIN) throw new WalletError('weak_password');
    const epoch = this.epoch;
    const salt = randomBytes(16);
    const key = await deriveVaultKey(password, salt, VAULT_KDF_ITERATIONS);
    await setLocal('vault', await sealVault(data, key, salt, VAULT_KDF_ITERATIONS));
    if (epoch !== this.epoch) throw new WalletError('locked', 'Wallet is locked');
    await setSession('vaultKey', toBase64(key));
    this.vault = data;
    this.key = key;
    this.kdf = { salt, iterations: VAULT_KDF_ITERATIONS };
  }

  private async loadFailures(): Promise<{ count: number; until: number }> {
    this.failures ??= (await getLocal('unlockFailures')) ?? { count: 0, until: 0 };
    return this.failures;
  }

  /** Verifies a password against the stored vault, one attempt at a time, with exponential back-off. */
  private passwordKey(password: string): Promise<{ stored: EncryptedVault; key: Uint8Array; data: VaultData }> {
    return this.authMutex.run(async () => {
      const f = await this.loadFailures();
      if (f.until > Date.now()) throw new WalletError('rate_limited', String(Math.ceil((f.until - Date.now()) / 1000)));
      const stored = await getLocal('vault');
      if (!stored) throw new WalletError('not_initialized');
      const key = await keyFromPassword(stored, password);
      try {
        const data = await openVault<VaultData>(stored, key);
        if (f.count) {
          this.failures = { count: 0, until: 0 };
          await removeLocal('unlockFailures');
        }
        return { stored, key, data };
      } catch {
        const count = f.count + 1;
        const delay = count >= 5 ? Math.min(15 * 60_000, 30_000 * 2 ** (count - 5)) : 0;
        this.failures = { count, until: Date.now() + delay };
        await setLocal('unlockFailures', this.failures);
        throw new WalletError('wrong_password', 'Incorrect password');
      }
    });
  }

  async unlock(password: string): Promise<WalletState> {
    const epoch = this.epoch;
    const { stored, key, data } = await this.passwordKey(password);
    if (epoch !== this.epoch) throw new WalletError('locked', 'Wallet is locked');
    this.vault = data;
    this.key = key;
    this.kdf = { salt: fromBase64(stored.kdf.salt), iterations: stored.kdf.iterations };
    await setSession('vaultKey', toBase64(key));
    return this.state();
  }

  /** Re-authentication for sensitive operations while unlocked. */
  async verifyPassword(password: string): Promise<void> {
    await this.requireUnlocked();
    await this.passwordKey(password);
  }

  async lock(): Promise<void> {
    this.epoch++;
    const key = this.key;
    this.vault = null;
    this.key = null;
    this.kdf = null;
    for (const s of this.staged.values()) s.keys.forEach((k) => wipe(k.priv));
    this.staged.clear();
    await clearSession();
    // a write that was already running may still store a session key: clear again once it is done
    await this.vaultMutex.run(() => clearSession());
    if (key) wipe(key);
  }

  changePassword(oldPassword: string, newPassword: string): Promise<void> {
    return this.vaultMutex.run(async () => {
      const vault = await this.requireUnlocked();
      if (newPassword.length < PASSWORD_MIN) throw new WalletError('weak_password');
      const epoch = this.epoch;
      await this.passwordKey(oldPassword);
      const salt = randomBytes(16);
      const key = await deriveVaultKey(newPassword, salt, VAULT_KDF_ITERATIONS);
      if (epoch !== this.epoch) throw new WalletError('locked', 'Wallet is locked');
      await setLocal('vault', await sealVault(vault, key, salt, VAULT_KDF_ITERATIONS));
      await setSession('vaultKey', toBase64(key));
      if (epoch !== this.epoch) return; // locked meanwhile: lock() clears the session key again
      this.key = key;
      this.kdf = { salt, iterations: VAULT_KDF_ITERATIONS };
    });
  }

  /** Erases everything. While unlocked the password is required; while locked this is the "forgot password" path. */
  async reset(password?: string): Promise<void> {
    if (this.vault || (await this.restore())) {
      if (!password) throw new WalletError('wrong_password', 'Incorrect password');
      await this.verifyPassword(password);
    }
    await this.lock();
    await this.vaultMutex.run(async () => {
      await chrome.storage.local.clear();
      this.failures = null;
    });
  }

  // ---------------------------------------------------------------- creation

  generateMnemonic(words: 12 | 24 = 12): string {
    return generateMnemonic(words);
  }

  createVault(password: string, mnemonic: string, backedUp: boolean): Promise<void> {
    return this.vaultMutex.run(async () => {
      const norm = normalizeMnemonic(mnemonic);
      if (checkMnemonic(norm).status !== 'ok') throw new WalletError('invalid_mnemonic');
      const settings = await loadSettings();
      const seed = mnemonicToSeed(norm);
      const priv = deriveHdKey(seed, 0);
      wipe(seed);
      const keyring: KeyringEntry = { id: newId(), type: 'hd', mnemonic: norm, nextIndex: 1, createdAt: Date.now(), backedUp };
      const account: Account = {
        id: newId(),
        name: defaultName('created', 1, settings.language),
        address: publicKeyToAddress(getPublicKey(priv)),
        source: 'created',
        keyringId: keyring.id,
        hdIndex: 0,
        groupId: keyring.id,
        legacyBlocks: [],
        createdAt: Date.now(),
      };
      wipe(priv);
      await this.createStorage(password, { version: 1, keyrings: [keyring], accounts: [account], selectedAccountId: account.id });
    });
  }

  // ---------------------------------------------------------------- imports

  async previewImport(req: RequestOf<'previewImport'>): Promise<ImportPreview> {
    if (await this.isInitialized()) await this.requireUnlocked();
    const existing = new Set((this.vault?.accounts ?? []).map((a) => a.address));
    const staged: StagedImport = { kind: req.kind, keys: [], createdAt: Date.now() };
    let passwordVerified = true;
    let encrypted = true;

    switch (req.kind) {
      case 'mnemonic': {
        const norm = normalizeMnemonic(req.mnemonic);
        const check = checkMnemonic(norm);
        if (check.status === 'checksum' && !req.allowBadChecksum) throw new WalletError('mnemonic_checksum');
        if (check.status !== 'ok' && check.status !== 'checksum') throw new WalletError(`mnemonic_${check.status}`, check.badWord);
        const seed = mnemonicToSeed(norm);
        const count = Math.min(Math.max(req.count, 1), 20);
        for (let i = 0; i < count; i++) {
          const priv = deriveHdKey(seed, i);
          staged.keys.push({ priv, address: publicKeyToAddress(getPublicKey(priv)), hdIndex: i });
        }
        wipe(seed);
        staged.mnemonic = norm;
        break;
      }
      case 'privateKey': {
        let priv: Uint8Array;
        try {
          priv = parsePrivateKey(req.privateKey);
        } catch {
          throw new WalletError('invalid_private_key');
        }
        staged.keys.push({ priv, address: publicKeyToAddress(getPublicKey(priv)) });
        break;
      }
      case 'xdagj': {
        let res;
        try {
          res = decryptXdagjWallet(fromBase64(req.file.data), req.filePassword);
        } catch (e) {
          if (e instanceof WrongPasswordError) throw new WalletError('wrong_file_password');
          if (e instanceof InvalidFileError) throw new WalletError('invalid_file', e.message);
          throw e;
        }
        let hd: Map<string, number> | null = null;
        const phraseStatus = res.mnemonic ? checkMnemonic(res.mnemonic).status : 'empty';
        // the index comes from the file: bound it so a crafted file cannot stall the worker
        const nextIndex = Math.min(Math.max(res.nextAccountIndex, 0), 1000);
        if (phraseStatus === 'ok' || phraseStatus === 'checksum') {
          const seed = mnemonicToSeed(res.mnemonic);
          hd = new Map();
          const upto = Math.min(Math.max(nextIndex, 1), 100) + 5;
          for (let i = 0; i < upto; i++) {
            const p = deriveHdKey(seed, i);
            hd.set(toHex(p), i);
            wipe(p);
          }
          wipe(seed);
          staged.mnemonic = normalizeMnemonic(res.mnemonic);
          staged.nextIndex = nextIndex;
        }
        for (const priv of res.privateKeys) {
          const hdIndex = hd?.get(toHex(priv));
          staged.keys.push({ priv, address: publicKeyToAddress(getPublicKey(priv)), ...(hdIndex !== undefined ? { hdIndex } : {}) });
        }
        break;
      }
      case 'legacy': {
        let res;
        try {
          res = decryptLegacyWallet(
            fromBase64(req.walletDat.data),
            req.dnetKeyDat ? fromBase64(req.dnetKeyDat.data) : null,
            req.filePassword,
          );
        } catch (e) {
          if (e instanceof WrongPasswordError) throw new WalletError('wrong_file_password');
          if (e instanceof InvalidFileError) throw new WalletError('invalid_file', e.message);
          throw e;
        }
        passwordVerified = res.passwordVerified;
        encrypted = res.encrypted;
        // the C client's default key is the last one in wallet.dat: list it first
        for (const priv of [...res.privateKeys].reverse()) staged.keys.push({ priv, address: publicKeyToAddress(getPublicKey(priv)) });
        break;
      }
    }

    if (!staged.keys.length) throw new WalletError('invalid_file', 'No keys found');
    const token = newId();
    // keep at most a few staged imports around
    if (this.staged.size > 4) {
      const oldest = [...this.staged.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0]!;
      oldest[1].keys.forEach((k) => wipe(k.priv));
      this.staged.delete(oldest[0]);
    }
    this.staged.set(token, staged);
    return {
      token,
      kind: req.kind,
      hasMnemonic: !!staged.mnemonic,
      passwordVerified,
      encrypted,
      accounts: staged.keys.map((k, index) => ({
        address: k.address,
        publicKey: toHex(getPublicKey(k.priv)),
        index,
        alreadyExists: existing.has(k.address),
        ...(k.hdIndex !== undefined ? { hdIndex: k.hdIndex } : {}),
      })),
    };
  }

  cancelImport(token: string): void {
    const s = this.staged.get(token);
    s?.keys.forEach((k) => wipe(k.priv));
    this.staged.delete(token);
  }

  commitImport(req: RequestOf<'commitImport'>): Promise<void> {
    return this.vaultMutex.run(async () => {
      const staged = this.staged.get(req.token);
      if (!staged) throw new WalletError('import_expired');
      const initialized = await this.isInitialized();
      const settings = await loadSettings();
      const current = initialized ? await this.requireUnlocked() : null;
      const known = new Set(current?.accounts.map((a) => a.address) ?? []);
      const wanted = new Set(req.addresses);
      const chosen = staged.keys.filter((k) => wanted.has(k.address) && !known.has(k.address));

      // Old block addresses. Found ones go to the account of their owning key; typed ones (owner
      // unknown) to the first new account, else to an account of this wallet that already exists.
      // Everything is validated before the vault is created or changed.
      const owned = new Map<string, string[]>();
      for (const o of req.ownedBlocks ?? []) {
        const block = typeof o?.block === 'string' ? o.block.trim() : '';
        if (!isLegacyAddress(block) || !staged.keys.some((k) => k.address === o?.owner)) throw new WalletError('invalid_block_address');
        owned.set(o.owner, [...new Set([...(owned.get(o.owner) ?? []), block])]);
      }
      const found = new Set([...owned.values()].flat());
      const typed = [...new Set((req.legacyBlocks ?? []).map((b) => (typeof b === 'string' ? b.trim() : '')).filter(isLegacyAddress))].filter((b) => !found.has(b));
      const typedOwner = chosen[0]?.address ?? staged.keys.find((k) => known.has(k.address))?.address ?? null;
      if (typed.length) {
        if (!typedOwner) throw new WalletError('nothing_to_import');
        owned.set(typedOwner, [...new Set([...(owned.get(typedOwner) ?? []), ...typed])]);
      }
      const toExisting = [...owned.keys()].filter((a) => known.has(a));
      if (!chosen.length && !toExisting.length) throw new WalletError('nothing_to_import');
      const merged = new Map<string, string[]>();
      for (const [owner, blocks] of owned) {
        if (!known.has(owner) && !chosen.some((k) => k.address === owner)) continue; // key not imported: nothing can spend them
        const before = current?.accounts.find((a) => a.address === owner)?.legacyBlocks ?? [];
        const all = [...new Set([...before, ...blocks])];
        if (all.length > MAX_LEGACY_BLOCKS) throw new WalletError('too_many_blocks', String(MAX_LEGACY_BLOCKS));
        merged.set(owner, all);
      }

      if (!initialized) {
        if (!req.newVaultPassword) throw new WalletError('weak_password');
        await this.createStorage(req.newVaultPassword, { version: 1, keyrings: [], accounts: [], selectedAccountId: null });
      }
      const vault = await this.requireUnlocked();

      const groupId = newId();
      const source: AccountSource = staged.kind === 'mnemonic' ? 'mnemonic' : staged.kind;
      let hdKeyring: HdKeyring | undefined;
      if (staged.mnemonic) {
        hdKeyring = vault.keyrings.find((k): k is HdKeyring => k.type === 'hd' && k.mnemonic === staged.mnemonic);
        if (!hdKeyring) {
          hdKeyring = { id: newId(), type: 'hd', mnemonic: staged.mnemonic, nextIndex: 0, createdAt: Date.now(), backedUp: true };
          vault.keyrings.push(hdKeyring);
        }
      }
      let counter = vault.accounts.filter((a) => a.source === source).length;
      let first: Account | null = null;
      for (const k of chosen) {
        let keyringId: string;
        if (hdKeyring && k.hdIndex !== undefined) {
          keyringId = hdKeyring.id;
          hdKeyring.nextIndex = Math.max(hdKeyring.nextIndex, k.hdIndex + 1, staged.nextIndex ?? 0);
        } else {
          const kr: KeyringEntry = { id: newId(), type: 'key', privateKey: toHex(k.priv), createdAt: Date.now() };
          vault.keyrings.push(kr);
          keyringId = kr.id;
        }
        counter++;
        const account: Account = {
          id: newId(),
          name: defaultName(source, counter, settings.language),
          address: k.address,
          source,
          keyringId,
          ...(hdKeyring && k.hdIndex !== undefined ? { hdIndex: k.hdIndex } : {}),
          groupId,
          legacyBlocks: merged.get(k.address) ?? [],
          createdAt: Date.now(),
        };
        first ??= account;
        vault.accounts.push(account);
      }
      for (const owner of toExisting) {
        const acct = vault.accounts.find((a) => a.address === owner);
        if (acct) acct.legacyBlocks = merged.get(owner)!;
      }
      vault.selectedAccountId = first?.id ?? vault.accounts.find((a) => a.address === toExisting[0])?.id ?? vault.selectedAccountId;
      this.cancelImport(req.token);
      await this.persist();
    });
  }

  // ---------------------------------------------------------------- accounts

  private primaryHd(vault: VaultData): HdKeyring | undefined {
    return vault.keyrings.find((k): k is HdKeyring => k.type === 'hd');
  }

  /**
   * Adds a new recovery phrase and its first account to an existing wallet. A wallet built only
   * from imported keys (2018 wallet, private key, xdagj file without phrase) has no phrase to
   * derive accounts from; this gives it one, so a new account can always be created.
   */
  createHdWallet(mnemonic: string, backedUp: boolean): Promise<void> {
    return this.vaultMutex.run(async () => {
      const vault = await this.requireUnlocked();
      const norm = typeof mnemonic === 'string' ? normalizeMnemonic(mnemonic) : '';
      if (checkMnemonic(norm).status !== 'ok') throw new WalletError('invalid_mnemonic');
      if (vault.keyrings.some((k) => k.type === 'hd' && k.mnemonic === norm)) throw new WalletError('mnemonic_exists');
      const settings = await loadSettings();
      const seed = mnemonicToSeed(norm);
      const priv = deriveHdKey(seed, 0);
      wipe(seed);
      const address = publicKeyToAddress(getPublicKey(priv));
      wipe(priv);
      if (vault.accounts.some((a) => a.address === address)) throw new WalletError('mnemonic_exists');
      const keyring: KeyringEntry = { id: newId(), type: 'hd', mnemonic: norm, nextIndex: 1, createdAt: Date.now(), backedUp };
      const account: Account = {
        id: newId(),
        name: defaultName('created', vault.accounts.filter((a) => a.source === 'created').length + 1, settings.language),
        address,
        source: 'created',
        keyringId: keyring.id,
        hdIndex: 0,
        groupId: keyring.id,
        legacyBlocks: [],
        createdAt: Date.now(),
      };
      vault.keyrings.push(keyring);
      vault.accounts.push(account);
      vault.selectedAccountId = account.id;
      await this.persist();
    });
  }

  addHdAccount(name?: string): Promise<void> {
    return this.vaultMutex.run(async () => {
      const vault = await this.requireUnlocked();
      const settings = await loadSettings();
      let kr = this.primaryHd(vault);
      if (!kr) throw new WalletError('no_mnemonic');
      const seed = mnemonicToSeed(kr.mnemonic);
      try {
        for (let guard = 0; guard < 100; guard++) {
          const index = kr.nextIndex++;
          const priv = deriveHdKey(seed, index);
          const address = publicKeyToAddress(getPublicKey(priv));
          wipe(priv);
          if (vault.accounts.some((a) => a.address === address)) continue;
          const n = vault.accounts.filter((a) => a.keyringId === kr!.id).length + 1;
          const account: Account = {
            id: newId(),
            name: name?.trim() || defaultName('created', n, settings.language),
            address,
            source: 'created',
            keyringId: kr.id,
            hdIndex: index,
            groupId: kr.id,
            legacyBlocks: [],
            createdAt: Date.now(),
          };
          vault.accounts.push(account);
          vault.selectedAccountId = account.id;
          await this.persist();
          return;
        }
      } finally {
        wipe(seed);
      }
      throw new WalletError('derivation_failed');
    });
  }

  private account(vault: VaultData, id: string): Account {
    const a = vault.accounts.find((x) => x.id === id);
    if (!a) throw new WalletError('unknown_account');
    return a;
  }

  renameAccount(id: string, name: string): Promise<void> {
    return this.vaultMutex.run(async () => {
      const vault = await this.requireUnlocked();
      const trimmed = name.trim().slice(0, 40);
      if (!trimmed) throw new WalletError('invalid_name');
      this.account(vault, id).name = trimmed;
      await this.persist();
    });
  }

  selectAccount(id: string): Promise<void> {
    return this.vaultMutex.run(async () => {
      const vault = await this.requireUnlocked();
      this.account(vault, id);
      vault.selectedAccountId = id;
      await this.persist();
    });
  }

  removeAccount(id: string, password: string): Promise<void> {
    return this.vaultMutex.run(async () => {
      await this.verifyPassword(password);
      const vault = await this.requireUnlocked();
      const acct = this.account(vault, id);
      if (vault.accounts.length <= 1) throw new WalletError('last_account');
      vault.accounts = vault.accounts.filter((a) => a.id !== id);
      const kr = vault.keyrings.find((k) => k.id === acct.keyringId);
      if (kr?.type === 'key' && !vault.accounts.some((a) => a.keyringId === kr.id)) {
        vault.keyrings = vault.keyrings.filter((k) => k.id !== kr.id);
      }
      if (vault.selectedAccountId === id) vault.selectedAccountId = vault.accounts[0]!.id;
      await this.persist();
    });
  }

  setLegacyBlocks(id: string, blocks: string[]): Promise<void> {
    return this.vaultMutex.run(async () => {
      const vault = await this.requireUnlocked();
      const clean = [...new Set(blocks.map((b) => b.trim()).filter(Boolean))];
      if (clean.some((b) => !isLegacyAddress(b))) throw new WalletError('invalid_block_address');
      if (clean.length > MAX_LEGACY_BLOCKS) throw new WalletError('too_many_blocks', String(MAX_LEGACY_BLOCKS));
      this.account(vault, id).legacyBlocks = clean;
      await this.persist();
    });
  }

  markBackedUp(password: string): Promise<void> {
    return this.vaultMutex.run(async () => {
      await this.verifyPassword(password);
      const vault = await this.requireUnlocked();
      vault.keyrings.forEach((k) => {
        if (k.type === 'hd') k.backedUp = true;
      });
      await this.persist();
    });
  }

  private privateKeyOf(vault: VaultData, acct: Account): Uint8Array {
    const kr = vault.keyrings.find((k) => k.id === acct.keyringId);
    if (!kr) throw new WalletError('missing_key');
    let priv: Uint8Array;
    if (kr.type === 'key') priv = fromHex(kr.privateKey);
    else {
      if (acct.hdIndex === undefined) throw new WalletError('missing_key');
      const seed = mnemonicToSeed(kr.mnemonic);
      priv = deriveHdKey(seed, acct.hdIndex);
      wipe(seed);
    }
    if (!isValidPrivateKey(priv) || publicKeyToAddress(getPublicKey(priv)) !== acct.address) {
      wipe(priv);
      throw new WalletError('key_mismatch');
    }
    return priv;
  }

  // ---------------------------------------------------------------- exports

  async exportPrivateKey(id: string, password: string): Promise<string> {
    await this.verifyPassword(password);
    const vault = await this.requireUnlocked();
    const priv = this.privateKeyOf(vault, this.account(vault, id));
    const hex = toHex(priv);
    wipe(priv);
    return hex;
  }

  async exportMnemonic(password: string, keyringId?: string): Promise<string> {
    await this.verifyPassword(password);
    const vault = await this.requireUnlocked();
    const kr = keyringId ? vault.keyrings.find((k) => k.id === keyringId) : this.primaryHd(vault);
    if (!kr || kr.type !== 'hd') throw new WalletError('no_mnemonic');
    return kr.mnemonic;
  }

  /** Writes every key into an xdagj-compatible wallet.data (importable by the xdagj node). */
  async exportXdagjWallet(password: string, filePassword: string): Promise<{ file: string; count: number }> {
    await this.verifyPassword(password);
    const vault = await this.requireUnlocked();
    if (!filePassword) throw new WalletError('weak_password');
    const ordered = [...vault.accounts].sort((a, b) => (a.id === vault.selectedAccountId ? -1 : b.id === vault.selectedAccountId ? 1 : 0));
    const keys = ordered.map((a) => this.privateKeyOf(vault, a));
    const hd = this.primaryHd(vault);
    const mnemonicOk = !!hd && hd.mnemonic.split(' ').length === 12; // xdagj only accepts 12 words
    try {
      const file = encryptXdagjWallet(
        { privateKeys: keys, mnemonic: mnemonicOk ? hd!.mnemonic : '', nextAccountIndex: mnemonicOk ? hd!.nextIndex : 0 },
        filePassword,
      );
      return { file: toBase64(file), count: keys.length };
    } catch (e) {
      if (e instanceof WrongPasswordError) throw new WalletError('file_password_too_long');
      throw e;
    } finally {
      keys.forEach((k) => wipe(k));
    }
  }

  // ---------------------------------------------------------------- transfers

  /** Resolves the selected node and refuses to continue unless it confirms it is on the selected chain. */
  private async rpcForSend() {
    const settings = await loadSettings();
    const net = currentNetwork(settings);
    const rpc = new XdagRpc(net.rpcUrl);
    let nodeNet: string;
    try {
      nodeNet = await rpc.netType();
    } catch (e) {
      const transport = !(e instanceof RpcError) || e.kind === 'transport';
      throw new WalletError(transport ? 'node_unreachable' : 'network_unverified', (e as Error).message);
    }
    if (nodeNet !== net.kind) throw new WalletError('network_mismatch', nodeNet);
    return { rpc, net };
  }

  private async recordPending(p: PendingTx): Promise<void> {
    const list = (await getLocal('pending')) ?? [];
    const cutoff = Date.now() - 3 * 24 * 3600_000;
    await setLocal('pending', [p, ...list.filter((x) => x.time > cutoff && x.blockAddress !== p.blockAddress)].slice(0, 100));
  }

  private requireEpoch(epoch: number): void {
    if (epoch !== this.epoch) throw new WalletError('locked', 'Wallet is locked');
  }

  /**
   * Broadcasts a signed block. A definite rejection by the node becomes `rejected`; anything else
   * (timeout, connection loss, unexpected answer) is recorded as pending with an unknown outcome so
   * the UI does not invite a retry that could pay twice.
   */
  private async broadcast(rpc: XdagRpc, rawHex: string, blockAddress: string, pending: PendingTx): Promise<SendResult> {
    let returned: string;
    try {
      returned = await rpc.sendRawTransaction(rawHex);
    } catch (e) {
      if (e instanceof RpcError && e.kind !== 'transport') throw e;
      await this.recordPending({ ...pending, uncertain: true });
      throw new WalletError('broadcast_unknown', blockAddress);
    }
    if (returned !== blockAddress) {
      await this.recordPending({ ...pending, uncertain: true });
      throw new WalletError('broadcast_unknown', blockAddress);
    }
    await this.recordPending(pending);
    return { blockAddress, pending };
  }

  async send(req: RequestOf<'send'>): Promise<SendResult> {
    return this.sendMutex.run(async () => {
      const epoch = this.epoch;
      const vault = await this.requireUnlocked();
      const acct = this.account(vault, req.accountId);
      if (!isValidAddress(req.to)) throw new WalletError(isLegacyAddress(req.to) ? 'legacy_destination' : 'invalid_address');
      if (!isValidRemark(req.remark)) throw new WalletError('invalid_remark');
      const amount = parseNano(req.amount, 'invalid_amount');
      const extraFee = parseNano(req.fee, 'invalid_fee');
      if (extraFee > 1_000_000_000_000n) throw new WalletError('invalid_fee');
      const fee = totalFee(extraFee);
      if (amount <= fee) throw new WalletError('amount_below_fee', formatXdag(fee));

      const { rpc, net } = await this.rpcForSend();
      const balance = await rpc.getBalance(acct.address);
      if (amount > balance) throw new WalletError('insufficient_funds', formatXdag(balance));
      const nonce = await rpc.getNonce(acct.address);
      if (nonce <= 0n || nonce >= 1n << 63n) throw new WalletError('invalid_nonce');

      this.requireEpoch(epoch); // never sign after the wallet was locked
      const priv = this.privateKeyOf(vault, acct);
      let block;
      try {
        block = buildAccountTransfer({
          network: net.kind,
          privateKey: priv,
          to: req.to,
          amountNano: amount,
          feeNano: extraFee,
          nonce,
          remark: req.remark || null,
        });
      } finally {
        wipe(priv);
      }
      const pending: PendingTx = {
        blockAddress: block.blockAddress,
        from: acct.address,
        to: req.to,
        amount: amount.toString(),
        fee: fee.toString(),
        remark: req.remark,
        time: Date.now(),
        networkId: net.id,
      };
      try {
        return await this.broadcast(rpc, block.rawHex, block.blockAddress, pending);
      } catch (e) {
        if (e instanceof RpcError) throw new WalletError('rejected', e.message);
        throw e;
      }
    });
  }

  /** Spends a 2018 block balance (XDAG_FIELD_IN input, no nonce), like xdagj "xfertonew". */
  async sendLegacy(req: RequestOf<'sendLegacy'>): Promise<SendResult> {
    return this.sendMutex.run(async () => {
      const epoch = this.epoch;
      const vault = await this.requireUnlocked();
      const acct = this.account(vault, req.accountId);
      if (!isLegacyAddress(req.fromBlock)) throw new WalletError('invalid_block_address');
      if (!isValidAddress(req.to)) throw new WalletError(isLegacyAddress(req.to) ? 'legacy_destination' : 'invalid_address');
      if (!isValidRemark(req.remark)) throw new WalletError('invalid_remark');
      const amount = parseNano(req.amount, 'invalid_amount');
      if (amount <= MIN_FEE_NANO) throw new WalletError('amount_below_fee', formatXdag(MIN_FEE_NANO));

      const { rpc, net } = await this.rpcForSend();
      const balance = await rpc.getBalance(req.fromBlock);
      if (amount > balance) throw new WalletError('insufficient_funds', formatXdag(balance));

      // The block may belong to any key of the same imported wallet; the node verifies ownership
      // and rejects the others with "Block's input can't be used" (nothing is imported then).
      const candidates = [acct, ...vault.accounts.filter((a) => a.groupId === acct.groupId && a.id !== acct.id)];
      let lastError = '';
      for (const cand of candidates) {
        this.requireEpoch(epoch);
        const priv = this.privateKeyOf(vault, cand);
        let block;
        try {
          block = buildLegacyTransfer({
            network: net.kind,
            privateKey: priv,
            fromBlock: req.fromBlock,
            to: req.to,
            amountNano: amount,
            remark: req.remark || null,
          });
        } finally {
          wipe(priv);
        }
        const pending: PendingTx = {
          blockAddress: block.blockAddress,
          from: req.fromBlock,
          to: req.to,
          amount: amount.toString(),
          fee: MIN_FEE_NANO.toString(),
          remark: req.remark,
          time: Date.now(),
          networkId: net.id,
          legacyFrom: req.fromBlock,
        };
        try {
          return await this.broadcast(rpc, block.rawHex, block.blockAddress, pending);
        } catch (e) {
          if (!(e instanceof RpcError)) throw e;
          lastError = e.message;
          if (!/input can.?t be used/i.test(e.message)) throw new WalletError('rejected', e.message);
        }
      }
      throw new WalletError('block_not_owned', lastError);
    });
  }
}

/** Parses a non-negative integer nano amount sent by the UI, bounded by MAX_NANO. */
function parseNano(value: string, code: string): bigint {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) throw new WalletError(code);
  const n = BigInt(value);
  if (n > MAX_NANO) throw new WalletError(code);
  return n;
}
