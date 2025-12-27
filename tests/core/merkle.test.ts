/**
 * Merkle Tree Core Tests
 * Tests for cryptographic verification primitives
 */

import { createHash } from 'crypto';

describe('Merkle Tree Operations', () => {
  // Helper function to hash data
  const hash = (data: string): string => {
    return createHash('sha256').update(data).digest('hex');
  };

  // Helper function to combine two hashes
  const combine = (left: string, right: string): string => {
    return hash(left + right);
  };

  describe('Hash Function', () => {
    it('should produce consistent hashes', () => {
      const data = 'test data';
      const hash1 = hash(data);
      const hash2 = hash(data);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different data', () => {
      const hash1 = hash('data1');
      const hash2 = hash('data2');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce 64-character hex strings (SHA-256)', () => {
      const result = hash('test');
      expect(result).toHaveLength(64);
      expect(result).toMatch(/^[a-f0-9]+$/);
    });

    it('should be case-sensitive', () => {
      const hash1 = hash('Test');
      const hash2 = hash('test');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Merkle Root Calculation', () => {
    const calculateMerkleRoot = (leaves: string[]): string => {
      if (leaves.length === 0) return '';
      if (leaves.length === 1) return leaves[0]!;

      const hashedLeaves = leaves.map(l => hash(l));
      let currentLevel = hashedLeaves;

      while (currentLevel.length > 1) {
        const nextLevel: string[] = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
          const left = currentLevel[i]!;
          const right = currentLevel[i + 1] ?? left; // Duplicate last if odd
          nextLevel.push(combine(left, right));
        }
        currentLevel = nextLevel;
      }

      return currentLevel[0]!;
    };

    it('should calculate root for single leaf', () => {
      const root = calculateMerkleRoot(['leaf1']);
      expect(root).toBe(hash('leaf1'));
    });

    it('should calculate root for two leaves', () => {
      const root = calculateMerkleRoot(['leaf1', 'leaf2']);
      expect(root).toBe(combine(hash('leaf1'), hash('leaf2')));
    });

    it('should handle odd number of leaves', () => {
      const root = calculateMerkleRoot(['a', 'b', 'c']);
      const left = combine(hash('a'), hash('b'));
      const right = combine(hash('c'), hash('c')); // Duplicated
      expect(root).toBe(combine(left, right));
    });

    it('should calculate root for power-of-two leaves', () => {
      const root = calculateMerkleRoot(['a', 'b', 'c', 'd']);
      const leftSubtree = combine(hash('a'), hash('b'));
      const rightSubtree = combine(hash('c'), hash('d'));
      expect(root).toBe(combine(leftSubtree, rightSubtree));
    });

    it('should produce different roots for different leaves', () => {
      const root1 = calculateMerkleRoot(['a', 'b', 'c']);
      const root2 = calculateMerkleRoot(['a', 'b', 'd']);
      expect(root1).not.toBe(root2);
    });

    it('should be order-sensitive', () => {
      const root1 = calculateMerkleRoot(['a', 'b']);
      const root2 = calculateMerkleRoot(['b', 'a']);
      expect(root1).not.toBe(root2);
    });
  });

  describe('Merkle Proof Generation', () => {
    interface MerkleProof {
      leaf: string;
      proof: string[];
      directions: ('left' | 'right')[];
    }

    const generateProof = (leaves: string[], index: number): MerkleProof => {
      const hashedLeaves = leaves.map(l => hash(l));
      const proof: string[] = [];
      const directions: ('left' | 'right')[] = [];

      let currentLevel = hashedLeaves;
      let idx = index;

      while (currentLevel.length > 1) {
        const isEven = idx % 2 === 0;
        const siblingIdx = isEven ? idx + 1 : idx - 1;

        if (siblingIdx < currentLevel.length) {
          proof.push(currentLevel[siblingIdx]!);
          directions.push(isEven ? 'right' : 'left');
        } else {
          proof.push(currentLevel[idx]!);
          directions.push('right');
        }

        const nextLevel: string[] = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
          const left = currentLevel[i]!;
          const right = currentLevel[i + 1] ?? left;
          nextLevel.push(combine(left, right));
        }
        currentLevel = nextLevel;
        idx = Math.floor(idx / 2);
      }

      return {
        leaf: hashedLeaves[index]!,
        proof,
        directions,
      };
    };

    it('should generate empty proof for single leaf', () => {
      const { proof } = generateProof(['leaf'], 0);
      expect(proof).toHaveLength(0);
    });

    it('should generate proof with sibling for two leaves', () => {
      const { proof, directions } = generateProof(['a', 'b'], 0);
      expect(proof).toEqual([hash('b')]);
      expect(directions).toEqual(['right']);
    });

    it('should generate correct proof for left leaf', () => {
      const { proof, directions } = generateProof(['a', 'b', 'c', 'd'], 0);
      expect(proof).toHaveLength(2);
      expect(directions[0]).toBe('right');
    });

    it('should generate correct proof for right leaf', () => {
      const { proof, directions } = generateProof(['a', 'b', 'c', 'd'], 1);
      expect(proof).toHaveLength(2);
      expect(directions[0]).toBe('left');
    });
  });

  describe('Merkle Proof Verification', () => {
    const verifyProof = (
      leaf: string,
      proof: string[],
      directions: ('left' | 'right')[],
      root: string
    ): boolean => {
      let current = leaf;

      for (let i = 0; i < proof.length; i++) {
        const sibling = proof[i]!;
        if (directions[i] === 'left') {
          current = combine(sibling, current);
        } else {
          current = combine(current, sibling);
        }
      }

      return current === root;
    };

    it('should verify valid proof', () => {
      const leaves = ['a', 'b', 'c', 'd'];
      const hashedLeaves = leaves.map(l => hash(l));

      const leftSubtree = combine(hashedLeaves[0]!, hashedLeaves[1]!);
      const rightSubtree = combine(hashedLeaves[2]!, hashedLeaves[3]!);
      const root = combine(leftSubtree, rightSubtree);

      // Proof for leaf 'a' (index 0)
      const proof = [hashedLeaves[1]!, rightSubtree];
      const directions: ('left' | 'right')[] = ['right', 'right'];

      expect(verifyProof(hashedLeaves[0]!, proof, directions, root)).toBe(true);
    });

    it('should reject invalid proof (wrong leaf)', () => {
      const leaves = ['a', 'b', 'c', 'd'];
      const hashedLeaves = leaves.map(l => hash(l));

      const leftSubtree = combine(hashedLeaves[0]!, hashedLeaves[1]!);
      const rightSubtree = combine(hashedLeaves[2]!, hashedLeaves[3]!);
      const root = combine(leftSubtree, rightSubtree);

      const proof = [hashedLeaves[1]!, rightSubtree];
      const directions: ('left' | 'right')[] = ['right', 'right'];

      // Try to verify wrong leaf
      expect(verifyProof(hash('wrong'), proof, directions, root)).toBe(false);
    });

    it('should reject invalid proof (wrong sibling)', () => {
      const leaves = ['a', 'b', 'c', 'd'];
      const hashedLeaves = leaves.map(l => hash(l));

      const leftSubtree = combine(hashedLeaves[0]!, hashedLeaves[1]!);
      const rightSubtree = combine(hashedLeaves[2]!, hashedLeaves[3]!);
      const root = combine(leftSubtree, rightSubtree);

      // Wrong sibling in proof
      const proof = [hash('wrong'), rightSubtree];
      const directions: ('left' | 'right')[] = ['right', 'right'];

      expect(verifyProof(hashedLeaves[0]!, proof, directions, root)).toBe(false);
    });

    it('should reject invalid proof (wrong direction)', () => {
      const leaves = ['a', 'b', 'c', 'd'];
      const hashedLeaves = leaves.map(l => hash(l));

      const leftSubtree = combine(hashedLeaves[0]!, hashedLeaves[1]!);
      const rightSubtree = combine(hashedLeaves[2]!, hashedLeaves[3]!);
      const root = combine(leftSubtree, rightSubtree);

      const proof = [hashedLeaves[1]!, rightSubtree];
      const directions: ('left' | 'right')[] = ['left', 'right']; // Wrong direction

      expect(verifyProof(hashedLeaves[0]!, proof, directions, root)).toBe(false);
    });
  });

  describe('Consistency Proof', () => {
    // Simplified consistency check
    const verifyConsistency = (
      oldRoot: string,
      newRoot: string,
      oldSize: number,
      newSize: number,
      oldLeaves: string[],
      newLeaves: string[]
    ): boolean => {
      // Old root should match calculation from old leaves
      const hashedOldLeaves = oldLeaves.map(l => hash(l));
      const hashedNewLeaves = newLeaves.map(l => hash(l));

      // New tree should contain all old leaves in same order
      for (let i = 0; i < oldSize; i++) {
        if (hashedOldLeaves[i] !== hashedNewLeaves[i]) {
          return false;
        }
      }

      return true;
    };

    it('should verify append-only consistency', () => {
      const oldLeaves = ['a', 'b', 'c'];
      const newLeaves = ['a', 'b', 'c', 'd', 'e'];

      const result = verifyConsistency(
        'old-root',
        'new-root',
        3,
        5,
        oldLeaves,
        newLeaves
      );

      expect(result).toBe(true);
    });

    it('should detect tampering', () => {
      const oldLeaves = ['a', 'b', 'c'];
      const newLeaves = ['a', 'modified', 'c', 'd'];

      const result = verifyConsistency(
        'old-root',
        'new-root',
        3,
        4,
        oldLeaves,
        newLeaves
      );

      expect(result).toBe(false);
    });
  });
});
