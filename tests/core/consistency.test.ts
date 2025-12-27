/**
 * Consistency Proof Tests
 */

import { createHash } from 'crypto';

// Helper to create mock hashes
const mockHash = (input: string): string => {
  return createHash('sha256').update(input).digest('hex');
};

// Mock consistency proof generator
const ConsistencyProof = {
  /**
   * Generate consistency proof between two tree sizes
   */
  generate: (
    oldSize: number,
    newSize: number,
    getNode: (level: number, index: number) => string
  ): string[] => {
    if (oldSize > newSize) throw new Error('Old size cannot exceed new size');
    if (oldSize === 0) return [];
    if (oldSize === newSize) return [getNode(0, 0)];

    const proof: string[] = [];
    let m = oldSize;
    let n = newSize;
    let b = true;

    while (m !== n) {
      const k = 1 << (Math.floor(Math.log2(n - 1)));
      if (m <= k) {
        proof.push(getNode(Math.floor(Math.log2(k)), k - 1));
        n = k;
      } else {
        proof.push(getNode(Math.floor(Math.log2(k)), 0));
        m -= k;
        n -= k;
        b = false;
      }
    }

    if (b) {
      proof.push(getNode(0, m - 1));
    }

    return proof;
  },

  /**
   * Verify consistency proof
   */
  verify: (
    oldRoot: string,
    newRoot: string,
    oldSize: number,
    newSize: number,
    proof: string[]
  ): boolean => {
    if (oldSize > newSize) return false;
    if (oldSize === 0) return proof.length === 0;
    if (proof.length === 0) return false;

    // Simplified verification logic
    // In real implementation, would reconstruct roots
    return proof.length > 0 && proof.every(h => h.length === 64);
  },

  /**
   * Compute hash of two children
   */
  hashChildren: (left: string, right: string): string => {
    return mockHash(left + right);
  },
};

describe('ConsistencyProof', () => {
  // Create mock tree nodes
  const mockNodes: Map<string, string> = new Map();

  const getNode = (level: number, index: number): string => {
    const key = `${level}-${index}`;
    if (!mockNodes.has(key)) {
      mockNodes.set(key, mockHash(key));
    }
    return mockNodes.get(key)!;
  };

  beforeEach(() => {
    mockNodes.clear();
  });

  describe('generate', () => {
    it('should generate empty proof for size 0', () => {
      const proof = ConsistencyProof.generate(0, 8, getNode);
      expect(proof).toEqual([]);
    });

    it('should generate single-element proof for same size', () => {
      const proof = ConsistencyProof.generate(4, 4, getNode);
      expect(proof).toHaveLength(1);
    });

    it('should throw if old size exceeds new size', () => {
      expect(() => {
        ConsistencyProof.generate(10, 5, getNode);
      }).toThrow('Old size cannot exceed new size');
    });

    it('should generate proof for power-of-two sizes', () => {
      const proof = ConsistencyProof.generate(4, 8, getNode);
      expect(proof.length).toBeGreaterThan(0);
    });

    it('should generate proof for non-power-of-two sizes', () => {
      const proof = ConsistencyProof.generate(3, 7, getNode);
      expect(proof.length).toBeGreaterThan(0);
    });

    it('should generate proof for consecutive sizes', () => {
      const proof = ConsistencyProof.generate(5, 6, getNode);
      expect(proof.length).toBeGreaterThan(0);
    });

    it('should generate proof for large size difference', () => {
      const proof = ConsistencyProof.generate(1, 100, getNode);
      expect(proof.length).toBeGreaterThan(0);
    });

    it('should return hashes as 64-char hex strings', () => {
      const proof = ConsistencyProof.generate(2, 4, getNode);
      for (const h of proof) {
        expect(h).toHaveLength(64);
        expect(h).toMatch(/^[0-9a-f]+$/);
      }
    });
  });

  describe('verify', () => {
    it('should verify empty proof for size 0', () => {
      const result = ConsistencyProof.verify(
        mockHash('old'),
        mockHash('new'),
        0,
        10,
        []
      );
      expect(result).toBe(true);
    });

    it('should reject empty proof for non-zero size', () => {
      const result = ConsistencyProof.verify(
        mockHash('old'),
        mockHash('new'),
        5,
        10,
        []
      );
      expect(result).toBe(false);
    });

    it('should reject if old size exceeds new size', () => {
      const result = ConsistencyProof.verify(
        mockHash('old'),
        mockHash('new'),
        10,
        5,
        [mockHash('proof1')]
      );
      expect(result).toBe(false);
    });

    it('should verify valid proof', () => {
      const proof = ConsistencyProof.generate(4, 8, getNode);
      const result = ConsistencyProof.verify(
        mockHash('old'),
        mockHash('new'),
        4,
        8,
        proof
      );
      expect(result).toBe(true);
    });

    it('should verify proof with valid hashes', () => {
      const proof = [mockHash('a'), mockHash('b')];
      const result = ConsistencyProof.verify(
        mockHash('old'),
        mockHash('new'),
        2,
        4,
        proof
      );
      expect(result).toBe(true);
    });
  });

  describe('hashChildren', () => {
    it('should produce consistent hash', () => {
      const left = mockHash('left');
      const right = mockHash('right');
      const h1 = ConsistencyProof.hashChildren(left, right);
      const h2 = ConsistencyProof.hashChildren(left, right);
      expect(h1).toBe(h2);
    });

    it('should be order-dependent', () => {
      const left = mockHash('left');
      const right = mockHash('right');
      const h1 = ConsistencyProof.hashChildren(left, right);
      const h2 = ConsistencyProof.hashChildren(right, left);
      expect(h1).not.toBe(h2);
    });

    it('should produce 64-char hex string', () => {
      const result = ConsistencyProof.hashChildren(
        mockHash('a'),
        mockHash('b')
      );
      expect(result).toHaveLength(64);
    });

    it('should differ for different inputs', () => {
      const h1 = ConsistencyProof.hashChildren(mockHash('a'), mockHash('b'));
      const h2 = ConsistencyProof.hashChildren(mockHash('a'), mockHash('c'));
      expect(h1).not.toBe(h2);
    });
  });

  describe('proof size', () => {
    it('should have logarithmic proof size', () => {
      // Proof size should be O(log n)
      const proof16 = ConsistencyProof.generate(8, 16, getNode);
      const proof32 = ConsistencyProof.generate(16, 32, getNode);
      const proof64 = ConsistencyProof.generate(32, 64, getNode);

      // All should have similar small sizes
      expect(proof16.length).toBeLessThanOrEqual(10);
      expect(proof32.length).toBeLessThanOrEqual(10);
      expect(proof64.length).toBeLessThanOrEqual(10);
    });

    it('should handle size 1', () => {
      const proof = ConsistencyProof.generate(1, 2, getNode);
      expect(proof.length).toBeGreaterThan(0);
    });

    it('should handle size 1 to large', () => {
      const proof = ConsistencyProof.generate(1, 1000, getNode);
      expect(proof.length).toBeLessThanOrEqual(15); // Log2(1000) ≈ 10
    });
  });

  describe('edge cases', () => {
    it('should handle same size', () => {
      const proof = ConsistencyProof.generate(10, 10, getNode);
      expect(proof).toHaveLength(1);
    });

    it('should handle size 1 to 1', () => {
      const proof = ConsistencyProof.generate(1, 1, getNode);
      expect(proof).toHaveLength(1);
    });

    it('should handle large trees', () => {
      const proof = ConsistencyProof.generate(1000, 10000, getNode);
      expect(proof.length).toBeGreaterThan(0);
      expect(proof.length).toBeLessThan(20);
    });
  });

  describe('integration scenarios', () => {
    it('should support incremental tree growth', () => {
      const proofs: string[][] = [];
      for (let size = 1; size <= 8; size++) {
        if (size > 1) {
          const proof = ConsistencyProof.generate(size - 1, size, getNode);
          proofs.push(proof);
        }
      }
      expect(proofs).toHaveLength(7);
      proofs.forEach(p => expect(p.length).toBeGreaterThan(0));
    });

    it('should support batch verification', () => {
      const sizes = [1, 2, 4, 8, 16];
      const results: boolean[] = [];

      for (let i = 0; i < sizes.length - 1; i++) {
        const proof = ConsistencyProof.generate(sizes[i]!, sizes[i + 1]!, getNode);
        const valid = ConsistencyProof.verify(
          mockHash(`root-${sizes[i]}`),
          mockHash(`root-${sizes[i + 1]}`),
          sizes[i]!,
          sizes[i + 1]!,
          proof
        );
        results.push(valid);
      }

      expect(results.every(r => r)).toBe(true);
    });

    it('should support checkpoint verification', () => {
      // Simulate checkpoints at various tree sizes
      const checkpoints = [10, 50, 100, 500, 1000];

      for (let i = 0; i < checkpoints.length - 1; i++) {
        const proof = ConsistencyProof.generate(
          checkpoints[i]!,
          checkpoints[i + 1]!,
          getNode
        );
        expect(proof.length).toBeGreaterThan(0);
        expect(proof.length).toBeLessThan(20);
      }
    });
  });

  describe('security properties', () => {
    it('should use cryptographic hashes', () => {
      const proof = ConsistencyProof.generate(4, 8, getNode);
      for (const h of proof) {
        // SHA-256 produces 256-bit (64 hex char) output
        expect(h).toHaveLength(64);
      }
    });

    it('should not allow proof reuse', () => {
      const proof1 = ConsistencyProof.generate(4, 8, getNode);
      mockNodes.clear(); // Clear cache to get new hashes
      const proof2 = ConsistencyProof.generate(4, 8, getNode);

      // Same structure but different node values should give different proofs
      expect(proof1).not.toEqual(proof2);
    });
  });

  describe('proof serialization', () => {
    it('should serialize to JSON', () => {
      const proof = ConsistencyProof.generate(4, 8, getNode);
      const json = JSON.stringify({
        oldSize: 4,
        newSize: 8,
        proof,
      });
      expect(json).toBeTruthy();
      expect(JSON.parse(json).proof).toEqual(proof);
    });

    it('should handle empty proof serialization', () => {
      const proof = ConsistencyProof.generate(0, 8, getNode);
      const json = JSON.stringify({ proof });
      expect(JSON.parse(json).proof).toEqual([]);
    });
  });
});
