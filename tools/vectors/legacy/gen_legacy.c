/*
 * Reference generator for 2018 XDAG C-client wallet files (dnet_key.dat + wallet.dat).
 *
 * It links the original dfslib sources from https://github.com/XDagger/xdag
 * (dfslib/dfslib_crypt.c, dfslib/dfslib_string.c, dfslib/dfsrsa.c) and reproduces
 * the exact file-creation path of dnet/dnet_crypt.c::dnet_crypt_init() and
 * client/wallet.c::add_key(), with deterministic randomness so the output can be
 * used as test fixtures for the JavaScript port.
 *
 * Usage: gen_legacy <outdir> <password> <keylen_words 256|64> <privhex>...
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "dfslib_crypt.h"
#include "dfslib_string.h"
#include "dfsrsa.h"

#define DNET_KEYLEN 256
struct dnet_keys { uint32_t priv[DNET_KEYLEN]; uint32_t pub[DNET_KEYLEN]; };

static struct dfslib_crypt *g_crypt = 0;

/* verbatim copy of set_user_crypt() from dnet/dnet_crypt.c */
static int set_user_crypt(struct dfslib_string *pwd)
{
	uint32_t sector0[128];
	int i;
	g_crypt = malloc(sizeof(struct dfslib_crypt));
	if(!g_crypt) return -1;
	memset(g_crypt->pwd, 0, sizeof(g_crypt->pwd));
	dfslib_crypt_set_password(g_crypt, pwd);
	for(i = 0; i < 128; ++i) {
		sector0[i] = 0x4ab29f51u + i * 0xc3807e6du;
	}
	for(i = 0; i < 128; ++i) {
		dfslib_crypt_set_sector0(g_crypt, sector0);
		dfslib_encrypt_sector(g_crypt, sector0, 0x3e9c1d624a8b570full + i * 0x9d2e61fc538704abull);
	}
	return 0;
}

static void dnet_make_key(uint32_t *key, int keylen)
{
	unsigned i;
	for(i = keylen; i < DNET_KEYLEN; i += keylen) memcpy(key + i, key, keylen * sizeof(uint32_t));
}

static int hexval(char c) { return c <= '9' ? c - '0' : (c | 0x20) - 'a' + 10; }

int main(int argc, char **argv)
{
	if (argc < 5) { fprintf(stderr, "usage\n"); return 1; }
	const char *dir = argv[1], *pwd = argv[2];
	int keylen = atoi(argv[3]);
	char path[1024];
	struct dnet_keys keys;
	struct dfslib_string str;
	uint32_t seed = 0x12345678u;

	dfslib_utf8_string(&str, pwd, strlen(pwd));
	if (str.len) set_user_crypt(&str);

	/* deterministic "random keys" prefill of the public key array */
	for (int i = 0; i < DNET_KEYLEN; ++i) { seed = seed * 1103515245u + 12345u; keys.pub[i] = seed ^ (seed << 13); }
	memset(keys.priv, 0, sizeof keys.priv);
	if (dfsrsa_keygen(keys.priv, keys.pub, keylen)) { fprintf(stderr, "keygen failed\n"); return 2; }
	dnet_make_key(keys.priv, keylen);
	dnet_make_key(keys.pub, keylen);

	if (g_crypt) for (int i = 0; i < (int)(sizeof(keys) >> 9); ++i)
		dfslib_encrypt_sector(g_crypt, (uint32_t *)&keys + 128 * i, ~(uint64_t)i);
	snprintf(path, sizeof path, "%s/dnet_key.dat", dir);
	FILE *f = fopen(path, "wb"); fwrite(&keys, sizeof keys, 1, f); fclose(f);

	snprintf(path, sizeof path, "%s/wallet.dat", dir);
	f = fopen(path, "wb");
	for (int n = 0; n < argc - 4; ++n) {
		uint8_t priv[32]; uint32_t priv32[8];
		const char *h = argv[4 + n];
		/* client/crypt.c stores the key with BN_bn2bin(), i.e. big-endian */
		for (int i = 0; i < 32; ++i) priv[i] = hexval(h[2 * i]) << 4 | hexval(h[2 * i + 1]);
		memcpy(priv32, priv, 32);
		if (g_crypt) dfslib_encrypt_array(g_crypt, priv32, 8, n);
		fwrite(priv32, 32, 1, f);
	}
	fclose(f);
	printf("ok ispwd=%d\n", g_crypt ? (int)g_crypt->ispwd : 0);
	return 0;
}
