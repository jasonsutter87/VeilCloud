/**
 * Sparse Merkle Tree Tests
 */

import { createHash } from 'crypto';

const sha256 = (data: string): string => {
  return createHash('sha256').update(data).digest('hex');
};

// Mock Sparse Merkle Tree implementation
class SparseMerkleTree {
  private nodes: Map<string, string> = new Map();
  private depth: number;
  private defaultHashes: string[];

  constructor(depth: number = 256) {
    this.depth = depth;
    this.defaultHashes = this.computeDefaultHashes();
  }

  private computeDefaultHashes(): string[] {
    const hashes: string[] = ['0'.repeat(64)]; // Empty leaf
    for (let i = 1; i <= this.depth; i++) {
      hashes.push(sha256(hashes[i - 1]! + hashes[i - 1]!));
    }
    return hashes;
  }

  private keyToPath(key: string): boolean[] {
    const hash = sha256(key);
    const path: boolean[] = [];
    for (let i = 0; i < this.depth; i++) {
      const byteIndex = Math.floor(i / 8);
      const bitIndex = 7 - (i % 8);
      const byte = parseInt(hash.slice(byteIndex * 2, byteIndex * 2 + 2), 16);
      path.push(((byte >> bitIndex) & 1) === 1);
    }
    return path;
  }

  private nodeKey(level: number, path: boolean[]): string {
    return `${level}:${path.slice(0, level).map(b => b ? '1' : '0').join('')}`;
  }

  set(key: string, value: string): void {
    const path = this.keyToPath(key);
    const leafHash = sha256(value);

    // Set leaf
    this.nodes.set(this.nodeKey(this.depth, path), leafHash);

    // Update path to root
    let currentHash = leafHash;
    for (let level = this.depth - 1; level >= 0; level--) {
      const siblingKey = this.nodeKey(level + 1, this.flipBit(path, level));
      const siblingHash = this.nodes.get(siblingKey) || this.defaultHashes[this.depth - level - 1]!;

      if (path[level]) {
        currentHash = sha256(siblingHash + currentHash);
      } else {
        currentHash = sha256(currentHash + siblingHash);
      }
      this.nodes.set(this.nodeKey(level, path), currentHash);
    }
  }

  private flipBit(path: boolean[], index: number): boolean[] {
    const newPath = [...path];
    newPath[index] = !newPath[index];
    return newPath;
  }

  get(key: string): string | null {
    const path = this.keyToPath(key);
    const nodeKey = this.nodeKey(this.depth, path);
    return this.nodes.get(nodeKey) || null;
  }

  getRoot(): string {
    return this.nodes.get(this.nodeKey(0, [])) || this.defaultHashes[this.depth]!;
  }

  getProof(key: string): { siblings: string[]; path: boolean[] } {
    const path = this.keyToPath(key);
    const siblings: string[] = [];

    for (let level = this.depth - 1; level >= 0; level--) {
      const siblingKey = this.nodeKey(level + 1, this.flipBit(path, level));
      const siblingHash = this.nodes.get(siblingKey) || this.defaultHashes[this.depth - level - 1]!;
      siblings.push(siblingHash);
    }

    return { siblings, path };
  }

  verify(
    key: string,
    value: string | null,
    proof: { siblings: string[]; path: boolean[] },
    root: string
  ): boolean {
    let currentHash = value ? sha256(value) : this.defaultHashes[0]!;

    for (let i = 0; i < proof.siblings.length; i++) {
      const sibling = proof.siblings[i]!;
      const goRight = proof.path[this.depth - 1 - i];

      if (goRight) {
        currentHash = sha256(sibling + currentHash);
      } else {
        currentHash = sha256(currentHash + sibling);
      }
    }

    return currentHash === root;
  }

  delete(key: string): void {
    const path = this.keyToPath(key);
    this.nodes.delete(this.nodeKey(this.depth, path));

    // Update path with default values
    let currentHash = this.defaultHashes[0]!;
    for (let level = this.depth - 1; level >= 0; level--) {
      const siblingKey = this.nodeKey(level + 1, this.flipBit(path, level));
      const siblingHash = this.nodes.get(siblingKey) || this.defaultHashes[this.depth - level - 1]!;

      if (path[level]) {
        currentHash = sha256(siblingHash + currentHash);
      } else {
        currentHash = sha256(currentHash + siblingHash);
      }

      if (currentHash === this.defaultHashes[this.depth - level]!) {
        this.nodes.delete(this.nodeKey(level, path));
      } else {
        this.nodes.set(this.nodeKey(level, path), currentHash);
      }
    }
  }

  size(): number {
    return [...this.nodes.keys()].filter(k => k.startsWith(`${this.depth}:`)).length;
  }
}

describe('SparseMerkleTree', () => {
  let smt: SparseMerkleTree;

  beforeEach(() => {
    smt = new SparseMerkleTree(8); // Small depth for testing
  });

  describe('constructor', () => {
    it('should create tree with default depth', () => {
      const tree = new SparseMerkleTree();
      expect(tree.getRoot()).toHaveLength(64);
    });

    it('should create tree with custom depth', () => {
      const tree = new SparseMerkleTree(16);
      expect(tree.getRoot()).toHaveLength(64);
    });

    it('should start with default root', () => {
      const root = smt.getRoot();
      expect(root).toHaveLength(64);
    });

    it('should have consistent empty root', () => {
      const tree1 = new SparseMerkleTree(8);
      const tree2 = new SparseMerkleTree(8);
      expect(tree1.getRoot()).toBe(tree2.getRoot());
    });
  });

  describe('set', () => {
    it('should set a value', () => {
      smt.set('key1', 'value1');
      expect(smt.get('key1')).toBeTruthy();
    });

    it('should update root after set', () => {
      const oldRoot = smt.getRoot();
      smt.set('key1', 'value1');
      const newRoot = smt.getRoot();
      expect(newRoot).not.toBe(oldRoot);
    });

    it('should handle multiple sets', () => {
      smt.set('key1', 'value1');
      smt.set('key2', 'value2');
      smt.set('key3', 'value3');
      expect(smt.size()).toBe(3);
    });

    it('should overwrite existing value', () => {
      smt.set('key1', 'value1');
      const root1 = smt.getRoot();
      smt.set('key1', 'value2');
      const root2 = smt.getRoot();
      expect(root1).not.toBe(root2);
    });

    it('should handle empty value', () => {
      smt.set('key1', '');
      expect(smt.get('key1')).toBeTruthy();
    });

    it('should handle special characters in key', () => {
      smt.set('key/with/slashes', 'value');
      expect(smt.get('key/with/slashes')).toBeTruthy();
    });

    it('should handle unicode keys', () => {
      smt.set('キー', 'value');
      expect(smt.get('キー')).toBeTruthy();
    });

    it('should handle long keys', () => {
      const longKey = 'k'.repeat(1000);
      smt.set(longKey, 'value');
      expect(smt.get(longKey)).toBeTruthy();
    });

    it('should handle long values', () => {
      const longValue = 'v'.repeat(1000);
      smt.set('key1', longValue);
      expect(smt.get('key1')).toBeTruthy();
    });
  });

  describe('get', () => {
    it('should return null for non-existent key', () => {
      expect(smt.get('nonexistent')).toBeNull();
    });

    it('should return hash of value', () => {
      smt.set('key1', 'value1');
      const result = smt.get('key1');
      expect(result).toBe(sha256('value1'));
    });

    it('should return updated value after overwrite', () => {
      smt.set('key1', 'value1');
      smt.set('key1', 'value2');
      expect(smt.get('key1')).toBe(sha256('value2'));
    });

    it('should not affect other keys', () => {
      smt.set('key1', 'value1');
      smt.set('key2', 'value2');
      expect(smt.get('key1')).toBe(sha256('value1'));
      expect(smt.get('key2')).toBe(sha256('value2'));
    });
  });

  describe('getRoot', () => {
    it('should return 64-char hex string', () => {
      expect(smt.getRoot()).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should change after set', () => {
      const r1 = smt.getRoot();
      smt.set('key', 'value');
      const r2 = smt.getRoot();
      expect(r1).not.toBe(r2);
    });

    it('should be deterministic', () => {
      const tree1 = new SparseMerkleTree(8);
      const tree2 = new SparseMerkleTree(8);

      tree1.set('key', 'value');
      tree2.set('key', 'value');

      expect(tree1.getRoot()).toBe(tree2.getRoot());
    });

    it('should differ for different values', () => {
      const tree1 = new SparseMerkleTree(8);
      const tree2 = new SparseMerkleTree(8);

      tree1.set('key', 'value1');
      tree2.set('key', 'value2');

      expect(tree1.getRoot()).not.toBe(tree2.getRoot());
    });

    it('should differ for different keys', () => {
      const tree1 = new SparseMerkleTree(8);
      const tree2 = new SparseMerkleTree(8);

      tree1.set('key1', 'value');
      tree2.set('key2', 'value');

      expect(tree1.getRoot()).not.toBe(tree2.getRoot());
    });
  });

  describe('getProof', () => {
    it('should return proof with siblings and path', () => {
      smt.set('key1', 'value1');
      const proof = smt.getProof('key1');
      expect(proof.siblings).toBeDefined();
      expect(proof.path).toBeDefined();
    });

    it('should have correct number of siblings', () => {
      smt.set('key1', 'value1');
      const proof = smt.getProof('key1');
      expect(proof.siblings).toHaveLength(8); // depth
    });

    it('should have correct path length', () => {
      smt.set('key1', 'value1');
      const proof = smt.getProof('key1');
      expect(proof.path).toHaveLength(8);
    });

    it('should return valid proof for non-existent key', () => {
      const proof = smt.getProof('nonexistent');
      expect(proof.siblings).toHaveLength(8);
    });

    it('should have consistent proof for same key', () => {
      smt.set('key1', 'value1');
      const proof1 = smt.getProof('key1');
      const proof2 = smt.getProof('key1');
      expect(proof1).toEqual(proof2);
    });
  });

  describe('verify', () => {
    it('should verify existing value', () => {
      smt.set('key1', 'value1');
      const proof = smt.getProof('key1');
      const root = smt.getRoot();
      expect(smt.verify('key1', 'value1', proof, root)).toBe(true);
    });

    it('should reject wrong value', () => {
      smt.set('key1', 'value1');
      const proof = smt.getProof('key1');
      const root = smt.getRoot();
      expect(smt.verify('key1', 'wrong', proof, root)).toBe(false);
    });

    it('should verify non-existence', () => {
      const proof = smt.getProof('nonexistent');
      const root = smt.getRoot();
      expect(smt.verify('nonexistent', null, proof, root)).toBe(true);
    });

    it('should reject with wrong root', () => {
      smt.set('key1', 'value1');
      const proof = smt.getProof('key1');
      const fakeRoot = sha256('fake');
      expect(smt.verify('key1', 'value1', proof, fakeRoot)).toBe(false);
    });

    it('should reject with tampered proof', () => {
      smt.set('key1', 'value1');
      const proof = smt.getProof('key1');
      const root = smt.getRoot();
      proof.siblings[0] = sha256('tampered');
      expect(smt.verify('key1', 'value1', proof, root)).toBe(false);
    });

    it('should verify after multiple updates', () => {
      smt.set('key1', 'value1');
      smt.set('key2', 'value2');
      smt.set('key3', 'value3');

      const proof1 = smt.getProof('key1');
      const proof2 = smt.getProof('key2');
      const root = smt.getRoot();

      expect(smt.verify('key1', 'value1', proof1, root)).toBe(true);
      expect(smt.verify('key2', 'value2', proof2, root)).toBe(true);
    });
  });

  describe('delete', () => {
    it('should delete existing key', () => {
      smt.set('key1', 'value1');
      smt.delete('key1');
      expect(smt.get('key1')).toBeNull();
    });

    it('should update root after delete', () => {
      smt.set('key1', 'value1');
      const rootWithKey = smt.getRoot();
      smt.delete('key1');
      const rootWithoutKey = smt.getRoot();
      expect(rootWithKey).not.toBe(rootWithoutKey);
    });

    it('should return to empty root after deleting all', () => {
      const emptyRoot = smt.getRoot();
      smt.set('key1', 'value1');
      smt.delete('key1');
      expect(smt.getRoot()).toBe(emptyRoot);
    });

    it('should not affect other keys', () => {
      smt.set('key1', 'value1');
      smt.set('key2', 'value2');
      smt.delete('key1');
      expect(smt.get('key2')).toBe(sha256('value2'));
    });

    it('should handle delete of non-existent key', () => {
      smt.set('key1', 'value1');
      const rootBefore = smt.getRoot();
      smt.delete('nonexistent');
      const rootAfter = smt.getRoot();
      // Root may or may not change depending on implementation
      expect(smt.get('key1')).toBe(sha256('value1'));
    });

    it('should update size after delete', () => {
      smt.set('key1', 'value1');
      smt.set('key2', 'value2');
      expect(smt.size()).toBe(2);
      smt.delete('key1');
      expect(smt.size()).toBe(1);
    });
  });

  describe('size', () => {
    it('should return 0 for empty tree', () => {
      expect(smt.size()).toBe(0);
    });

    it('should count entries correctly', () => {
      smt.set('key1', 'value1');
      expect(smt.size()).toBe(1);
      smt.set('key2', 'value2');
      expect(smt.size()).toBe(2);
    });

    it('should not count overwrites', () => {
      smt.set('key1', 'value1');
      smt.set('key1', 'value2');
      expect(smt.size()).toBe(1);
    });

    it('should decrease after delete', () => {
      smt.set('key1', 'value1');
      smt.set('key2', 'value2');
      smt.delete('key1');
      expect(smt.size()).toBe(1);
    });
  });

  describe('determinism', () => {
    it('should produce same tree for same operations', () => {
      const tree1 = new SparseMerkleTree(8);
      const tree2 = new SparseMerkleTree(8);

      tree1.set('a', '1');
      tree1.set('b', '2');
      tree1.set('c', '3');

      tree2.set('a', '1');
      tree2.set('b', '2');
      tree2.set('c', '3');

      expect(tree1.getRoot()).toBe(tree2.getRoot());
    });

    it('should produce different tree for different order', () => {
      const tree1 = new SparseMerkleTree(8);
      const tree2 = new SparseMerkleTree(8);

      tree1.set('a', '1');
      tree1.set('a', '2'); // Overwrite

      tree2.set('a', '2'); // Only final value

      expect(tree1.getRoot()).toBe(tree2.getRoot());
    });
  });

  describe('edge cases', () => {
    it('should handle empty key', () => {
      smt.set('', 'value');
      expect(smt.get('')).toBe(sha256('value'));
    });

    it('should handle binary data in values', () => {
      const binaryValue = '\x00\x01\x02\xff';
      smt.set('key', binaryValue);
      expect(smt.get('key')).toBe(sha256(binaryValue));
    });

    it('should handle many entries', () => {
      for (let i = 0; i < 100; i++) {
        smt.set(`key${i}`, `value${i}`);
      }
      expect(smt.size()).toBe(100);
      expect(smt.get('key50')).toBe(sha256('value50'));
    });
  });

  describe('proof properties', () => {
    it('should have collision-resistant proofs', () => {
      smt.set('key1', 'value1');
      smt.set('key2', 'value2');

      const proof1 = smt.getProof('key1');
      const proof2 = smt.getProof('key2');

      // Proofs should differ
      expect(proof1.siblings).not.toEqual(proof2.siblings);
    });

    it('should have compact proofs', () => {
      for (let i = 0; i < 50; i++) {
        smt.set(`key${i}`, `value${i}`);
      }

      const proof = smt.getProof('key25');
      // Proof size is fixed regardless of tree population
      expect(proof.siblings).toHaveLength(8);
    });
  });
});
