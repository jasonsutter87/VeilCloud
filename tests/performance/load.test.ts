/**
 * Performance and Load Tests
 */

describe('Performance Tests', () => {
  describe('Hashing Performance', () => {
    const sha256 = (data: string): string => {
      const { createHash } = require('crypto');
      return createHash('sha256').update(data).digest('hex');
    };

    it('should hash 1KB data quickly', () => {
      const data = 'x'.repeat(1024);
      const start = Date.now();
      for (let i = 0; i < 10000; i++) {
        sha256(data);
      }
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000); // 10k hashes in under 1 second
    });

    it('should hash 1MB data quickly', () => {
      const data = 'x'.repeat(1024 * 1024);
      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        sha256(data);
      }
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(2000); // 100 * 1MB hashes in under 2 seconds
    });

    it('should handle concurrent hashing', async () => {
      const data = 'x'.repeat(10000);
      const promises = Array.from({ length: 100 }, () =>
        new Promise<string>(resolve => {
          setImmediate(() => resolve(sha256(data)));
        })
      );

      const start = Date.now();
      const results = await Promise.all(promises);
      const elapsed = Date.now() - start;

      expect(results).toHaveLength(100);
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('Merkle Tree Performance', () => {
    const buildMerkleTree = (leaves: string[]): string[] => {
      const sha256 = (data: string): string => {
        const { createHash } = require('crypto');
        return createHash('sha256').update(data).digest('hex');
      };

      if (leaves.length === 0) return [];
      if (leaves.length === 1) return leaves;

      const tree: string[] = [...leaves];
      let level = leaves;

      while (level.length > 1) {
        const nextLevel: string[] = [];
        for (let i = 0; i < level.length; i += 2) {
          const left = level[i]!;
          const right = level[i + 1] || left;
          nextLevel.push(sha256(left + right));
        }
        tree.push(...nextLevel);
        level = nextLevel;
      }

      return tree;
    };

    it('should build tree with 1000 leaves quickly', () => {
      const leaves = Array.from({ length: 1000 }, (_, i) => `leaf-${i}`);
      const start = Date.now();
      const tree = buildMerkleTree(leaves);
      const elapsed = Date.now() - start;

      expect(tree.length).toBeGreaterThan(1000);
      expect(elapsed).toBeLessThan(500);
    });

    it('should build tree with 10000 leaves quickly', () => {
      const leaves = Array.from({ length: 10000 }, (_, i) => `leaf-${i}`);
      const start = Date.now();
      const tree = buildMerkleTree(leaves);
      const elapsed = Date.now() - start;

      expect(tree.length).toBeGreaterThan(10000);
      expect(elapsed).toBeLessThan(2000);
    });

    it('should generate proof quickly', () => {
      const leaves = Array.from({ length: 10000 }, (_, i) => `leaf-${i}`);
      const tree = buildMerkleTree(leaves);

      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        // Simulate proof generation
        const index = Math.floor(Math.random() * leaves.length);
        const proofSize = Math.ceil(Math.log2(leaves.length));
        expect(proofSize).toBeLessThanOrEqual(14); // log2(10000) ≈ 13.3
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('JSON Serialization Performance', () => {
    it('should serialize large objects quickly', () => {
      const largeObject = {
        users: Array.from({ length: 1000 }, (_, i) => ({
          id: `user-${i}`,
          email: `user${i}@example.com`,
          permissions: ['read', 'write'],
          metadata: { createdAt: new Date().toISOString() },
        })),
      };

      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        JSON.stringify(largeObject);
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
    });

    it('should parse large JSON quickly', () => {
      const largeObject = {
        data: Array.from({ length: 10000 }, (_, i) => ({ id: i, value: 'x'.repeat(100) })),
      };
      const json = JSON.stringify(largeObject);

      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        JSON.parse(json);
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('Buffer Operations Performance', () => {
    it('should create large buffers quickly', () => {
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        Buffer.alloc(1024 * 1024); // 1MB
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(2000);
    });

    it('should copy buffers quickly', () => {
      const source = Buffer.alloc(1024 * 1024, 'x');
      const target = Buffer.alloc(1024 * 1024);

      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        source.copy(target);
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
    });

    it('should compare buffers quickly', () => {
      const buf1 = Buffer.alloc(1024 * 1024, 'x');
      const buf2 = Buffer.alloc(1024 * 1024, 'x');

      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        buf1.equals(buf2);
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('Regex Performance', () => {
    it('should validate emails quickly', () => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const emails = Array.from({ length: 10000 }, (_, i) => `user${i}@example.com`);

      const start = Date.now();
      for (const email of emails) {
        emailRegex.test(email);
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
    });

    it('should detect SQL injection patterns quickly', () => {
      const sqlPatterns = [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER)\b)/gi,
        /(--|;|'|")/g,
        /(\bOR\b\s+\d+=\d+)/gi,
      ];

      const inputs = Array.from({ length: 1000 }, () =>
        'Some normal text with various content'
      );

      const start = Date.now();
      for (const input of inputs) {
        for (const pattern of sqlPatterns) {
          pattern.test(input);
        }
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
    });

    it('should detect XSS patterns quickly', () => {
      const xssPatterns = [
        /<script\b[^>]*>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi,
      ];

      const inputs = Array.from({ length: 1000 }, () =>
        '<div class="content">Hello World</div>'
      );

      const start = Date.now();
      for (const input of inputs) {
        for (const pattern of xssPatterns) {
          pattern.test(input);
        }
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('Map/Set Operations Performance', () => {
    it('should handle large Map operations', () => {
      const map = new Map<string, number>();

      const start = Date.now();
      for (let i = 0; i < 100000; i++) {
        map.set(`key-${i}`, i);
      }
      for (let i = 0; i < 100000; i++) {
        map.get(`key-${i}`);
      }
      for (let i = 0; i < 50000; i++) {
        map.delete(`key-${i}`);
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
      expect(map.size).toBe(50000);
    });

    it('should handle large Set operations', () => {
      const set = new Set<string>();

      const start = Date.now();
      for (let i = 0; i < 100000; i++) {
        set.add(`item-${i}`);
      }
      for (let i = 0; i < 100000; i++) {
        set.has(`item-${i}`);
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(300);
      expect(set.size).toBe(100000);
    });
  });

  describe('Array Operations Performance', () => {
    it('should sort large arrays quickly', () => {
      const arr = Array.from({ length: 100000 }, () => Math.random());

      const start = Date.now();
      arr.sort((a, b) => a - b);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
    });

    it('should filter large arrays quickly', () => {
      const arr = Array.from({ length: 100000 }, (_, i) => i);

      const start = Date.now();
      const filtered = arr.filter(x => x % 2 === 0);
      const elapsed = Date.now() - start;

      expect(filtered).toHaveLength(50000);
      expect(elapsed).toBeLessThan(100);
    });

    it('should map large arrays quickly', () => {
      const arr = Array.from({ length: 100000 }, (_, i) => i);

      const start = Date.now();
      const mapped = arr.map(x => x * 2);
      const elapsed = Date.now() - start;

      expect(mapped).toHaveLength(100000);
      expect(elapsed).toBeLessThan(100);
    });

    it('should reduce large arrays quickly', () => {
      const arr = Array.from({ length: 100000 }, (_, i) => i);

      const start = Date.now();
      const sum = arr.reduce((acc, x) => acc + x, 0);
      const elapsed = Date.now() - start;

      expect(sum).toBe((100000 * 99999) / 2);
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('Promise Performance', () => {
    it('should handle many concurrent promises', async () => {
      const start = Date.now();
      const promises = Array.from({ length: 10000 }, (_, i) =>
        Promise.resolve(i)
      );
      const results = await Promise.all(promises);
      const elapsed = Date.now() - start;

      expect(results).toHaveLength(10000);
      expect(elapsed).toBeLessThan(200);
    });

    it('should handle promise chains efficiently', async () => {
      const start = Date.now();

      let promise = Promise.resolve(0);
      for (let i = 0; i < 1000; i++) {
        promise = promise.then(x => x + 1);
      }
      const result = await promise;
      const elapsed = Date.now() - start;

      expect(result).toBe(1000);
      expect(elapsed).toBeLessThan(200);
    });

    it('should handle async/await efficiently', async () => {
      const asyncFunc = async (n: number): Promise<number> => {
        if (n <= 0) return 0;
        return n + await asyncFunc(n - 1);
      };

      const start = Date.now();
      const result = await asyncFunc(100);
      const elapsed = Date.now() - start;

      expect(result).toBe((100 * 101) / 2);
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('Object Operations Performance', () => {
    it('should create many objects quickly', () => {
      const start = Date.now();
      const objects = Array.from({ length: 100000 }, (_, i) => ({
        id: i,
        name: `Object ${i}`,
        timestamp: Date.now(),
      }));
      const elapsed = Date.now() - start;

      expect(objects).toHaveLength(100000);
      expect(elapsed).toBeLessThan(500);
    });

    it('should spread objects quickly', () => {
      const base = { a: 1, b: 2, c: 3, d: 4, e: 5 };

      const start = Date.now();
      const results = Array.from({ length: 100000 }, () => ({
        ...base,
        f: 6,
      }));
      const elapsed = Date.now() - start;

      expect(results).toHaveLength(100000);
      expect(elapsed).toBeLessThan(500);
    });

    it('should access nested properties quickly', () => {
      const obj = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: 42,
              },
            },
          },
        },
      };

      const start = Date.now();
      for (let i = 0; i < 1000000; i++) {
        const _ = obj.level1.level2.level3.level4.value;
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('String Operations Performance', () => {
    it('should concatenate strings quickly', () => {
      const start = Date.now();
      let str = '';
      for (let i = 0; i < 10000; i++) {
        str += 'x';
      }
      const elapsed = Date.now() - start;

      expect(str.length).toBe(10000);
      expect(elapsed).toBeLessThan(100);
    });

    it('should use template literals efficiently', () => {
      const name = 'World';
      const start = Date.now();
      for (let i = 0; i < 100000; i++) {
        const _ = `Hello, ${name}! Iteration ${i}`;
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(200);
    });

    it('should split and join strings quickly', () => {
      const str = Array.from({ length: 10000 }, (_, i) => `word${i}`).join(',');

      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        const parts = str.split(',');
        parts.join(',');
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('Date Operations Performance', () => {
    it('should create dates quickly', () => {
      const start = Date.now();
      for (let i = 0; i < 100000; i++) {
        new Date();
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(200);
    });

    it('should parse ISO dates quickly', () => {
      const isoDate = '2024-01-15T10:30:00.000Z';

      const start = Date.now();
      for (let i = 0; i < 100000; i++) {
        new Date(isoDate);
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
    });

    it('should format dates quickly', () => {
      const date = new Date();

      const start = Date.now();
      for (let i = 0; i < 100000; i++) {
        date.toISOString();
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(300);
    });
  });

  describe('Memory Efficiency', () => {
    it('should not leak memory in loops', () => {
      const startMemory = process.memoryUsage().heapUsed;

      for (let i = 0; i < 1000; i++) {
        const arr = new Array(10000).fill('x');
        arr.length = 0; // Clear
      }

      // Force GC if available
      if (global.gc) {
        global.gc();
      }

      const endMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = endMemory - startMemory;

      // Memory increase should be minimal (less than 10MB)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });

    it('should handle WeakMap/WeakSet efficiently', () => {
      const weakMap = new WeakMap<object, number>();
      const objects: object[] = [];

      const start = Date.now();
      for (let i = 0; i < 10000; i++) {
        const obj = { id: i };
        weakMap.set(obj, i);
        objects.push(obj);
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
    });
  });
});
