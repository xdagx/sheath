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

## 2018 C client storage folder — `tests/fixtures/legacy-storage/`

```bash
S=xdag/client
gcc -O2 -c -DUSE_BASIC_CONFIG=1 -Ixdag/secp256k1 -Ixdag/secp256k1/include -Ixdag/secp256k1/src \
    xdag/secp256k1/src/secp256k1.c -o secp.o
gcc -O1 -w -I$S -I$S/.. -Ixdag/secp256k1/include tools/vectors/legacy/gen_storage.c \
    $S/crypt.c $S/hash.c $S/algorithms/sha256.c $S/address.c $S/storage.c secp.o -lcrypto -lpthread -o gen_storage
./gen_storage out <privhex of wallet.dat, in file order>...
```

`gen_storage` links the unmodified client sources, assembles blocks like `xdag_create_block()`
(wallet address blocks of every key position, a transfer, a pool-style first block, a mined block,
a foreign block and a testnet block), signs them with `xdag_sign()` and writes them with the real
`xdag_storage_save()`, then damages three files. The expected owner of every block comes from a
verbatim copy of the client's `valid_signature()`. The committed folder uses the keys of the first
legacy case (the reviewer test wallet, password `xdag2018`); the same folder is shipped in
`store/reviewer-test-files/` so the folder import can be tried by hand. OpenSSL signs with a random
k, so regenerated folders differ: commit the output rather than regenerating it in CI.

