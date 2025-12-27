/**
 * Security Tests - Cryptographic Operations
 */

const crypto = require('crypto');

describe('Cryptographic Security', () => {
  describe('AES Encryption', () => {
    const encrypt = (plaintext: string, key: Buffer): { ciphertext: string; iv: string } => {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const tag = cipher.getAuthTag().toString('hex');
      return {
        ciphertext: encrypted + ':' + tag,
        iv: iv.toString('hex'),
      };
    };

    const decrypt = (ciphertext: string, iv: string, key: Buffer): string => {
      const [encrypted, tag] = ciphertext.split(':');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
      decipher.setAuthTag(Buffer.from(tag!, 'hex'));
      let decrypted = decipher.update(encrypted!, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    };

    const key = crypto.randomBytes(32);

    it('should encrypt plaintext', () => {
      const { ciphertext, iv } = encrypt('secret message', key);
      expect(ciphertext).not.toBe('secret message');
      expect(iv).toHaveLength(32);
    });

    it('should decrypt ciphertext', () => {
      const { ciphertext, iv } = encrypt('secret message', key);
      const decrypted = decrypt(ciphertext, iv, key);
      expect(decrypted).toBe('secret message');
    });

    it('should produce different ciphertext each time', () => {
      const e1 = encrypt('same message', key);
      const e2 = encrypt('same message', key);
      expect(e1.ciphertext).not.toBe(e2.ciphertext);
    });

    it('should fail with wrong key', () => {
      const wrongKey = crypto.randomBytes(32);
      const { ciphertext, iv } = encrypt('secret', key);
      expect(() => decrypt(ciphertext, iv, wrongKey)).toThrow();
    });

    it('should fail with wrong IV', () => {
      const { ciphertext } = encrypt('secret', key);
      const wrongIv = crypto.randomBytes(16).toString('hex');
      expect(() => decrypt(ciphertext, wrongIv, key)).toThrow();
    });

    it('should fail with tampered ciphertext', () => {
      const { ciphertext, iv } = encrypt('secret', key);
      const [encrypted, tag] = ciphertext.split(':');
      const tampered = 'ff' + encrypted!.slice(2) + ':' + tag;
      expect(() => decrypt(tampered, iv, key)).toThrow();
    });

    it('should handle empty string', () => {
      const { ciphertext, iv } = encrypt('', key);
      const decrypted = decrypt(ciphertext, iv, key);
      expect(decrypted).toBe('');
    });

    it('should handle unicode', () => {
      const { ciphertext, iv } = encrypt('こんにちは 🎉', key);
      const decrypted = decrypt(ciphertext, iv, key);
      expect(decrypted).toBe('こんにちは 🎉');
    });

    it('should handle large data', () => {
      const largeData = 'x'.repeat(1000000);
      const { ciphertext, iv } = encrypt(largeData, key);
      const decrypted = decrypt(ciphertext, iv, key);
      expect(decrypted).toBe(largeData);
    });
  });

  describe('RSA Encryption', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });

    it('should encrypt with public key', () => {
      const encrypted = crypto.publicEncrypt(
        publicKey,
        Buffer.from('secret')
      );
      expect(encrypted).toBeInstanceOf(Buffer);
    });

    it('should decrypt with private key', () => {
      const encrypted = crypto.publicEncrypt(
        publicKey,
        Buffer.from('secret message')
      );
      const decrypted = crypto.privateDecrypt(
        privateKey,
        encrypted
      );
      expect(decrypted.toString()).toBe('secret message');
    });

    it('should fail decrypt with wrong key', () => {
      const { publicKey: otherPub } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      const encrypted = crypto.publicEncrypt(
        publicKey,
        Buffer.from('secret')
      );
      expect(() =>
        crypto.privateDecrypt(otherPub, encrypted)
      ).toThrow();
    });
  });

  describe('Digital Signatures', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

    it('should sign data', () => {
      const signature = crypto.sign(null, Buffer.from('data'), privateKey);
      expect(signature).toBeInstanceOf(Buffer);
    });

    it('should verify valid signature', () => {
      const data = Buffer.from('important data');
      const signature = crypto.sign(null, data, privateKey);
      const valid = crypto.verify(null, data, publicKey, signature);
      expect(valid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const data = Buffer.from('data');
      const signature = crypto.sign(null, data, privateKey);
      const tampered = Buffer.from('tampered data');
      const valid = crypto.verify(null, tampered, publicKey, signature);
      expect(valid).toBe(false);
    });

    it('should reject signature with wrong key', () => {
      const { publicKey: otherPub } = crypto.generateKeyPairSync('ed25519');
      const data = Buffer.from('data');
      const signature = crypto.sign(null, data, privateKey);
      const valid = crypto.verify(null, data, otherPub, signature);
      expect(valid).toBe(false);
    });
  });

  describe('Key Derivation', () => {
    it('should derive key from password', () => {
      const password = 'user-password';
      const salt = crypto.randomBytes(16);
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      expect(key).toHaveLength(32);
    });

    it('should produce same key with same inputs', () => {
      const password = 'password';
      const salt = Buffer.from('fixed-salt-value');
      const key1 = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      const key2 = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
      expect(key1.equals(key2)).toBe(true);
    });

    it('should produce different key with different salt', () => {
      const password = 'password';
      const key1 = crypto.pbkdf2Sync(password, 'salt1', 100000, 32, 'sha256');
      const key2 = crypto.pbkdf2Sync(password, 'salt2', 100000, 32, 'sha256');
      expect(key1.equals(key2)).toBe(false);
    });

    it('should produce different key with different password', () => {
      const salt = 'fixed-salt';
      const key1 = crypto.pbkdf2Sync('password1', salt, 100000, 32, 'sha256');
      const key2 = crypto.pbkdf2Sync('password2', salt, 100000, 32, 'sha256');
      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe('Secure Random', () => {
    it('should generate random bytes', () => {
      const bytes = crypto.randomBytes(32);
      expect(bytes).toHaveLength(32);
    });

    it('should produce different values each time', () => {
      const b1 = crypto.randomBytes(32).toString('hex');
      const b2 = crypto.randomBytes(32).toString('hex');
      expect(b1).not.toBe(b2);
    });

    it('should generate random UUID', () => {
      const uuid = crypto.randomUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('should generate random integers', () => {
      const int = crypto.randomInt(0, 1000);
      expect(int).toBeGreaterThanOrEqual(0);
      expect(int).toBeLessThan(1000);
    });

    it('should have uniform distribution', () => {
      const counts = new Array(10).fill(0);
      for (let i = 0; i < 10000; i++) {
        const bucket = crypto.randomInt(0, 10);
        counts[bucket]++;
      }
      // Each bucket should have roughly 1000 (with some variance)
      for (const count of counts) {
        expect(count).toBeGreaterThan(800);
        expect(count).toBeLessThan(1200);
      }
    });
  });

  describe('Hash Functions', () => {
    it('should produce SHA-256 hash', () => {
      const hash = crypto.createHash('sha256').update('data').digest('hex');
      expect(hash).toHaveLength(64);
    });

    it('should produce SHA-512 hash', () => {
      const hash = crypto.createHash('sha512').update('data').digest('hex');
      expect(hash).toHaveLength(128);
    });

    it('should produce consistent hash', () => {
      const h1 = crypto.createHash('sha256').update('data').digest('hex');
      const h2 = crypto.createHash('sha256').update('data').digest('hex');
      expect(h1).toBe(h2);
    });

    it('should produce different hash for different input', () => {
      const h1 = crypto.createHash('sha256').update('data1').digest('hex');
      const h2 = crypto.createHash('sha256').update('data2').digest('hex');
      expect(h1).not.toBe(h2);
    });

    it('should handle streaming updates', () => {
      const hash = crypto.createHash('sha256');
      hash.update('part1');
      hash.update('part2');
      const result = hash.digest('hex');
      const expected = crypto.createHash('sha256').update('part1part2').digest('hex');
      expect(result).toBe(expected);
    });
  });

  describe('HMAC', () => {
    it('should create HMAC', () => {
      const hmac = crypto.createHmac('sha256', 'secret').update('data').digest('hex');
      expect(hmac).toHaveLength(64);
    });

    it('should verify HMAC', () => {
      const key = 'secret';
      const data = 'message';
      const hmac = crypto.createHmac('sha256', key).update(data).digest('hex');
      const verify = crypto.createHmac('sha256', key).update(data).digest('hex');
      expect(hmac).toBe(verify);
    });

    it('should fail with wrong key', () => {
      const data = 'message';
      const hmac = crypto.createHmac('sha256', 'key1').update(data).digest('hex');
      const verify = crypto.createHmac('sha256', 'key2').update(data).digest('hex');
      expect(hmac).not.toBe(verify);
    });

    it('should fail with wrong data', () => {
      const key = 'secret';
      const hmac = crypto.createHmac('sha256', key).update('data1').digest('hex');
      const verify = crypto.createHmac('sha256', key).update('data2').digest('hex');
      expect(hmac).not.toBe(verify);
    });
  });

  describe('Constant-Time Comparison', () => {
    const timingSafeEqual = (a: Buffer, b: Buffer): boolean => {
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    };

    it('should return true for equal buffers', () => {
      const a = Buffer.from('same');
      const b = Buffer.from('same');
      expect(timingSafeEqual(a, b)).toBe(true);
    });

    it('should return false for different buffers', () => {
      const a = Buffer.from('same');
      const b = Buffer.from('diff');
      expect(timingSafeEqual(a, b)).toBe(false);
    });

    it('should return false for different lengths', () => {
      const a = Buffer.from('short');
      const b = Buffer.from('longer');
      expect(timingSafeEqual(a, b)).toBe(false);
    });
  });

  describe('Secret Key Generation', () => {
    it('should generate 128-bit key', () => {
      const key = crypto.randomBytes(16);
      expect(key).toHaveLength(16);
    });

    it('should generate 256-bit key', () => {
      const key = crypto.randomBytes(32);
      expect(key).toHaveLength(32);
    });

    it('should generate 512-bit key', () => {
      const key = crypto.randomBytes(64);
      expect(key).toHaveLength(64);
    });

    it('should be cryptographically random', () => {
      // Check entropy (should have roughly equal byte distribution)
      const key = crypto.randomBytes(1024);
      const counts = new Array(256).fill(0);
      for (const byte of key) {
        counts[byte]++;
      }
      const expected = 1024 / 256; // ~4
      const variance = counts.reduce((sum, c) => sum + Math.pow(c - expected, 2), 0) / 256;
      expect(variance).toBeLessThan(10); // Low variance indicates good distribution
    });
  });

  describe('Nonce Generation', () => {
    it('should generate unique nonces', () => {
      const nonces = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        nonces.add(crypto.randomBytes(16).toString('hex'));
      }
      expect(nonces.size).toBe(1000);
    });

    it('should have sufficient length', () => {
      const nonce = crypto.randomBytes(12); // GCM nonce
      expect(nonce).toHaveLength(12);
    });
  });

  describe('Salt Generation', () => {
    it('should generate unique salts', () => {
      const salts = new Set<string>();
      for (let i = 0; i < 100; i++) {
        salts.add(crypto.randomBytes(16).toString('hex'));
      }
      expect(salts.size).toBe(100);
    });

    it('should have recommended length', () => {
      const salt = crypto.randomBytes(16);
      expect(salt.length).toBeGreaterThanOrEqual(16);
    });
  });

  describe('Encoding', () => {
    it('should encode to base64', () => {
      const data = Buffer.from('test data');
      const encoded = data.toString('base64');
      expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('should decode from base64', () => {
      const encoded = 'dGVzdCBkYXRh';
      const decoded = Buffer.from(encoded, 'base64').toString();
      expect(decoded).toBe('test data');
    });

    it('should encode to base64url', () => {
      const data = Buffer.from('test data');
      const encoded = data.toString('base64url');
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
    });

    it('should encode to hex', () => {
      const data = Buffer.from('test');
      const encoded = data.toString('hex');
      expect(encoded).toBe('74657374');
    });

    it('should decode from hex', () => {
      const decoded = Buffer.from('74657374', 'hex').toString();
      expect(decoded).toBe('test');
    });
  });

  describe('Cipher Modes', () => {
    const key = crypto.randomBytes(32);

    it('should use GCM mode (authenticated)', () => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update('data', 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const tag = cipher.getAuthTag();
      expect(tag).toHaveLength(16);
    });

    it('should use CBC mode', () => {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      let encrypted = cipher.update('data', 'utf8', 'hex');
      encrypted += cipher.final('hex');
      expect(encrypted).toBeTruthy();
    });

    it('should use CTR mode', () => {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
      let encrypted = cipher.update('data', 'utf8', 'hex');
      encrypted += cipher.final('hex');
      expect(encrypted).toBeTruthy();
    });
  });

  describe('Key Exchange', () => {
    it('should generate ECDH keys', () => {
      const ecdh = crypto.createECDH('secp256k1');
      ecdh.generateKeys();
      expect(ecdh.getPublicKey()).toBeTruthy();
      expect(ecdh.getPrivateKey()).toBeTruthy();
    });

    it('should derive shared secret', () => {
      const alice = crypto.createECDH('secp256k1');
      const bob = crypto.createECDH('secp256k1');

      alice.generateKeys();
      bob.generateKeys();

      const aliceSecret = alice.computeSecret(bob.getPublicKey());
      const bobSecret = bob.computeSecret(alice.getPublicKey());

      expect(aliceSecret.equals(bobSecret)).toBe(true);
    });

    it('should produce different secrets with different keys', () => {
      const alice = crypto.createECDH('secp256k1');
      const bob = crypto.createECDH('secp256k1');
      const eve = crypto.createECDH('secp256k1');

      alice.generateKeys();
      bob.generateKeys();
      eve.generateKeys();

      const aliceBobSecret = alice.computeSecret(bob.getPublicKey());
      const aliceEveSecret = alice.computeSecret(eve.getPublicKey());

      expect(aliceBobSecret.equals(aliceEveSecret)).toBe(false);
    });
  });
});
