import { describe, expect, it } from 'vitest';
import { BUILTIN_NETWORKS, explorerLink } from '@/shared/networks';

describe('explorer links', () => {
  const mainnet = BUILTIN_NETWORKS.find((n) => n.id === 'mainnet')!;

  it('keep 2018 block addresses as they are (the explorer does not URL-decode the path)', () => {
    expect(explorerLink(mainnet, 'kAC2WjZkpznR8ELgPIL2UKJuzAJx9+UM')).toBe('https://explorer.xdag.io/block/kAC2WjZkpznR8ELgPIL2UKJuzAJx9+UM');
    expect(explorerLink(mainnet, 'Wjvq3/JkRUom0LtTE/uyAa4V7ipvqDyK')).toBe('https://explorer.xdag.io/block/Wjvq3/JkRUom0LtTE/uyAa4V7ipvqDyK');
  });

  it('links new addresses and block hashes', () => {
    expect(explorerLink(mainnet, '5xcSXy9S2iHEaxvnTUhpF5fWAYBhoT8yP')).toBe('https://explorer.xdag.io/block/5xcSXy9S2iHEaxvnTUhpF5fWAYBhoT8yP');
    expect(explorerLink(mainnet, 'ab'.repeat(32))).toBe(`https://explorer.xdag.io/block/${'ab'.repeat(32)}`);
  });

  it('refuses anything that is not an address or hash', () => {
    for (const bad of ['', 'abc', '../settings', 'kAC2WjZkpznR8ELgPIL2UKJuzAJx9+UM?x=1', 'kAC2WjZkpznR8ELgPIL2UKJuzAJx9 UM', 'a#'.repeat(20)]) {
      expect(explorerLink(mainnet, bad)).toBeNull();
    }
    expect(explorerLink({ ...mainnet, explorerUrl: '' }, 'kAC2WjZkpznR8ELgPIL2UKJuzAJx9+UM')).toBeNull();
  });
});
