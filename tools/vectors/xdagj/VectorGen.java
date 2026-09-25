/*
 * Generates cross-implementation test vectors from the official xdagj code base
 * (https://github.com/XDagger/xdagj, io.xdag:xdagj-crypto).
 *
 * Build xdagj (mvn -DskipTests install), then run from an empty working directory:
 *   java -cp xdagj-0.8.3-executable.jar VectorGen.java > xdagj-vectors.json
 */
import io.xdag.Wallet;
import io.xdag.config.Config;
import io.xdag.config.MainnetConfig;
import io.xdag.config.TestnetConfig;
import io.xdag.core.Address;
import io.xdag.core.Block;
import io.xdag.core.XAmount;
import io.xdag.core.XUnit;
import io.xdag.core.XdagBlock;
import io.xdag.crypto.bip.Bip32Key;
import io.xdag.crypto.bip.Bip39Mnemonic;
import io.xdag.crypto.bip.Bip44Wallet;
import io.xdag.crypto.encryption.Aes;
import io.xdag.crypto.hash.HashUtils;
import io.xdag.crypto.keys.AddressUtils;
import io.xdag.crypto.keys.ECKeyPair;
import io.xdag.crypto.keys.PrivateKey;
import io.xdag.crypto.keys.PublicKey;
import io.xdag.crypto.keys.Signature;
import io.xdag.crypto.keys.Signer;
import io.xdag.utils.BasicUtils;
import io.xdag.utils.XdagTime;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import org.apache.tuweni.bytes.Bytes;
import org.apache.tuweni.bytes.Bytes32;
import org.apache.tuweni.units.bigints.UInt64;
import org.bouncycastle.crypto.generators.BCrypt;
import org.bouncycastle.util.encoders.Hex;

import static io.xdag.core.XdagField.FieldType.*;

public class VectorGen {
    static StringBuilder out = new StringBuilder();

    static String q(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20 || c > 0x7e) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    static String hex(byte[] b) { return Hex.toHexString(b); }

    static byte[] seq(int n, int start) {
        byte[] b = new byte[n];
        for (int i = 0; i < n; i++) b[i] = (byte) (start + i * 7);
        return b;
    }

    public static void main(String[] args) throws Exception {
        List<String> sections = new ArrayList<>();

        // ---- BIP39 / BIP44 ------------------------------------------------------------
        String[] mnemonics = {
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            "legal winner thank year wave sausage worth useful legal winner thank yellow",
            "void come effort suffer camp survey warrior heavy shoot primary clutch crush open amazing screen patrol group space point ten exist slush involve unfold",
        };
        List<String> hd = new ArrayList<>();
        for (String m : mnemonics) {
            // xdagj only accepts 12 words via toSeed(); the list API is plain BIP39 for any length
            byte[] seed = Bip39Mnemonic.mnemonicToSeed(java.util.Arrays.asList(m.split(" ")), "").toArrayUnsafe();
            Bip32Key master = Bip44Wallet.createMasterKey(seed);
            List<String> accts = new ArrayList<>();
            for (int i = 0; i < 3; i++) {
                ECKeyPair kp = Bip44Wallet.deriveXdagKey(master, 0, i).keyPair();
                accts.add("{\"index\":" + i + ",\"privateKey\":" + q(kp.getPrivateKey().toBytes().toUnprefixedHexString())
                    + ",\"publicKey\":" + q(kp.getPublicKey().toCompressedBytes().toUnprefixedHexString())
                    + ",\"address\":" + q(AddressUtils.toBase58Address(kp)) + "}");
            }
            hd.add("{\"mnemonic\":" + q(m) + ",\"seed\":" + q(hex(seed)) + ",\"accounts\":[" + String.join(",", accts) + "]}");
        }
        sections.add("\"hd\":[" + String.join(",", hd) + "]");

        // ---- ECDSA signatures (RFC6979, low-S) ---------------------------------------------
        List<String> sigs = new ArrayList<>();
        String[] privs = {"1f4e2d9a7c3b5e8f0a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778",
                          "00000000000000000000000000000000000000000000000000000000000000ff",
                          "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140"};
        for (String p : privs) {
            ECKeyPair kp = ECKeyPair.fromHex(p);
            for (int j = 0; j < 3; j++) {
                Bytes32 h = HashUtils.sha256(Bytes.wrap(("msg-" + p.substring(0, 6) + "-" + j).getBytes(StandardCharsets.UTF_8)));
                Signature s = Signer.sign(h, kp);
                sigs.add("{\"privateKey\":" + q(p) + ",\"publicKey\":" + q(kp.getPublicKey().toCompressedBytes().toUnprefixedHexString())
                    + ",\"address\":" + q(AddressUtils.toBase58Address(kp))
                    + ",\"hash\":" + q(h.toUnprefixedHexString()) + ",\"r\":" + q(s.getRBytes().toUnprefixedHexString())
                    + ",\"s\":" + q(s.getSBytes().toUnprefixedHexString()) + "}");
            }
        }
        sections.add("\"signatures\":[" + String.join(",", sigs) + "]");

        // ---- BouncyCastle raw BCrypt ---------------------------------------------------
        List<String> bc = new ArrayList<>();
        String[] pws = {"", "a", "password", "xdag wallet 密码", "0123456789012345678901234567890123456789012345678901234567890123456789ab"};
        int[] costs = {4, 5, 12};
        for (String pw : pws) {
            for (int cost : costs) {
                if (cost == 12 && pw.length() > 20) continue;
                byte[] salt = seq(16, pw.length() + cost);
                byte[] key = BCrypt.generate(pw.getBytes(StandardCharsets.UTF_8), salt, cost);
                bc.add("{\"password\":" + q(pw) + ",\"salt\":" + q(hex(salt)) + ",\"cost\":" + cost + ",\"key\":" + q(hex(key)) + "}");
            }
        }
        sections.add("\"bcrypt\":[" + String.join(",", bc) + "]");

        // ---- AES-CBC-PKCS7 with 24-byte keys -------------------------------------------------
        List<String> aes = new ArrayList<>();
        for (int len : new int[]{0, 1, 15, 16, 17, 32, 100}) {
            byte[] key = seq(24, len), iv = seq(16, 99 + len), raw = seq(len, 3);
            aes.add("{\"key\":" + q(hex(key)) + ",\"iv\":" + q(hex(iv)) + ",\"plain\":" + q(hex(raw))
                + ",\"cipher\":" + q(hex(Aes.encrypt(raw, key, iv))) + "}");
        }
        sections.add("\"aes\":[" + String.join(",", aes) + "]");

        // ---- wallet.data (Wallet v4) files --------------------------------------------------
        List<String> wallets = new ArrayList<>();
        String[][] wcases = {
            {"test-password-1", mnemonics[0], "2", "8c1b2a3f4e5d6c7b8a99a8b7c6d5e4f3021324354657687980a1b2c3d4e5f607"},
            {"中文密码 & ünïcödé", mnemonics[1], "1", ""},
            {"", "", "0", "1f4e2d9a7c3b5e8f0a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778"},
        };
        for (String[] wc : wcases) {
            Path dir = Files.createTempDirectory("xdagj-wallet");
            Config cfg = new MainnetConfig() {
                @Override
                public io.xdag.config.spec.WalletSpec getWalletSpec() {
                    io.xdag.config.spec.WalletSpec base = super.getWalletSpec();
                    return new io.xdag.config.spec.WalletSpec() {
                        public String getWalletKeyFile() { return base.getWalletKeyFile(); }
                        public String getWalletFilePath() { return dir.resolve("wallet.data").toString(); }
                    };
                }
            };
            Wallet w = new Wallet(cfg);
            if (!w.unlock(wc[0])) throw new IllegalStateException("unlock");
            List<String> expected = new ArrayList<>();
            if (!wc[1].isEmpty()) {
                w.initializeHdWallet(wc[1]);
                for (int i = 0; i < Integer.parseInt(wc[2]); i++) w.addAccountWithNextHdKey();
            }
            if (!wc[3].isEmpty()) w.addAccount(ECKeyPair.fromHex(wc[3]));
            for (ECKeyPair kp : w.getAccounts()) {
                expected.add("{\"privateKey\":" + q(kp.getPrivateKey().toBytes().toUnprefixedHexString()) + ",\"address\":" + q(AddressUtils.toBase58Address(kp)) + "}");
            }
            if (!w.flush()) throw new IllegalStateException("flush");
            byte[] data = Files.readAllBytes(dir.resolve("wallet.data"));
            Wallet check = new Wallet(cfg);
            if (!check.unlock(wc[0]) || check.getAccounts().size() != expected.size()) throw new IllegalStateException("reopen");
            if (check.unlock(wc[0] + "x")) throw new IllegalStateException("wrong password accepted");
            wallets.add("{\"password\":" + q(wc[0]) + ",\"mnemonic\":" + q(wc[1]) + ",\"nextAccountIndex\":" + wc[2]
                + ",\"file\":" + q(Base64.getEncoder().encodeToString(data)) + ",\"accounts\":[" + String.join(",", expected) + "]}");
        }
        sections.add("\"walletFiles\":[" + String.join(",", wallets) + "]");

        // ---- transaction blocks ------------------------------------------------------------
        List<String> txs = new ArrayList<>();
        Config main = new MainnetConfig();
        Config test = new TestnetConfig();
        ECKeyPair k1 = ECKeyPair.fromHex(privs[0]);
        ECKeyPair k2 = ECKeyPair.fromHex("8c1b2a3f4e5d6c7b8a99a8b7c6d5e4f3021324354657687980a1b2c3d4e5f607");
        String toAddr = AddressUtils.toBase58Address(k2);
        Object[][] tcases = {
            // net, key, amount, remark, nonce, feeNano, timeMs
            {"mainnet", k1, "12.5", null, 1L, 0L, 1758800000123L},
            {"mainnet", k1, "0.123456789", "hello xdag", 42L, 0L, 1758800001999L},
            {"mainnet", k2, "1000000", null, 7L, 250000000L, 1758800002500L},
            {"testnet", k2, "3.3", "memo", 3L, 50000000L, 1758800003700L},
            {"mainnet", k1, "99.999999999", "0123456789012345678901234567890123456789", 12345678901L, 1L, 1758800004000L},
        };
        for (Object[] tc : tcases) {
            Config cfg = tc[0].equals("mainnet") ? main : test;
            ECKeyPair key = (ECKeyPair) tc[1];
            XAmount amount = XAmount.of(new BigDecimal((String) tc[2]), XUnit.XDAG);
            String remark = (String) tc[3];
            UInt64 nonce = UInt64.valueOf((Long) tc[4]);
            XAmount fee = XAmount.of((Long) tc[5], XUnit.NANO_XDAG);
            long ts = XdagTime.msToXdagtimestamp((Long) tc[6]);
            ECKeyPair toKey = key == k1 ? k2 : k1;
            Address from = new Address(BasicUtils.keyPair2Hash(key), XDAG_FIELD_INPUT, amount, true);
            Address to = new Address(BasicUtils.keyPair2Hash(toKey), XDAG_FIELD_OUTPUT, amount, true);
            Block block = new Block(cfg, ts, List.of(from, to), null, false, List.of(key), remark, 0, fee, nonce);
            block.signOut(key);
            byte[] raw = block.toBytes();
            Block parsed = new Block(new XdagBlock(raw));
            if (parsed.verifiedKeys().isEmpty()) throw new IllegalStateException("signature does not verify");
            txs.add("{\"kind\":\"account\",\"network\":" + q((String) tc[0]) + ",\"privateKey\":" + q(key.getPrivateKey().toBytes().toUnprefixedHexString())
                + ",\"from\":" + q(AddressUtils.toBase58Address(key)) + ",\"to\":" + q(AddressUtils.toBase58Address(toKey))
                + ",\"amount\":" + q((String) tc[2]) + ",\"remark\":" + (remark == null ? "null" : q(remark))
                + ",\"nonce\":" + q(tc[4].toString()) + ",\"feeNano\":" + q(tc[5].toString()) + ",\"timeMs\":" + tc[6]
                + ",\"xdagTime\":" + q(Long.toUnsignedString(ts)) + ",\"raw\":" + q(hex(raw))
                + ",\"hash\":" + q(parsed.getHash().toUnprefixedHexString()) + ",\"blockAddress\":" + q(BasicUtils.hash2Address(parsed.getHash())) + "}");
        }
        // legacy block-address input (XDAG_FIELD_IN), no nonce: what "xfertonew" builds
        String[] oldAddrs = {"gKNRtSL1pUaTpzMuPMznKw49ILtP6qX3", "PKcBtHWDSnAWfZntqWPBLedqBShuKSTz"};
        int li = 0;
        for (String oldAddr : oldAddrs) {
            ECKeyPair key = li == 0 ? k1 : k2;
            String amt = li == 0 ? "1024.000000001" : "0.5";
            String remark = li == 0 ? "block balance to new address" : null;
            XAmount amount = XAmount.of(new BigDecimal(amt), XUnit.XDAG);
            long ts = XdagTime.msToXdagtimestamp(1758800005000L + li);
            Address from = new Address(BasicUtils.address2Hash(oldAddr), XDAG_FIELD_IN, amount, false);
            Address to = new Address(BasicUtils.keyPair2Hash(key), XDAG_FIELD_OUTPUT, amount, true);
            Block block = new Block(main, ts, List.of(from, to), null, false, List.of(key), remark, 0, XAmount.ZERO, null);
            block.signOut(key);
            byte[] raw = block.toBytes();
            Block parsed = new Block(new XdagBlock(raw));
            if (parsed.verifiedKeys().isEmpty()) throw new IllegalStateException("signature does not verify");
            txs.add("{\"kind\":\"legacy\",\"network\":\"mainnet\",\"privateKey\":" + q(key.getPrivateKey().toBytes().toUnprefixedHexString())
                + ",\"from\":" + q(oldAddr) + ",\"to\":" + q(AddressUtils.toBase58Address(key))
                + ",\"amount\":" + q(amt) + ",\"remark\":" + (remark == null ? "null" : q(remark))
                + ",\"nonce\":null,\"feeNano\":\"0\",\"timeMs\":" + (1758800005000L + li)
                + ",\"xdagTime\":" + q(Long.toUnsignedString(ts)) + ",\"raw\":" + q(hex(raw))
                + ",\"hash\":" + q(parsed.getHash().toUnprefixedHexString()) + ",\"blockAddress\":" + q(BasicUtils.hash2Address(parsed.getHash())) + "}");
            li++;
        }
        sections.add("\"transactions\":[" + String.join(",", txs) + "]");

        // ---- amount conversions -------------------------------------------------------------
        List<String> amts = new ArrayList<>();
        for (String a : new String[]{"0", "0.1", "0.000000001", "1", "12.5", "0.123456789", "99.999999999", "1000000", "1024.000000001", "1446294144.123456789", "3.3"}) {
            XAmount x = XAmount.of(new BigDecimal(a), XUnit.XDAG);
            UInt64 c = x.toXAmount();
            amts.add("{\"xdag\":" + q(a) + ",\"nano\":" + q(x.toString()) + ",\"cheato\":" + q(c.toBigInteger().toString())
                + ",\"back\":" + q(XAmount.ofXAmount(c.toLong()).toDecimal(9, XUnit.XDAG).toPlainString()) + "}");
        }
        sections.add("\"amounts\":[" + String.join(",", amts) + "]");

        System.out.println("{" + String.join(",\n", sections) + "}");
    }
}
