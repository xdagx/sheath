/**
 * Sheath's own encrypted backup file: everything the wallet knows, so a restore brings back the
 * same accounts — recovery phrases and private keys, account names, the 2018 old block addresses
 * attached to each account, and the address book. Only this wallet can open it.
 *
 * The file is UTF-8 JSON: a small clear header (format, version, creation time, app version) and
 * the payload sealed exactly like the vault at rest: PBKDF2-HMAC-SHA256 (600k iterations) →
 * AES-256-GCM, with a password chosen for the file.
 */
import { isLegacyAddress, isValidAddress, publicKeyToAddress } from './address';
import { randomBytes, wipe } from './bytes';
import { checkMnemonic, deriveHdKey, getPublicKey, mnemonicToSeed, normalizeMnemonic, parsePrivateKey } from './keys';
import { VAULT_KDF_ITERATIONS, VaultDecryptError, deriveVaultKey, openVault, sealVault, type EncryptedVault } from './vault';
import { MAX_LEGACY_BLOCKS, type Account, type AccountSource, type Contact, type Keyring } from '@/shared/types';

export const BACKUP_FORMAT = 'sheath-wallet-backup';
export const BACKUP_VERSION = 1;
/** sanity caps so a crafted file cannot stall the import */
const MAX_KEYRINGS = 200;
const MAX_ACCOUNTS = 1000;
const MAX_CONTACTS = 1000;
const SOURCES: ReadonlySet<string> = new Set<AccountSource>(['created', 'mnemonic', 'privateKey', 'xdagj', 'legacy']);

export interface BackupPayload {
  version: 1;
  createdAt: number;
  keyrings: Keyring[];
  accounts: Account[];
  selectedAccountId: string | null;
  contacts: Contact[];
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: 1;
  createdAt: number;
  app: string;
  vault: EncryptedVault;
}

export class BackupFormatError extends Error {
  constructor(message = 'Not a Sheath backup file') {
    super(message);
    this.name = 'BackupFormatError';
  }
}

export class BackupPasswordError extends Error {
  constructor() {
    super('Wrong backup password');
    this.name = 'BackupPasswordError';
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Cheap check for the file picker: JSON that starts with our format marker. */
export function looksLikeSheathBackup(bytes: Uint8Array): boolean {
  if (bytes.length < 40 || bytes[0] !== 0x7b /* { */) return false;
  const head = dec.decode(bytes.subarray(0, Math.min(bytes.length, 200)));
  return head.includes(`"format":"${BACKUP_FORMAT}"`) || head.includes(`"format": "${BACKUP_FORMAT}"`);
}

export function parseBackupFile(bytes: Uint8Array): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(dec.decode(bytes));
  } catch {
    throw new BackupFormatError();
  }
  const f = parsed as Partial<BackupFile> | null;
  if (!f || typeof f !== 'object' || f.format !== BACKUP_FORMAT) throw new BackupFormatError();
  if (f.version !== BACKUP_VERSION) throw new BackupFormatError(`Unsupported backup version ${String(f.version)}`);
  const v = f.vault as Partial<EncryptedVault> | undefined;
  if (
    !v ||
    v.v !== 1 ||
    v.cipher !== 'AES-GCM' ||
    typeof v.iv !== 'string' ||
    typeof v.data !== 'string' ||
    !v.kdf ||
    v.kdf.name !== 'PBKDF2' ||
    v.kdf.hash !== 'SHA-256' ||
    typeof v.kdf.salt !== 'string' ||
    !Number.isInteger(v.kdf.iterations) ||
    v.kdf.iterations < 10_000 ||
    v.kdf.iterations > 10_000_000
  ) {
    throw new BackupFormatError();
  }
  return { format: BACKUP_FORMAT, version: 1, createdAt: Number(f.createdAt) || 0, app: String(f.app ?? ''), vault: v as EncryptedVault };
}

export async function encryptBackup(payload: BackupPayload, password: string, app: string): Promise<Uint8Array> {
  const salt = randomBytes(16);
  const key = await deriveVaultKey(password, salt);
  try {
    const vault = await sealVault(payload, key, salt, VAULT_KDF_ITERATIONS);
    const file: BackupFile = { format: BACKUP_FORMAT, version: 1, createdAt: payload.createdAt, app, vault };
    return enc.encode(JSON.stringify(file, null, 1));
  } finally {
    wipe(key);
  }
}

export async function decryptBackup(bytes: Uint8Array, password: string): Promise<BackupPayload> {
  const file = parseBackupFile(bytes);
  const key = await deriveVaultKey(
    password,
    Uint8Array.from(atob(file.vault.kdf.salt), (c) => c.charCodeAt(0)),
    file.vault.kdf.iterations,
  );
  let plain: unknown;
  try {
    plain = await openVault<unknown>(file.vault, key);
  } catch (e) {
    if (e instanceof VaultDecryptError) throw new BackupPasswordError();
    throw e;
  } finally {
    wipe(key);
  }
  return validateBackupPayload(plain);
}

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isId = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x);
const isTime = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/**
 * Strict check of a decrypted payload. Every account address is recomputed from its key, so a
 * damaged or edited file cannot make the wallet show an address it cannot sign for.
 */
export function validateBackupPayload(x: unknown): BackupPayload {
  if (!isRecord(x) || x.version !== 1) throw new BackupFormatError('Unsupported payload');
  if (!Array.isArray(x.keyrings) || x.keyrings.length > MAX_KEYRINGS) throw new BackupFormatError('Bad keyrings');
  if (!Array.isArray(x.accounts) || x.accounts.length > MAX_ACCOUNTS) throw new BackupFormatError('Bad accounts');
  const rawContacts = x.contacts ?? [];
  if (!Array.isArray(rawContacts) || rawContacts.length > MAX_CONTACTS) throw new BackupFormatError('Bad contacts');

  const keyrings: Keyring[] = [];
  const seeds = new Map<string, Uint8Array>();
  const keys = new Map<string, Uint8Array>();
  try {
    for (const k of x.keyrings) {
      if (!isRecord(k) || !isId(k.id) || keys.has(k.id) || seeds.has(k.id)) throw new BackupFormatError('Bad keyring');
      const createdAt = isTime(k.createdAt) ? k.createdAt : 0;
      if (k.type === 'hd') {
        const mnemonic = typeof k.mnemonic === 'string' ? normalizeMnemonic(k.mnemonic) : '';
        if (checkMnemonic(mnemonic).status !== 'ok') throw new BackupFormatError('Bad recovery phrase');
        const nextIndex = Number.isInteger(k.nextIndex) && (k.nextIndex as number) >= 0 && (k.nextIndex as number) <= 100_000 ? (k.nextIndex as number) : 0;
        keyrings.push({ id: k.id, type: 'hd', mnemonic, nextIndex, createdAt, backedUp: k.backedUp === true });
        seeds.set(k.id, mnemonicToSeed(mnemonic));
      } else if (k.type === 'key') {
        let priv: Uint8Array;
        try {
          priv = parsePrivateKey(typeof k.privateKey === 'string' ? k.privateKey : '');
        } catch {
          throw new BackupFormatError('Bad private key');
        }
        keyrings.push({ id: k.id, type: 'key', privateKey: Array.from(priv, (b) => b.toString(16).padStart(2, '0')).join(''), createdAt });
        keys.set(k.id, priv);
      } else {
        throw new BackupFormatError('Bad keyring type');
      }
    }

    const accounts: Account[] = [];
    const seenAddr = new Set<string>();
    for (const a of x.accounts) {
      if (!isRecord(a) || !isId(a.id) || typeof a.address !== 'string' || !isValidAddress(a.address)) throw new BackupFormatError('Bad account');
      if (!isId(a.keyringId) || typeof a.source !== 'string' || !SOURCES.has(a.source)) throw new BackupFormatError('Bad account');
      const hdIndex =
        a.hdIndex === undefined
          ? undefined
          : Number.isInteger(a.hdIndex) && (a.hdIndex as number) >= 0 && (a.hdIndex as number) < 0x80000000
            ? (a.hdIndex as number)
            : NaN;
      if (Number.isNaN(hdIndex)) throw new BackupFormatError('Bad account');
      // the address must belong to the key the account points at
      let priv: Uint8Array | undefined;
      let derived = false;
      if (seeds.has(a.keyringId)) {
        if (hdIndex === undefined) throw new BackupFormatError('HD account without index');
        priv = deriveHdKey(seeds.get(a.keyringId)!, hdIndex);
        derived = true;
      } else if (keys.has(a.keyringId)) {
        priv = keys.get(a.keyringId)!;
      } else {
        throw new BackupFormatError('Account points at a missing key');
      }
      const expected = publicKeyToAddress(getPublicKey(priv));
      if (derived) wipe(priv);
      if (expected !== a.address) throw new BackupFormatError('Account address does not match its key');
      if (seenAddr.has(a.address)) continue; // duplicates: keep the first
      seenAddr.add(a.address);
      const legacyRaw = Array.isArray(a.legacyBlocks) ? a.legacyBlocks : [];
      const legacyBlocks = [
        ...new Set(
          legacyRaw
            .filter((b): b is string => typeof b === 'string')
            .map((b) => b.trim())
            .filter(isLegacyAddress),
        ),
      ].slice(0, MAX_LEGACY_BLOCKS);
      accounts.push({
        id: a.id,
        name: (typeof a.name === 'string' ? a.name.trim() : '').slice(0, 40) || a.address.slice(0, 8),
        address: a.address,
        source: a.source as AccountSource,
        keyringId: a.keyringId,
        ...(hdIndex !== undefined ? { hdIndex } : {}),
        groupId: isId(a.groupId) ? a.groupId : a.keyringId,
        legacyBlocks,
        createdAt: isTime(a.createdAt) ? a.createdAt : 0,
      });
    }
    if (!accounts.length) throw new BackupFormatError('No accounts');

    const contacts: Contact[] = [];
    const seenContact = new Set<string>();
    for (const c of rawContacts) {
      if (!isRecord(c) || typeof c.address !== 'string' || typeof c.name !== 'string') continue;
      const address = c.address.trim();
      const name = c.name.trim().slice(0, 40);
      if (!name || !isValidAddress(address) || seenContact.has(address)) continue;
      seenContact.add(address);
      contacts.push({
        id: isId(c.id) ? c.id : crypto.randomUUID(),
        name,
        address,
        ...(typeof c.note === 'string' && c.note ? { note: c.note.slice(0, 100) } : {}),
      });
    }

    return {
      version: 1,
      createdAt: isTime(x.createdAt) ? x.createdAt : 0,
      keyrings,
      accounts,
      selectedAccountId: isId(x.selectedAccountId) && accounts.some((a) => a.id === x.selectedAccountId) ? x.selectedAccountId : null,
      contacts,
    };
  } finally {
    for (const s of seeds.values()) wipe(s);
    for (const k of keys.values()) wipe(k);
  }
}
