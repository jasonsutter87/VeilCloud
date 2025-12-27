/**
 * Batch Proof Tests
 */

import { createHash } from 'crypto';

const sha256 = (data: string): string => {
  return createHash('sha256').update(data).digest('hex');
};

// Mock batch proof generator
const BatchProof = {
  /**
   * Generate proofs for multiple entries at once
   */
  generateBatch: (
    entries: string[],
    getProof: (entry: string) => { proof: string[]; index: number }
  ): { entries: Array<{ entry: string; proof: string[]; index: number }> } => {
    return {
      entries: entries.map(entry => ({
        entry,
        ...getProof(entry),
      })),
    };
  },

  /**
   * Verify multiple proofs in batch
   */
  verifyBatch: (
    proofs: Array<{ entry: string; hash: string; proof: string[]; index: number }>,
    root: string,
    verify: (entryHash: string, proof: string[], index: number, root: string) => boolean
  ): { valid: boolean; results: Array<{ entry: string; valid: boolean }> } => {
    const results = proofs.map(p => ({
      entry: p.entry,
      valid: verify(p.hash, p.proof, p.index, root),
    }));

    return {
      valid: results.every(r => r.valid),
      results,
    };
  },

  /**
   * Optimize proofs by sharing common siblings
   */
  optimizeBatch: (
    proofs: Array<{ proof: string[] }>
  ): { commonPrefix: string[]; suffixes: string[][] } => {
    if (proofs.length === 0) return { commonPrefix: [], suffixes: [] };

    // Find common prefix
    const firstProof = proofs[0]!.proof;
    let commonLength = 0;

    outer: for (let i = 0; i < firstProof.length; i++) {
      for (const p of proofs) {
        if (p.proof[i] !== firstProof[i]) {
          break outer;
        }
      }
      commonLength++;
    }

    return {
      commonPrefix: firstProof.slice(0, commonLength),
      suffixes: proofs.map(p => p.proof.slice(commonLength)),
    };
  },

  /**
   * Compress proofs by deduplicating siblings
   */
  compress: (
    proofs: Array<{ proof: string[] }>
  ): { uniqueSiblings: string[]; proofIndices: number[][] } => {
    const uniqueSiblings: string[] = [];
    const siblingIndex = new Map<string, number>();

    for (const p of proofs) {
      for (const sibling of p.proof) {
        if (!siblingIndex.has(sibling)) {
          siblingIndex.set(sibling, uniqueSiblings.length);
          uniqueSiblings.push(sibling);
        }
      }
    }

    const proofIndices = proofs.map(p =>
      p.proof.map(s => siblingIndex.get(s)!)
    );

    return { uniqueSiblings, proofIndices };
  },

  /**
   * Decompress proofs
   */
  decompress: (
    uniqueSiblings: string[],
    proofIndices: number[][]
  ): Array<{ proof: string[] }> => {
    return proofIndices.map(indices => ({
      proof: indices.map(i => uniqueSiblings[i]!),
    }));
  },
};

describe('BatchProof', () => {
  describe('generateBatch', () => {
    it('should generate proofs for multiple entries', () => {
      const entries = ['entry-1', 'entry-2', 'entry-3'];
      const getProof = (entry: string) => ({
        proof: [sha256(entry + '-sibling')],
        index: parseInt(entry.split('-')[1]!) - 1,
      });

      const result = BatchProof.generateBatch(entries, getProof);

      expect(result.entries).toHaveLength(3);
    });

    it('should include proof for each entry', () => {
      const entries = ['e1', 'e2'];
      const getProof = () => ({ proof: ['s1', 's2'], index: 0 });

      const result = BatchProof.generateBatch(entries, getProof);

      expect(result.entries[0]!.proof).toHaveLength(2);
      expect(result.entries[1]!.proof).toHaveLength(2);
    });

    it('should include index for each entry', () => {
      const entries = ['e1', 'e2', 'e3'];
      const getProof = (e: string) => ({
        proof: [],
        index: ['e1', 'e2', 'e3'].indexOf(e),
      });

      const result = BatchProof.generateBatch(entries, getProof);

      expect(result.entries[0]!.index).toBe(0);
      expect(result.entries[1]!.index).toBe(1);
      expect(result.entries[2]!.index).toBe(2);
    });

    it('should handle empty entries', () => {
      const result = BatchProof.generateBatch([], () => ({ proof: [], index: 0 }));

      expect(result.entries).toHaveLength(0);
    });

    it('should handle single entry', () => {
      const result = BatchProof.generateBatch(
        ['only-one'],
        () => ({ proof: ['sibling'], index: 0 })
      );

      expect(result.entries).toHaveLength(1);
    });
  });

  describe('verifyBatch', () => {
    it('should verify all valid proofs', () => {
      const proofs = [
        { entry: 'e1', hash: sha256('e1'), proof: ['s1'], index: 0 },
        { entry: 'e2', hash: sha256('e2'), proof: ['s2'], index: 1 },
      ];
      const verify = () => true;

      const result = BatchProof.verifyBatch(proofs, 'root', verify);

      expect(result.valid).toBe(true);
      expect(result.results.every(r => r.valid)).toBe(true);
    });

    it('should detect invalid proof', () => {
      const proofs = [
        { entry: 'e1', hash: sha256('e1'), proof: ['s1'], index: 0 },
        { entry: 'e2', hash: 'wrong-hash', proof: ['s2'], index: 1 },
      ];
      const verify = (_: string, __: string[], ___: number, ____: string) => true;
      const verifyWithCheck = (hash: string) => hash !== 'wrong-hash';

      const result = BatchProof.verifyBatch(proofs, 'root', verifyWithCheck as any);

      expect(result.valid).toBe(false);
      expect(result.results[0]!.valid).toBe(true);
      expect(result.results[1]!.valid).toBe(false);
    });

    it('should return per-entry results', () => {
      const proofs = [
        { entry: 'e1', hash: 'h1', proof: [], index: 0 },
        { entry: 'e2', hash: 'h2', proof: [], index: 1 },
        { entry: 'e3', hash: 'h3', proof: [], index: 2 },
      ];

      const result = BatchProof.verifyBatch(proofs, 'root', () => true);

      expect(result.results).toHaveLength(3);
      expect(result.results[0]!.entry).toBe('e1');
      expect(result.results[1]!.entry).toBe('e2');
      expect(result.results[2]!.entry).toBe('e3');
    });

    it('should handle empty proofs', () => {
      const result = BatchProof.verifyBatch([], 'root', () => true);

      expect(result.valid).toBe(true);
      expect(result.results).toHaveLength(0);
    });
  });

  describe('optimizeBatch', () => {
    it('should find common prefix', () => {
      const proofs = [
        { proof: ['a', 'b', 'c', 'd'] },
        { proof: ['a', 'b', 'c', 'e'] },
        { proof: ['a', 'b', 'c', 'f'] },
      ];

      const result = BatchProof.optimizeBatch(proofs);

      expect(result.commonPrefix).toEqual(['a', 'b', 'c']);
    });

    it('should return suffixes without common prefix', () => {
      const proofs = [
        { proof: ['a', 'b', 'x'] },
        { proof: ['a', 'b', 'y'] },
      ];

      const result = BatchProof.optimizeBatch(proofs);

      expect(result.suffixes[0]).toEqual(['x']);
      expect(result.suffixes[1]).toEqual(['y']);
    });

    it('should handle no common prefix', () => {
      const proofs = [
        { proof: ['a', 'b'] },
        { proof: ['x', 'y'] },
      ];

      const result = BatchProof.optimizeBatch(proofs);

      expect(result.commonPrefix).toEqual([]);
      expect(result.suffixes[0]).toEqual(['a', 'b']);
      expect(result.suffixes[1]).toEqual(['x', 'y']);
    });

    it('should handle fully identical proofs', () => {
      const proofs = [
        { proof: ['a', 'b', 'c'] },
        { proof: ['a', 'b', 'c'] },
      ];

      const result = BatchProof.optimizeBatch(proofs);

      expect(result.commonPrefix).toEqual(['a', 'b', 'c']);
      expect(result.suffixes[0]).toEqual([]);
      expect(result.suffixes[1]).toEqual([]);
    });

    it('should handle empty proofs array', () => {
      const result = BatchProof.optimizeBatch([]);

      expect(result.commonPrefix).toEqual([]);
      expect(result.suffixes).toEqual([]);
    });

    it('should handle single proof', () => {
      const proofs = [{ proof: ['a', 'b', 'c'] }];

      const result = BatchProof.optimizeBatch(proofs);

      expect(result.commonPrefix).toEqual(['a', 'b', 'c']);
      expect(result.suffixes[0]).toEqual([]);
    });
  });

  describe('compress', () => {
    it('should deduplicate siblings', () => {
      const proofs = [
        { proof: ['a', 'b', 'c'] },
        { proof: ['a', 'b', 'd'] },
        { proof: ['a', 'e', 'f'] },
      ];

      const result = BatchProof.compress(proofs);

      expect(result.uniqueSiblings).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    });

    it('should return indices for reconstruction', () => {
      const proofs = [
        { proof: ['x', 'y'] },
        { proof: ['y', 'z'] },
      ];

      const result = BatchProof.compress(proofs);

      // x=0, y=1, z=2
      expect(result.proofIndices[0]).toEqual([0, 1]); // x, y
      expect(result.proofIndices[1]).toEqual([1, 2]); // y, z
    });

    it('should reduce size for repeated siblings', () => {
      const proofs = Array.from({ length: 10 }, () => ({
        proof: ['common1', 'common2', 'common3'],
      }));

      const result = BatchProof.compress(proofs);

      expect(result.uniqueSiblings).toHaveLength(3);
      expect(result.proofIndices).toHaveLength(10);
    });

    it('should handle empty proofs', () => {
      const result = BatchProof.compress([]);

      expect(result.uniqueSiblings).toEqual([]);
      expect(result.proofIndices).toEqual([]);
    });

    it('should handle proofs with empty proof arrays', () => {
      const proofs = [{ proof: [] }, { proof: [] }];

      const result = BatchProof.compress(proofs);

      expect(result.uniqueSiblings).toEqual([]);
      expect(result.proofIndices).toEqual([[], []]);
    });
  });

  describe('decompress', () => {
    it('should reconstruct original proofs', () => {
      const original = [
        { proof: ['a', 'b', 'c'] },
        { proof: ['a', 'd', 'e'] },
      ];

      const compressed = BatchProof.compress(original);
      const decompressed = BatchProof.decompress(
        compressed.uniqueSiblings,
        compressed.proofIndices
      );

      expect(decompressed[0]!.proof).toEqual(original[0]!.proof);
      expect(decompressed[1]!.proof).toEqual(original[1]!.proof);
    });

    it('should be inverse of compress', () => {
      const original = [
        { proof: ['x', 'y', 'z'] },
        { proof: ['x', 'y', 'w'] },
        { proof: ['x', 'v', 'u'] },
      ];

      const { uniqueSiblings, proofIndices } = BatchProof.compress(original);
      const result = BatchProof.decompress(uniqueSiblings, proofIndices);

      for (let i = 0; i < original.length; i++) {
        expect(result[i]!.proof).toEqual(original[i]!.proof);
      }
    });

    it('should handle empty input', () => {
      const result = BatchProof.decompress([], []);

      expect(result).toEqual([]);
    });
  });

  describe('compression ratio', () => {
    it('should achieve good compression for similar proofs', () => {
      const proofs = Array.from({ length: 100 }, (_, i) => ({
        proof: ['common1', 'common2', `unique-${i}`],
      }));

      const { uniqueSiblings } = BatchProof.compress(proofs);

      // 2 common + 100 unique = 102 unique siblings
      // vs 300 total siblings without compression
      const compressionRatio = uniqueSiblings.length / (proofs.length * 3);
      expect(compressionRatio).toBeLessThan(0.5);
    });

    it('should not compress unique proofs well', () => {
      const proofs = Array.from({ length: 10 }, (_, i) => ({
        proof: [`a-${i}`, `b-${i}`, `c-${i}`],
      }));

      const { uniqueSiblings } = BatchProof.compress(proofs);

      expect(uniqueSiblings.length).toBe(30); // No compression
    });
  });

  describe('performance', () => {
    it('should handle large batches efficiently', () => {
      const entries = Array.from({ length: 1000 }, (_, i) => `entry-${i}`);
      const getProof = (entry: string) => ({
        proof: Array.from({ length: 10 }, (_, j) => sha256(`${entry}-${j}`)),
        index: parseInt(entry.split('-')[1]!),
      });

      const start = Date.now();
      const result = BatchProof.generateBatch(entries, getProof);
      const elapsed = Date.now() - start;

      expect(result.entries).toHaveLength(1000);
      expect(elapsed).toBeLessThan(1000);
    });

    it('should verify large batches efficiently', () => {
      const proofs = Array.from({ length: 1000 }, (_, i) => ({
        entry: `e-${i}`,
        hash: sha256(`e-${i}`),
        proof: ['s1', 's2', 's3'],
        index: i,
      }));

      const start = Date.now();
      const result = BatchProof.verifyBatch(proofs, 'root', () => true);
      const elapsed = Date.now() - start;

      expect(result.results).toHaveLength(1000);
      expect(elapsed).toBeLessThan(500);
    });

    it('should compress large batches efficiently', () => {
      const proofs = Array.from({ length: 1000 }, () => ({
        proof: ['common'] .concat(Array.from({ length: 9 }, () => sha256(Math.random().toString()))),
      }));

      const start = Date.now();
      const result = BatchProof.compress(proofs);
      const elapsed = Date.now() - start;

      expect(result.proofIndices).toHaveLength(1000);
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('edge cases', () => {
    it('should handle proofs of different lengths', () => {
      const proofs = [
        { proof: ['a', 'b', 'c'] },
        { proof: ['x', 'y'] },
        { proof: ['p'] },
      ];

      const compressed = BatchProof.compress(proofs);
      const decompressed = BatchProof.decompress(
        compressed.uniqueSiblings,
        compressed.proofIndices
      );

      expect(decompressed[0]!.proof).toHaveLength(3);
      expect(decompressed[1]!.proof).toHaveLength(2);
      expect(decompressed[2]!.proof).toHaveLength(1);
    });

    it('should handle duplicate entries', () => {
      const entries = ['e1', 'e1', 'e1'];
      const getProof = () => ({ proof: ['s'], index: 0 });

      const result = BatchProof.generateBatch(entries, getProof);

      expect(result.entries).toHaveLength(3);
    });
  });
});
