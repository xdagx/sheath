/*
 * Reference generator for the storage/ folder of the 2018 XDAG C client.
 *
 * It links the unmodified client sources from https://github.com/XDagger/xdag
 * (client/crypt.c, hash.c, algorithms/sha256.c, address.c, storage.c and the vendored
 * secp256k1), assembles blocks exactly like client/block.c::xdag_create_block(), signs them
 * with xdag_sign() (OpenSSL, random k: high-S signatures happen, as in 2018) and writes them
 * with the real xdag_storage_save(), which also maintains the sums.dat files.
 * hash_for_signature() / valid_signature() are verbatim copies of client/block.c:405-460 and
 * decide the expected owner of every block, like add_block_nolock() does for BI_OURS.
 *
 * Usage: gen_storage <outdir> <privhex>...   (keys in wallet.dat file order; the last one is
 *                                            the C client's default key)
 * Writes <outdir>/storage, <outdir>/storage-testnet and <outdir>/expected.json.
 * Signatures use random k, so every run gives new blocks: commit the generated files.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <sys/stat.h>
#include <unistd.h>
#include "block.h"
#include "crypt.h"
#include "hash.h"
#include "address.h"
#include "storage.h"
#include "wallet.h"

/* ---- stubs for the parts of the client that are not linked ---- */
unsigned int xOPENSSL_ia32cap_P[4];
int xOPENSSL_ia32_cpuid(unsigned int *p) { (void)p; return 0; }
int xdag_log(const char *f, int l, const char *fmt, ...) { (void)f; (void)l; (void)fmt; return 0; }
char *xdag_log_array(const void *a, unsigned s) { (void)a; (void)s; return ""; }
int g_xdag_testnet = 0;
FILE *xdag_open_file(const char *p, const char *m) { return fopen(p, m); }
void xdag_close_file(FILE *f) { fclose(f); }
int xdag_file_exists(const char *p) { struct stat st; return !stat(p, &st); }
int xdag_mkdir(const char *p) { return mkdir(p, 0770); }
int xdag_blocks_reset(void) { return 0; }

/* ---- verbatim copies from client/block.c:405-460 ---- */
static inline void hash_for_signature(struct xdag_block b[2], const struct xdag_public_key *key, xdag_hash_t hash)
{
	memcpy((uint8_t*)(b + 1) + 1, (void*)((uintptr_t)key->pub & ~1l), sizeof(xdag_hash_t));
	*(uint8_t*)(b + 1) = ((uintptr_t)key->pub & 1) | 0x02;
	xdag_hash(b, sizeof(struct xdag_block) + sizeof(xdag_hash_t) + 1, hash);
}

static int valid_signature(const struct xdag_block *b, int signo_r, int keysLength, struct xdag_public_key *keys)
{
	struct xdag_block buf[2];
	xdag_hash_t hash;
	int i, signo_s = -1;
	memcpy(buf, b, sizeof(struct xdag_block));
	for(i = signo_r; i < XDAG_BLOCK_FIELDS; ++i) {
		if(xdag_type(b, i) == XDAG_FIELD_SIGN_IN || xdag_type(b, i) == XDAG_FIELD_SIGN_OUT) {
			memset(&buf[0].field[i], 0, sizeof(struct xdag_field));
			if(i > signo_r && signo_s < 0 && xdag_type(b, i) == xdag_type(b, signo_r)) {
				signo_s = i;
			}
		}
	}
	if(signo_s >= 0) {
		for(i = 0; i < keysLength; ++i) {
			hash_for_signature(buf, keys + i, hash);
			if(!xdag_verify_signature_optimized_ec(keys[i].pub, hash, b->field[signo_r].data, b->field[signo_s].data)) {
				return i;
			}
		}
	}
	return -1;
}

#define MAXKEYS 8
static xdag_hash_t pubs[MAXKEYS + 1];
static struct xdag_public_key keys[MAXKEYS + 1];
static uint8_t privs[MAXKEYS + 1][32];
static int nkeys;

/* the BI_OURS loop of add_block_nolock (client/block.c:562-570, 644-663) */
static int ours(struct xdag_block *b)
{
	int cnt = 0, res = -1;
	b->field[0].transport_header = 0;
	for (int i = 1; i < 16; i++) if (xdag_type(b, i) == XDAG_FIELD_SIGN_OUT) {
		if (++cnt & 1) { if (res < 0) res = valid_signature(b, i, nkeys, keys); }
	}
	if (cnt & 1) return -2;
	return res;
}

static int is_high_s(const uint8_t *s)
{ /* n/2 = 7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0 */
	static const uint8_t half[32] = {0x7f,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,
		0x5d,0x57,0x6e,0x73,0x57,0xa4,0x50,0x1d,0xdf,0xe9,0x2f,0x46,0x68,0x1b,0x20,0xa0};
	return memcmp(s, half, 32) > 0;
}

static void hex(FILE *o, const void *p, size_t n) { const uint8_t *b = p; for (size_t i = 0; i < n; i++) fprintf(o, "%02x", b[i]); }

static FILE *out;
static int emitted = 0;

static void emit(const char *name, struct xdag_block *b)
{
	xdag_hash_t h; char addr[33];
	b->field[0].transport_header = 0;
	xdag_hash(b, 512, h);
	xdag_hash2address(h, addr);
	int owner = ours(b);
	int so = -1, cnt = 0;
	for (int i = 1; i < 16; i++) if (xdag_type(b, i) == XDAG_FIELD_SIGN_OUT && ++cnt == 2) so = i;
	fprintf(out, "%s  {\"name\":\"%s\",\"net\":\"%s\",\"types\":\"%016llx\",\"address\":\"%s\",\"owner\":%d,\"highS\":%s,\"raw\":\"",
		emitted++ ? ",\n" : "", name, g_xdag_testnet ? "testnet" : "mainnet", (unsigned long long)b->field[0].type, addr, owner,
		so > 0 && is_high_s((uint8_t*)b->field[so].data) ? "true" : "false");
	hex(out, b, 512);
	fprintf(out, "\"}");
}

/* field assembly of xdag_create_block (client/block.c:1011-1078), wallet or pool style */
#define setfld(fldtype, src, hashtype) ( \
	b->field[0].type |= (uint64_t)(fldtype) << (i << 2), \
	memcpy(&b->field[i++], (void*)(src), sizeof(hashtype)) )

static void make_block(struct xdag_block blk[2], int header, uint64_t t, int nout, xdag_hash_t *outs,
	int nin, struct xdag_field *ins, int inkey, int defkey, int mining)
{
	struct xdag_block *b = blk;
	int i = 1, j, nkeysnum = 0, outsigkeyind = -1, keysnum[1];
	memset(blk, 0, 2 * sizeof(struct xdag_block));
	if (nin) { keysnum[0] = inkey; nkeysnum = 1; if (inkey == defkey) outsigkeyind = 0; }
	b->field[0].type = header | (mining ? (uint64_t)XDAG_FIELD_SIGN_IN << 60 : 0);
	b->field[0].time = t;
	b->field[0].amount = 0;
	for (j = 0; j < nout; j++) setfld(XDAG_FIELD_OUT, outs[j], xdag_hashlow_t);
	for (j = 0; j < nin; j++) setfld(XDAG_FIELD_IN, ins + j, xdag_hash_t);
	for (j = 0; j < nkeysnum; ++j) {
		struct xdag_public_key *key = keys + keysnum[j];
		b->field[0].type |= (uint64_t)((j == outsigkeyind ? XDAG_FIELD_SIGN_OUT : XDAG_FIELD_SIGN_IN) * 0x11) << ((i + j + nkeysnum) * 4);
		setfld(XDAG_FIELD_PUBLIC_KEY_0 + ((uintptr_t)key->pub & 1), (uintptr_t)key->pub & ~1l, xdag_hash_t);
	}
	if (outsigkeyind < 0) b->field[0].type |= (uint64_t)(XDAG_FIELD_SIGN_OUT * 0x11) << ((i + j + nkeysnum) * 4);
	xdag_hash_t sh;
	for (j = 0; j < nkeysnum; ++j, i += 2) {
		struct xdag_public_key *key = keys + keysnum[j];
		hash_for_signature(blk, key, sh);
		xdag_sign(key->key, sh, b->field[i].data, b->field[i + 1].data);
	}
	if (outsigkeyind < 0) {
		hash_for_signature(blk, keys + defkey, sh);
		xdag_sign(keys[defkey].key, sh, b->field[i].data, b->field[i + 1].data);
	}
	if (mining) for (j = 0; j < 32; j++) ((uint8_t*)b->field[15].data)[j] = (uint8_t)rand();
}

static void save(struct xdag_block *b)
{
	struct xdag_block copy = *b;
	copy.field[0].transport_header = 0;
	if (xdag_storage_save(&copy) < 0) { fprintf(stderr, "xdag_storage_save failed\n"); exit(1); }
}

static void load_key(int k, const char *h)
{
	for (int j = 0; j < 32; j++) { unsigned v; sscanf(h + 2 * j, "%2x", &v); privs[k][j] = (uint8_t)v; }
	uint8_t bit;
	/* the decrypted wallet.dat record is the big-endian scalar, read with BN_bin2bn (crypt.c:144) */
	keys[k].key = xdag_private_to_key((uint64_t*)privs[k], pubs[k], &bit);
	if (!keys[k].key) { fprintf(stderr, "bad key %d\n", k); exit(1); }
	keys[k].pub = (uint64_t*)((uintptr_t)pubs[k] | bit);
}

static void append(const char *path, const uint8_t *data, size_t n)
{
	FILE *f = fopen(path, "ab"); if (!f) { perror(path); exit(1); }
	fwrite(data, 1, n, f); fclose(f);
}

int main(int argc, char **argv)
{
	if (argc < 3 || argc - 2 > MAXKEYS) { fprintf(stderr, "usage: gen_storage <outdir> <privhex>...\n"); return 1; }
	if (xdag_crypt_init()) { fprintf(stderr, "crypt init failed\n"); return 1; }
	xdag_address_init();
	srand(12345);
	nkeys = argc - 2;
	for (int k = 0; k < nkeys; k++) load_key(k, argv[k + 2]);
	mkdir(argv[1], 0770);
	if (chdir(argv[1])) { perror(argv[1]); return 1; }
	/* a key that is not in the wallet */
	{ char fh[65]; for (int j = 0; j < 32; j++) sprintf(fh + 2 * j, "%02x", 0xa5 ^ j); load_key(nkeys, fh); }
	const int def = nkeys - 1, mid = nkeys > 2 ? 1 : 0, foreign = nkeys;

	out = fopen("expected.json", "w");
	fprintf(out, "{\"keys\":[");
	for (int k = 0; k < nkeys; k++) {
		fprintf(out, "%s{\"priv\":\"", k ? "," : ""); hex(out, privs[k], 32);
		fprintf(out, "\",\"pub\":\"%02x", 2 | (int)((uintptr_t)keys[k].pub & 1)); hex(out, pubs[k], 32);
		fprintf(out, "\"}");
	}
	fprintf(out, "],\n\"blocks\":[\n");

	struct xdag_block blk[2], first, middle;
	const uint64_t T = 0x16a00000000ull; /* April 2018, inside the mainnet era */
	char name[64];

	/* 1. wallet-mode address blocks of the default key: one low-S and one high-S signature */
	for (int n = 0, low = 0, high = 0; !(low && high) && n < 64; n++) {
		make_block(blk, XDAG_FIELD_HEAD, T + 0x123 + n, 0, 0, 0, 0, 0, def, 0);
		int hs = is_high_s((uint8_t*)blk[0].field[2].data);
		if (hs ? high : low) continue;
		if (hs) high = 1; else low = 1;
		sprintf(name, "address_default_%s", hs ? "highS" : "lowS");
		if (!low || !high) first = blk[0];
		emit(name, blk); save(blk);
	}
	/* 2. a second block in the same 64 s frame file, owned by key 0 */
	make_block(blk, XDAG_FIELD_HEAD, T + 0x123 + 80, 0, 0, 0, 0, 0, 0, 0);
	emit("address_key0_same_file", blk); save(blk);
	/* 3. the address block of the middle key (default key before a later keygen) */
	make_block(blk, XDAG_FIELD_HEAD, T + 0x20000 + 7, 0, 0, 0, 0, 0, mid, 0);
	middle = blk[0];
	emit("address_middle", blk); save(blk);
	/* 4. a transfer: IN from the middle block (signed by its key), SIGN_OUT by the default key */
	{
		struct xdag_field in[1]; xdag_hash_t h; xdag_hash(&middle, 512, h);
		memcpy(in[0].hash, h, 24); in[0].amount = 5000000000ull;
		xdag_hash_t outs[1]; xdag_hash(&first, 512, outs[0]);
		make_block(blk, XDAG_FIELD_HEAD, T + 0x30000 + 9, 1, outs, 1, in, mid, def, 0);
		emit("xfer_in_middle_out_default", blk); save(blk);
	}
	/* 5. a pool/full-node style first block: OUT links before the signature, key 0 */
	{
		xdag_hash_t outs[2]; xdag_hash(&first, 512, outs[0]); xdag_hash(&middle, 512, outs[1]);
		make_block(blk, XDAG_FIELD_HEAD, T + 0x50000 + 1, 2, outs, 0, 0, 0, 0, 0);
		emit("pool_first_key0", blk); save(blk);
	}
	/* 6. a mined main block in the same frame file: OUT links, SIGN_OUT by the default key, nonce */
	{
		xdag_hash_t outs[2]; xdag_hash(&first, 512, outs[0]); xdag_hash(&middle, 512, outs[1]);
		make_block(blk, XDAG_FIELD_HEAD, ((T >> 16) + 5) << 16 | 0xffff, 2, outs, 0, 0, 0, def, 1);
		emit("mined_default", blk); save(blk);
	}
	/* 7. somebody else's address block */
	make_block(blk, XDAG_FIELD_HEAD, T + 0x40000 + 3, 0, 0, 0, 0, 0, foreign, 0);
	emit("foreign", blk); save(blk);
	/* 8. testnet (storage-testnet/, XDAG_FIELD_HEAD_TEST) address block of key 0 */
	g_xdag_testnet = 1;
	make_block(blk, XDAG_FIELD_HEAD_TEST, T + 0x60000 + 2, 0, 0, 0, 0, 0, 0, 0);
	emit("testnet_address_key0", blk); save(blk);
	g_xdag_testnet = 0;
	fprintf(out, "\n],\n\"damaged\":[\"storage/01/6a/00/05.dat: 100 trailing bytes\",\"storage/01/6a/00/fe.dat: 512 bytes of noise\",\"storage/01/6a/00/fd.dat: empty\"]}\n");
	fclose(out);

	/* damaged files a scanner must survive */
	uint8_t junk[512];
	for (int j = 0; j < 512; j++) junk[j] = (uint8_t)(j * 37 + 11);
	append("storage/01/6a/00/05.dat", junk, 100);
	append("storage/01/6a/00/fe.dat", junk, 512);
	append("storage/01/6a/00/fd.dat", junk, 0);
	return 0;
}
