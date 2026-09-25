/**
 * XDAG amounts.
 *
 * Balances are handled as integer nano-XDAG (1 XDAG = 1e9 nano) in `bigint`, exactly like
 * xdagj's XAmount. Block link fields however carry the historical C-client fixed point
 * value ("cheato", 1 XDAG = 2^32) produced by xdagj BasicUtils.xdag2amount(double), which we
 * reproduce bit-for-bit, including its detour through an IEEE-754 double.
 */

export const NANO_PER_XDAG = 1_000_000_000n;
export const DECIMALS = 9;
/** xdagj Constants.MIN_GAS: the base fee charged per output (0.1 XDAG). */
export const MIN_FEE_NANO = 100_000_000n;
/** Largest amount the node accepts (u64 cheato range, far above total supply). */
export const MAX_NANO = 4_000_000_000_000_000_000n;

const AMOUNT_RE = /^(\d+)(?:\.(\d*))?$/;

/** Parses a user supplied decimal string ("12.5") into nano-XDAG. */
export function parseXdag(input: string): bigint {
  const s = input.trim().replace(/,/g, '');
  const m = AMOUNT_RE.exec(s) ?? (/^\.(\d+)$/.test(s) ? AMOUNT_RE.exec(`0${s}`) : null);
  if (!m) throw new Error('Invalid amount');
  const whole = m[1] ?? '0';
  const frac = m[2] ?? '';
  if (frac.length > DECIMALS) throw new Error(`At most ${DECIMALS} decimal places`);
  const nano = BigInt(whole) * NANO_PER_XDAG + BigInt(frac.padEnd(DECIMALS, '0') || '0');
  if (nano > MAX_NANO) throw new Error('Amount too large');
  return nano;
}

export function tryParseXdag(input: string): bigint | null {
  try {
    return parseXdag(input);
  } catch {
    return null;
  }
}

/** Formats nano-XDAG as a plain decimal string without trailing zeros. */
export function formatXdag(nano: bigint, opts: { minDecimals?: number; maxDecimals?: number; group?: boolean } = {}): string {
  const { minDecimals = 0, maxDecimals = DECIMALS, group = false } = opts;
  const neg = nano < 0n;
  let v = neg ? -nano : nano;
  // round half-up to maxDecimals
  if (maxDecimals < DECIMALS) {
    const unit = 10n ** BigInt(DECIMALS - maxDecimals);
    v = ((v + unit / 2n) / unit) * unit;
  }
  const whole = v / NANO_PER_XDAG;
  let frac = (v % NANO_PER_XDAG).toString().padStart(DECIMALS, '0').slice(0, maxDecimals);
  frac = frac.replace(/0+$/, '');
  if (frac.length < minDecimals) frac = frac.padEnd(minDecimals, '0');
  let w = whole.toString();
  if (group) w = w.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${w}${frac ? `.${frac}` : ''}`;
}

/** Parses a balance string returned by the node (e.g. "12.340000000"). */
export function parseNodeAmount(value: unknown): bigint {
  if (typeof value === 'number') value = value.toFixed(9);
  if (typeof value !== 'string') throw new Error('Invalid amount from node');
  const s = value.trim();
  if (s.startsWith('-')) return -parseXdag(s.slice(1));
  return parseXdag(s);
}

/**
 * xdagj XAmount.toXAmount(): nano -> BigDecimal -> double -> BasicUtils.xdag2amount(double).
 * BigDecimal.doubleValue() and JavaScript's Number(string) are both correctly rounded.
 */
export function nanoToCheato(nano: bigint): bigint {
  if (nano < 0n) throw new RangeError('negative amount');
  const whole = nano / NANO_PER_XDAG;
  const frac = (nano % NANO_PER_XDAG).toString().padStart(DECIMALS, '0');
  let input = Number(`${whole}.${frac}`);
  const amount = Math.floor(input);
  const res = BigInt(amount) << 32n;
  input -= amount;
  input = input * 2 ** 32;
  const tmp = Math.ceil(input);
  const out = res + BigInt(tmp);
  if (out > 0xffffffffffffffffn) throw new RangeError('amount too large');
  return out;
}
