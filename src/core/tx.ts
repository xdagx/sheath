/**
 * XDAG transaction blocks (512 bytes = 16 fields x 32 bytes), byte-compatible with
 * xdagj io.xdag.core.Block and XDAG Pro TransactionHelper.
 *
 * Field 0 (header): transport(8) | field types, 16 x 4-bit (8, LE) | xdag time (8, LE) | fee (8, LE, nano)
 * Account transfer (post-Apollo, nonce based): header, nonce, INPUT(from), OUTPUT(to), [REMARK],
 *   PUBKEY, SIGN_OUT r, SIGN_OUT s, zero padding.
 * Legacy transfer from a 2018 block address: header, IN(block), OUTPUT(to), [REMARK], PUBKEY,
 *   SIGN_OUT r, SIGN_OUT s — no nonce field (xdagj "xfertonew").
 * Signature: ECDSA(sha256d(block with signature fields zeroed || compressed pubkey)).
 */
import { concatBytes, u64le, utf8ToBytes } from './bytes';
import { blockAddressOfRaw, blockHashOfRaw, decodeAddress, decodeLegacyAddress, publicKeyToAddress } from './address';
import { nanoToCheato } from './amount';
import { sha256d } from './hash';
import { getPublicKey, signDigest } from './keys';

export const FIELD = {
  HEAD: 0x1,
  IN: 0x2,
  OUT: 0x3,
  SIGN_IN: 0x4,
  SIGN_OUT: 0x5,
  PUBLIC_KEY_0: 0x6,
  PUBLIC_KEY_1: 0x7,
  HEAD_TEST: 0x8,
  REMARK: 0x9,
  INPUT: 0xc,
  OUTPUT: 0xd,
  TRANSACTION_NONCE: 0xe,
} as const;

export type NetworkKind = 'mainnet' | 'testnet' | 'devnet';

export const REMARK_MAX_BYTES = 32;

/** xdagj XdagTime.msToXdagtimestamp(): 1/1024 s units, computed through a double as in Java. */
export function msToXdagTime(ms: number): bigint {
  return BigInt(Math.ceil((ms * 1024) / 1000 + 0.5));
}

export function xdagTimeToMs(t: bigint): number {
  return Number((t * 1000n) >> 10n);
}

/** Remarks must be printable ASCII (xdagj only embeds StringUtils.isAsciiPrintable remarks). */
export function isValidRemark(remark: string): boolean {
  return /^[\x20-\x7e]*$/.test(remark) && utf8ToBytes(remark).length <= REMARK_MAX_BYTES;
}

function remarkField(remark: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(utf8ToBytes(remark).subarray(0, 32));
  return out;
}

/** Link field for an account (20-byte) address: 4 zero bytes | reversed id | amount LE. */
function accountLink(addr20: Uint8Array, cheato: bigint): Uint8Array {
  const f = new Uint8Array(32);
  f.set(Uint8Array.from(addr20).reverse(), 4);
  f.set(u64le(cheato), 24);
  return f;
}

/** Link field for a block address: the 24 address bytes | amount LE. */
function blockLink(bytes24: Uint8Array, cheato: bigint): Uint8Array {
  const f = new Uint8Array(32);
  f.set(bytes24, 0);
  f.set(u64le(cheato), 24);
  return f;
}

function nonceField(nonce: bigint): Uint8Array {
  const f = new Uint8Array(32);
  f.set(u64le(nonce), 24);
  return f;
}

export interface SignedBlock {
  /** 512 raw bytes */
  raw: Uint8Array;
  /** hex string passed to xdag_sendRawTransaction */
  rawHex: string;
  /** 32-char block address the node returns on success */
  blockAddress: string;
  /** xdagj display hash (hex) */
  hash: string;
}

interface BuildParams {
  network: NetworkKind;
  privateKey: Uint8Array;
  /** input link type and payload */
  input: { type: typeof FIELD.INPUT; addr20: Uint8Array } | { type: typeof FIELD.IN; block24: Uint8Array };
  to: Uint8Array;
  amountNano: bigint;
  feeNano: bigint;
  nonce: bigint | null;
  remark?: string | null;
  timestampMs: number;
}

function assemble(p: BuildParams): SignedBlock {
  if (p.amountNano <= 0n) throw new Error('Amount must be positive');
  if (p.feeNano < 0n) throw new Error('Fee must not be negative');
  const cheato = nanoToCheato(p.amountNano);
  const pub = getPublicKey(p.privateKey);
  const types: number[] = [p.network === 'mainnet' ? FIELD.HEAD : FIELD.HEAD_TEST];
  const body: Uint8Array[] = [];

  if (p.nonce !== null) {
    if (p.nonce <= 0n) throw new Error('Invalid nonce');
    types.push(FIELD.TRANSACTION_NONCE);
    body.push(nonceField(p.nonce));
  }
  if (p.input.type === FIELD.INPUT) {
    types.push(FIELD.INPUT);
    body.push(accountLink(p.input.addr20, cheato));
  } else {
    types.push(FIELD.IN);
    body.push(blockLink(p.input.block24, cheato));
  }
  types.push(FIELD.OUTPUT);
  body.push(accountLink(p.to, cheato));
  if (p.remark) {
    types.push(FIELD.REMARK);
    body.push(remarkField(p.remark));
  }
  types.push(pub[0] === 0x03 ? FIELD.PUBLIC_KEY_1 : FIELD.PUBLIC_KEY_0);
  body.push(pub.subarray(1));
  const sigIndex = types.length; // index of the first signature field
  types.push(FIELD.SIGN_OUT, FIELD.SIGN_OUT);

  let typeWord = 0n;
  types.forEach((t, i) => (typeWord |= BigInt(t) << BigInt(4 * i)));
  const header = concatBytes(new Uint8Array(8), u64le(typeWord), u64le(msToXdagTime(p.timestampMs)), u64le(p.feeNano));

  const block = new Uint8Array(512);
  block.set(header, 0);
  body.forEach((f, i) => block.set(f, 32 * (i + 1)));

  // sign the block with empty signature fields, followed by the compressed public key
  const digest = sha256d(concatBytes(block, pub));
  const sig = signDigest(digest, p.privateKey);
  block.set(sig.subarray(0, 32), 32 * sigIndex);
  block.set(sig.subarray(32, 64), 32 * (sigIndex + 1));

  let rawHex = '';
  for (let i = 0; i < block.length; i++) rawHex += block[i]!.toString(16).padStart(2, '0');
  const hash = blockHashOfRaw(block);
  let hashHex = '';
  for (let i = 0; i < hash.length; i++) hashHex += hash[i]!.toString(16).padStart(2, '0');
  return { raw: block, rawHex, blockAddress: blockAddressOfRaw(block), hash: hashHex };
}

export interface AccountTransfer {
  network: NetworkKind;
  privateKey: Uint8Array;
  to: string;
  amountNano: bigint;
  /** Extra fee on top of the 0.1 XDAG base fee (header fee field, nano). */
  feeNano: bigint;
  nonce: bigint;
  remark?: string | null;
  timestampMs?: number;
}

export function buildAccountTransfer(t: AccountTransfer): SignedBlock {
  const from = decodeAddress(publicKeyAddress(t.privateKey));
  return assemble({
    network: t.network,
    privateKey: t.privateKey,
    input: { type: FIELD.INPUT, addr20: from },
    to: decodeAddress(t.to),
    amountNano: t.amountNano,
    feeNano: t.feeNano,
    nonce: t.nonce,
    remark: t.remark ?? null,
    timestampMs: t.timestampMs ?? Date.now(),
  });
}

export interface LegacyTransfer {
  network: NetworkKind;
  privateKey: Uint8Array;
  /** 32-character 2018 block address holding the funds */
  fromBlock: string;
  to: string;
  amountNano: bigint;
  remark?: string | null;
  timestampMs?: number;
}

export function buildLegacyTransfer(t: LegacyTransfer): SignedBlock {
  return assemble({
    network: t.network,
    privateKey: t.privateKey,
    input: { type: FIELD.IN, block24: decodeLegacyAddress(t.fromBlock) },
    to: decodeAddress(t.to),
    amountNano: t.amountNano,
    feeNano: 0n,
    nonce: null,
    remark: t.remark ?? null,
    timestampMs: t.timestampMs ?? Date.now(),
  });
}

function publicKeyAddress(priv: Uint8Array): string {
  return publicKeyToAddress(getPublicKey(priv));
}

/** Network fee charged for a single-output transfer: 0.1 XDAG base + optional extra. */
export function totalFee(extraFeeNano: bigint): bigint {
  return 100_000_000n + (extraFeeNano > 0n ? extraFeeNano : 0n);
}
