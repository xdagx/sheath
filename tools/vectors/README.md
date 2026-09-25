# Test-vector generators

The fixtures in `tests/fixtures/` are produced by the **official** XDAG implementations so the
extension is tested against them, not against itself.

## xdagj (Java) — `tests/fixtures/xdagj-vectors.json`

```bash
git clone --depth 1 https://github.com/XDagger/xdagj && cd xdagj
mvn -DskipTests -Dlicense.skip=true install           # builds target/xdagj-<ver>-executable.jar
mkdir /tmp/vec && cd /tmp/vec
java -cp "<xdagj>/target/xdagj-0.8.3-executable.jar:<xdagj>/src/main/resources" \
     <this repo>/tools/vectors/xdagj/VectorGen.java > xdagj-vectors.json
```

Covers BIP39/BIP44 accounts, RFC 6979 signatures, BouncyCastle raw BCrypt, AES-192-CBC,
real `wallet.data` files written by `io.xdag.Wallet`, signed transaction blocks built with
`io.xdag.core.Block` (account and legacy block inputs, mainnet/testnet, fees, remarks) and
`XAmount` fixed-point conversions. Wallet files contain random salts/IVs, so regenerated
fixtures differ byte-wise but must still pass.

## 2018 C client — `tests/fixtures/legacy-vectors.json`

```bash
git clone --depth 1 https://github.com/XDagger/xdag
D=xdag/dfslib
gcc -O2 -w -I$D -Dmain=dfsrsa_selftest_main -c $D/dfsrsa.c -o dfsrsa.o
gcc -O2 -w -I$D -c $D/dfslib_random.c -o dfslib_random.o
gcc -O2 -w -I$D -o gen_legacy tools/vectors/legacy/gen_legacy.c $D/dfslib_crypt.c $D/dfslib_string.c dfsrsa.o dfslib_random.o
mkdir c1 && ./gen_legacy c1 'xdag2018' 256 <privhex> [<privhex>...]
```

`gen_legacy` reproduces `dnet_crypt_init()` (dnet_key.dat) and `add_key()` (wallet.dat) with
deterministic randomness. The five committed cases cover a 3-key wallet, a Chinese password with
an ARM-style 1024-bit dnet key, an empty password, an emoji password (dfslib leaves it unencrypted)
and a Cyrillic password. 4096-bit key generation takes about a minute per case.
