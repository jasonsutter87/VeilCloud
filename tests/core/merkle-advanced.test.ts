/**
 * Advanced Merkle Tree Tests
 */

import { createHash } from 'crypto';

const sha256 = (data: string): string => {
  return createHash('sha256').update(data).digest('hex');
};

// Mock Merkle tree implementation
class MerkleTree {
  private leaves: string[] = [];
  private layers: string[][] = [];

  constructor(entries: string[] = []) {
    if (entries.length > 0) {
      this.leaves = entries.map(e => sha256(e));
      this.buildTree();
    }
  }

  private buildTree(): void {
    if (this.leaves.length === 0) return;

    this.layers = [this.leaves];
    let currentLayer = this.leaves;

    while (currentLayer.length > 1) {
      const nextLayer: string[] = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i]!;
        const right = currentLayer[i + 1] ?? left;
        nextLayer.push(sha256(left + right));
      }
      this.layers.push(nextLayer);
      currentLayer = nextLayer;
    }
  }

  getRoot(): string | null {
    if (this.layers.length === 0) return null;
    return this.layers[this.layers.length - 1]![0] ?? null;
  }

  getProof(index: number): string[] {
    if (index < 0 || index >= this.leaves.length) return [];

    const proof: string[] = [];
    let idx = index;

    for (let i = 0; i < this.layers.length - 1; i++) {
      const layer = this.layers[i]!;
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;

      if (siblingIdx < layer.length) {
        proof.push(layer[siblingIdx]!);
      } else if (idx < layer.length) {
        proof.push(layer[idx]!);
      }

      idx = Math.floor(idx / 2);
    }

    return proof;
  }

  verify(entryHash: string, proof: string[], index: number): boolean {
    let hash = entryHash;
    let idx = index;

    for (const sibling of proof) {
      if (idx % 2 === 0) {
        hash = sha256(hash + sibling);
      } else {
        hash = sha256(sibling + hash);
      }
      idx = Math.floor(idx / 2);
    }

    return hash === this.getRoot();
  }

  append(entry: string): number {
    const hash = sha256(entry);
    this.leaves.push(hash);
    this.buildTree();
    return this.leaves.length - 1;
  }

  getLeafCount(): number {
    return this.leaves.length;
  }

  getHeight(): number {
    return this.layers.length;
  }

  getLeaves(): string[] {
    return [...this.leaves];
  }

  getLayer(index: number): string[] {
    return this.layers[index] ? [...this.layers[index]] : [];
  }
}

describe('MerkleTree Advanced', () => {
  describe('construction', () => {
    it('should build tree from entries', () => {
      const tree = new MerkleTree(['a', 'b', 'c', 'd']);
      expect(tree.getRoot()).toBeDefined();
    });

    it('should handle single entry', () => {
      const tree = new MerkleTree(['single']);
      expect(tree.getRoot()).toBe(sha256('single'));
    });

    it('should handle empty tree', () => {
      const tree = new MerkleTree([]);
      expect(tree.getRoot()).toBeNull();
    });

    it('should handle power of 2 entries', () => {
      const tree = new MerkleTree(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
      expect(tree.getLeafCount()).toBe(8);
    });

    it('should handle non-power of 2 entries', () => {
      const tree = new MerkleTree(['a', 'b', 'c', 'd', 'e']);
      expect(tree.getRoot()).toBeDefined();
    });

    it('should produce deterministic root', () => {
      const tree1 = new MerkleTree(['a', 'b', 'c']);
      const tree2 = new MerkleTree(['a', 'b', 'c']);
      expect(tree1.getRoot()).toBe(tree2.getRoot());
    });

    it('should produce different root for different entries', () => {
      const tree1 = new MerkleTree(['a', 'b', 'c']);
      const tree2 = new MerkleTree(['a', 'b', 'd']);
      expect(tree1.getRoot()).not.toBe(tree2.getRoot());
    });

    it('should be order-sensitive', () => {
      const tree1 = new MerkleTree(['a', 'b', 'c']);
      const tree2 = new MerkleTree(['c', 'b', 'a']);
      expect(tree1.getRoot()).not.toBe(tree2.getRoot());
    });
  });

  describe('proof generation', () => {
    it('should generate proof for first entry', () => {
      const tree = new MerkleTree(['a', 'b', 'c', 'd']);
      const proof = tree.getProof(0);
      expect(proof.length).toBeGreaterThan(0);
    });

    it('should generate proof for last entry', () => {
      const tree = new MerkleTree(['a', 'b', 'c', 'd']);
      const proof = tree.getProof(3);
      expect(proof.length).toBeGreaterThan(0);
    });

    it('should generate logarithmic proof size', () => {
      const entries = Array.from({ length: 16 }, (_, i) => `entry-${i}`);
      const tree = new MerkleTree(entries);
      const proof = tree.getProof(0);
      expect(proof.length).toBe(4); // log2(16) = 4
    });

    it('should return empty proof for invalid index', () => {
      const tree = new MerkleTree(['a', 'b']);
      expect(tree.getProof(-1)).toEqual([]);
      expect(tree.getProof(10)).toEqual([]);
    });

    it('should generate unique proofs for different indices', () => {
      const tree = new MerkleTree(['a', 'b', 'c', 'd']);
      const proof0 = tree.getProof(0);
      const proof1 = tree.getProof(1);
      expect(proof0).not.toEqual(proof1);
    });
  });

  describe('proof verification', () => {
    it('should verify valid proof', () => {
      const entries = ['a', 'b', 'c', 'd'];
      const tree = new MerkleTree(entries);
      const proof = tree.getProof(0);
      const entryHash = sha256('a');

      expect(tree.verify(entryHash, proof, 0)).toBe(true);
    });

    it('should verify proof for any entry', () => {
      const entries = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      const tree = new MerkleTree(entries);

      for (let i = 0; i < entries.length; i++) {
        const proof = tree.getProof(i);
        const entryHash = sha256(entries[i]!);
        expect(tree.verify(entryHash, proof, i)).toBe(true);
      }
    });

    it('should reject wrong entry hash', () => {
      const tree = new MerkleTree(['a', 'b', 'c', 'd']);
      const proof = tree.getProof(0);
      const wrongHash = sha256('wrong');

      expect(tree.verify(wrongHash, proof, 0)).toBe(false);
    });

    it('should reject wrong index', () => {
      const tree = new MerkleTree(['a', 'b', 'c', 'd']);
      const proof = tree.getProof(0);
      const entryHash = sha256('a');

      expect(tree.verify(entryHash, proof, 1)).toBe(false);
    });

    it('should reject tampered proof', () => {
      const tree = new MerkleTree(['a', 'b', 'c', 'd']);
      const proof = tree.getProof(0);
      const entryHash = sha256('a');

      proof[0] = sha256('tampered');

      expect(tree.verify(entryHash, proof, 0)).toBe(false);
    });
  });

  describe('append', () => {
    it('should append entry', () => {
      const tree = new MerkleTree(['a', 'b']);
      tree.append('c');
      expect(tree.getLeafCount()).toBe(3);
    });

    it('should return new index', () => {
      const tree = new MerkleTree(['a', 'b']);
      const idx = tree.append('c');
      expect(idx).toBe(2);
    });

    it('should update root', () => {
      const tree = new MerkleTree(['a', 'b']);
      const oldRoot = tree.getRoot();
      tree.append('c');
      expect(tree.getRoot()).not.toBe(oldRoot);
    });

    it('should maintain valid proofs for existing entries', () => {
      const tree = new MerkleTree(['a', 'b']);
      tree.append('c');

      const proof = tree.getProof(0);
      expect(tree.verify(sha256('a'), proof, 0)).toBe(true);
    });

    it('should generate valid proof for new entry', () => {
      const tree = new MerkleTree(['a', 'b']);
      const idx = tree.append('c');

      const proof = tree.getProof(idx);
      expect(tree.verify(sha256('c'), proof, idx)).toBe(true);
    });
  });

  describe('tree properties', () => {
    it('should calculate correct height', () => {
      const tree = new MerkleTree(['a', 'b', 'c', 'd']);
      expect(tree.getHeight()).toBe(3); // leaves + 2 internal layers
    });

    it('should return leaves', () => {
      const tree = new MerkleTree(['a', 'b']);
      const leaves = tree.getLeaves();
      expect(leaves).toHaveLength(2);
      expect(leaves[0]).toBe(sha256('a'));
    });

    it('should return layer by index', () => {
      const tree = new MerkleTree(['a', 'b', 'c', 'd']);
      const leaves = tree.getLayer(0);
      const root = tree.getLayer(tree.getHeight() - 1);

      expect(leaves).toHaveLength(4);
      expect(root).toHaveLength(1);
    });

    it('should return empty array for invalid layer', () => {
      const tree = new MerkleTree(['a', 'b']);
      expect(tree.getLayer(100)).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('should handle 1 entry tree', () => {
      const tree = new MerkleTree(['single']);
      const proof = tree.getProof(0);
      expect(tree.verify(sha256('single'), proof, 0)).toBe(true);
    });

    it('should handle 2 entry tree', () => {
      const tree = new MerkleTree(['a', 'b']);
      expect(tree.getProof(0).length).toBe(1);
      expect(tree.getProof(1).length).toBe(1);
    });

    it('should handle 3 entry tree (odd)', () => {
      const tree = new MerkleTree(['a', 'b', 'c']);
      for (let i = 0; i < 3; i++) {
        const proof = tree.getProof(i);
        expect(proof.length).toBeGreaterThan(0);
      }
    });

    it('should handle large trees', () => {
      const entries = Array.from({ length: 1000 }, (_, i) => `entry-${i}`);
      const tree = new MerkleTree(entries);

      expect(tree.getRoot()).toBeDefined();
      expect(tree.getLeafCount()).toBe(1000);
    });

    it('should handle duplicate entries', () => {
      const tree = new MerkleTree(['dup', 'dup', 'dup']);
      expect(tree.getRoot()).toBeDefined();
    });

    it('should handle empty string entries', () => {
      const tree = new MerkleTree(['', 'a', '']);
      expect(tree.getRoot()).toBeDefined();
    });
  });

  describe('security properties', () => {
    it('should be collision-resistant', () => {
      // Different content should produce different roots
      const variations = [
        ['a', 'b'],
        ['ab', ''],
        ['a', 'b', ''],
        ['', 'ab'],
      ];

      const roots = variations.map(v => new MerkleTree(v).getRoot());
      const uniqueRoots = new Set(roots);
      expect(uniqueRoots.size).toBe(roots.length);
    });

    it('should not allow proof reuse across trees', () => {
      const tree1 = new MerkleTree(['a', 'b', 'c', 'd']);
      const tree2 = new MerkleTree(['x', 'y', 'z', 'w']);

      const proof = tree1.getProof(0);

      expect(tree2.verify(sha256('a'), proof, 0)).toBe(false);
    });

    it('should not allow proof reuse across positions', () => {
      const tree = new MerkleTree(['a', 'b', 'c', 'd']);
      const proof0 = tree.getProof(0);

      expect(tree.verify(sha256('b'), proof0, 1)).toBe(false);
    });
  });

  describe('performance', () => {
    it('should build tree efficiently', () => {
      const entries = Array.from({ length: 10000 }, (_, i) => `entry-${i}`);
      const start = Date.now();
      const tree = new MerkleTree(entries);
      const elapsed = Date.now() - start;

      expect(tree.getRoot()).toBeDefined();
      expect(elapsed).toBeLessThan(2000);
    });

    it('should generate proofs efficiently', () => {
      const entries = Array.from({ length: 10000 }, (_, i) => `entry-${i}`);
      const tree = new MerkleTree(entries);

      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        tree.getProof(i);
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
    });

    it('should verify proofs efficiently', () => {
      const entries = Array.from({ length: 10000 }, (_, i) => `entry-${i}`);
      const tree = new MerkleTree(entries);
      const proof = tree.getProof(0);

      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        tree.verify(sha256('entry-0'), proof, 0);
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent reads', async () => {
      const entries = Array.from({ length: 100 }, (_, i) => `entry-${i}`);
      const tree = new MerkleTree(entries);

      const promises = Array.from({ length: 50 }, (_, i) =>
        Promise.resolve(tree.getProof(i))
      );

      const proofs = await Promise.all(promises);
      expect(proofs).toHaveLength(50);
    });

    it('should handle concurrent verifications', async () => {
      const entries = Array.from({ length: 100 }, (_, i) => `entry-${i}`);
      const tree = new MerkleTree(entries);

      const promises = Array.from({ length: 50 }, (_, i) => {
        const proof = tree.getProof(i);
        return Promise.resolve(tree.verify(sha256(`entry-${i}`), proof, i));
      });

      const results = await Promise.all(promises);
      expect(results.every(r => r === true)).toBe(true);
    });
  });
});
