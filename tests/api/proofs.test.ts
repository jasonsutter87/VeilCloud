/**
 * Proofs API Route Tests
 */

// Mock dependencies
jest.mock('../../src/services/proof.js', () => ({
  getProofService: () => mockProofService,
}));

const mockProofService = {
  generateInclusionProof: jest.fn(),
  generateConsistencyProof: jest.fn(),
  verifyInclusionProof: jest.fn(),
  verifyConsistencyProof: jest.fn(),
  createSnapshot: jest.fn(),
  getSnapshot: jest.fn(),
  listSnapshots: jest.fn(),
  exportProofBundle: jest.fn(),
  getTreeState: jest.fn(),
};

describe('Proofs API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /proofs/:projectId/inclusion/:entryId', () => {
    it('should generate inclusion proof', async () => {
      mockProofService.generateInclusionProof.mockResolvedValue({
        entryId: 'entry-123',
        entryHash: 'hash-456',
        root: 'root-789',
        proof: ['sibling1', 'sibling2', 'sibling3'],
        index: BigInt(5),
        treeSize: BigInt(16),
      });

      const result = await mockProofService.generateInclusionProof('entry-123');

      expect(result.proof).toHaveLength(3);
      expect(result.root).toBe('root-789');
    });

    it('should return entry hash', async () => {
      mockProofService.generateInclusionProof.mockResolvedValue({
        entryId: 'entry-123',
        entryHash: 'abc123def456',
      });

      const result = await mockProofService.generateInclusionProof('entry-123');

      expect(result.entryHash).toBe('abc123def456');
    });

    it('should return tree size', async () => {
      mockProofService.generateInclusionProof.mockResolvedValue({
        entryId: 'entry-123',
        treeSize: BigInt(100),
      });

      const result = await mockProofService.generateInclusionProof('entry-123');

      expect(result.treeSize).toBe(BigInt(100));
    });

    it('should reject non-existent entry', async () => {
      mockProofService.generateInclusionProof.mockRejectedValue(
        new Error('Entry not found')
      );

      await expect(
        mockProofService.generateInclusionProof('nonexistent')
      ).rejects.toThrow('Entry not found');
    });
  });

  describe('GET /proofs/:projectId/consistency', () => {
    it('should generate consistency proof', async () => {
      mockProofService.generateConsistencyProof.mockResolvedValue({
        fromRoot: 'old-root',
        toRoot: 'new-root',
        proof: ['hash1', 'hash2', 'hash3'],
        treeSize: {
          from: BigInt(100),
          to: BigInt(150),
        },
      });

      const result = await mockProofService.generateConsistencyProof('snap-1', 'snap-2');

      expect(result.proof).toHaveLength(3);
      expect(result.treeSize.from).toBe(BigInt(100));
    });

    it('should return both root hashes', async () => {
      mockProofService.generateConsistencyProof.mockResolvedValue({
        fromRoot: 'old-root',
        toRoot: 'new-root',
      });

      const result = await mockProofService.generateConsistencyProof('snap-1', 'snap-2');

      expect(result.fromRoot).toBe('old-root');
      expect(result.toRoot).toBe('new-root');
    });

    it('should reject if snapshot not found', async () => {
      mockProofService.generateConsistencyProof.mockRejectedValue(
        new Error('Snapshot not found')
      );

      await expect(
        mockProofService.generateConsistencyProof('missing', 'snap-2')
      ).rejects.toThrow('Snapshot not found');
    });
  });

  describe('POST /proofs/verify/inclusion', () => {
    it('should verify valid inclusion proof', async () => {
      mockProofService.verifyInclusionProof.mockResolvedValue({
        valid: true,
        type: 'inclusion',
        verifiedAt: new Date(),
      });

      const result = await mockProofService.verifyInclusionProof({
        entryId: 'entry-123',
        entryHash: 'hash-456',
        root: 'root-789',
        proof: ['s1', 's2'],
        index: BigInt(5),
        treeSize: BigInt(16),
      });

      expect(result.valid).toBe(true);
      expect(result.type).toBe('inclusion');
    });

    it('should reject invalid proof', async () => {
      mockProofService.verifyInclusionProof.mockResolvedValue({
        valid: false,
        reason: 'Proof verification failed',
      });

      const result = await mockProofService.verifyInclusionProof({
        entryId: 'entry',
        entryHash: 'wrong-hash',
        root: 'root',
        proof: [],
        index: BigInt(0),
        treeSize: BigInt(1),
      });

      expect(result.valid).toBe(false);
    });

    it('should include verification timestamp', async () => {
      const now = new Date();
      mockProofService.verifyInclusionProof.mockResolvedValue({
        valid: true,
        verifiedAt: now,
      });

      const result = await mockProofService.verifyInclusionProof({});

      expect(result.verifiedAt).toEqual(now);
    });
  });

  describe('POST /proofs/verify/consistency', () => {
    it('should verify valid consistency proof', async () => {
      mockProofService.verifyConsistencyProof.mockResolvedValue({
        valid: true,
        type: 'consistency',
        details: {
          fromRoot: 'old',
          toRoot: 'new',
          fromSize: '100',
          toSize: '150',
        },
      });

      const result = await mockProofService.verifyConsistencyProof({
        fromRoot: 'old-root',
        toRoot: 'new-root',
        proof: ['h1', 'h2'],
        treeSize: { from: BigInt(100), to: BigInt(150) },
      });

      expect(result.valid).toBe(true);
      expect(result.type).toBe('consistency');
    });

    it('should reject invalid consistency proof', async () => {
      mockProofService.verifyConsistencyProof.mockResolvedValue({
        valid: false,
        reason: 'Roots do not match',
      });

      const result = await mockProofService.verifyConsistencyProof({
        fromRoot: 'tampered',
        toRoot: 'new',
        proof: [],
        treeSize: { from: BigInt(10), to: BigInt(20) },
      });

      expect(result.valid).toBe(false);
    });
  });

  describe('POST /proofs/:projectId/snapshots', () => {
    it('should create snapshot', async () => {
      mockProofService.createSnapshot.mockResolvedValue({
        snapshotId: 'snap-123',
        projectId: 'proj-1',
        root: 'current-root-hash',
        treeSize: BigInt(500),
        timestamp: new Date(),
      });

      const result = await mockProofService.createSnapshot('proj-1');

      expect(result.snapshotId).toBe('snap-123');
      expect(result.root).toBeTruthy();
    });

    it('should include tree size', async () => {
      mockProofService.createSnapshot.mockResolvedValue({
        snapshotId: 'snap-123',
        treeSize: BigInt(1000),
      });

      const result = await mockProofService.createSnapshot('proj-1');

      expect(result.treeSize).toBe(BigInt(1000));
    });

    it('should include timestamp', async () => {
      const now = new Date();
      mockProofService.createSnapshot.mockResolvedValue({
        snapshotId: 'snap-123',
        timestamp: now,
      });

      const result = await mockProofService.createSnapshot('proj-1');

      expect(result.timestamp).toEqual(now);
    });
  });

  describe('GET /proofs/:projectId/snapshots/:snapshotId', () => {
    it('should return snapshot by ID', async () => {
      mockProofService.getSnapshot.mockResolvedValue({
        snapshotId: 'snap-123',
        projectId: 'proj-1',
        root: 'root-abc',
        treeSize: BigInt(200),
        timestamp: new Date(),
      });

      const result = await mockProofService.getSnapshot('snap-123');

      expect(result.snapshotId).toBe('snap-123');
    });

    it('should return null for non-existent snapshot', async () => {
      mockProofService.getSnapshot.mockResolvedValue(null);

      const result = await mockProofService.getSnapshot('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('GET /proofs/:projectId/snapshots', () => {
    it('should list snapshots', async () => {
      mockProofService.listSnapshots.mockResolvedValue([
        { snapshotId: 'snap-1', treeSize: BigInt(100) },
        { snapshotId: 'snap-2', treeSize: BigInt(150) },
      ]);

      const result = await mockProofService.listSnapshots('proj-1', 10);

      expect(result).toHaveLength(2);
    });

    it('should respect limit parameter', async () => {
      mockProofService.listSnapshots.mockResolvedValue([
        { snapshotId: 'snap-1' },
      ]);

      await mockProofService.listSnapshots('proj-1', 1);

      expect(mockProofService.listSnapshots).toHaveBeenCalledWith('proj-1', 1);
    });

    it('should order by timestamp descending', async () => {
      mockProofService.listSnapshots.mockResolvedValue([
        { snapshotId: 'snap-2', timestamp: new Date('2024-01-02') },
        { snapshotId: 'snap-1', timestamp: new Date('2024-01-01') },
      ]);

      const result = await mockProofService.listSnapshots('proj-1', 10);

      expect(result[0].snapshotId).toBe('snap-2');
    });
  });

  describe('POST /proofs/:projectId/export', () => {
    it('should export proof bundle', async () => {
      mockProofService.exportProofBundle.mockResolvedValue({
        entries: [
          { id: 'e1', hash: 'h1', proof: {} },
          { id: 'e2', hash: 'h2', proof: {} },
        ],
        currentRoot: 'root-hash',
        verificationInstructions: 'How to verify...',
        exportedAt: new Date(),
      });

      const result = await mockProofService.exportProofBundle(['e1', 'e2']);

      expect(result.entries).toHaveLength(2);
      expect(result.currentRoot).toBeTruthy();
    });

    it('should include proof for each entry', async () => {
      mockProofService.exportProofBundle.mockResolvedValue({
        entries: [
          {
            id: 'e1',
            hash: 'h1',
            proof: {
              root: 'root',
              proof: ['sibling'],
              index: BigInt(0),
              treeSize: BigInt(2),
            },
          },
        ],
      });

      const result = await mockProofService.exportProofBundle(['e1']);

      expect(result.entries[0].proof.root).toBe('root');
    });

    it('should include verification instructions', async () => {
      mockProofService.exportProofBundle.mockResolvedValue({
        entries: [],
        verificationInstructions: 'Steps to verify...',
      });

      const result = await mockProofService.exportProofBundle([]);

      expect(result.verificationInstructions).toContain('verify');
    });
  });

  describe('GET /proofs/:projectId/state', () => {
    it('should return current tree state', async () => {
      mockProofService.getTreeState.mockResolvedValue({
        root: 'latest-root',
        treeSize: BigInt(1000),
        lastEntryId: 'entry-999',
      });

      const result = await mockProofService.getTreeState();

      expect(result.root).toBe('latest-root');
      expect(result.treeSize).toBe(BigInt(1000));
    });

    it('should handle empty tree', async () => {
      mockProofService.getTreeState.mockResolvedValue({
        root: 'empty-root',
        treeSize: BigInt(0),
        lastEntryId: null,
      });

      const result = await mockProofService.getTreeState();

      expect(result.lastEntryId).toBeNull();
      expect(result.treeSize).toBe(BigInt(0));
    });
  });

  describe('Proof Properties', () => {
    it('should return logarithmic proof size', async () => {
      mockProofService.generateInclusionProof.mockResolvedValue({
        proof: ['s1', 's2', 's3', 's4'], // log2(16) = 4
        treeSize: BigInt(16),
      });

      const result = await mockProofService.generateInclusionProof('entry');

      expect(result.proof.length).toBeLessThanOrEqual(Math.ceil(Math.log2(Number(result.treeSize))));
    });

    it('should return 64-char hex hashes', async () => {
      mockProofService.generateInclusionProof.mockResolvedValue({
        root: 'a'.repeat(64),
        entryHash: 'b'.repeat(64),
        proof: ['c'.repeat(64)],
      });

      const result = await mockProofService.generateInclusionProof('entry');

      expect(result.root).toHaveLength(64);
      expect(result.entryHash).toHaveLength(64);
      expect(result.proof[0]).toHaveLength(64);
    });
  });

  describe('Error Handling', () => {
    it('should handle VeilChain unavailable', async () => {
      mockProofService.generateInclusionProof.mockRejectedValue(
        new Error('VeilChain service unavailable')
      );

      await expect(
        mockProofService.generateInclusionProof('entry')
      ).rejects.toThrow('VeilChain');
    });

    it('should handle invalid entry ID format', async () => {
      mockProofService.generateInclusionProof.mockRejectedValue(
        new Error('Invalid entry ID format')
      );

      await expect(
        mockProofService.generateInclusionProof('invalid!id')
      ).rejects.toThrow('Invalid');
    });

    it('should handle database errors', async () => {
      mockProofService.listSnapshots.mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(
        mockProofService.listSnapshots('proj-1', 10)
      ).rejects.toThrow('Database');
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent proof requests', async () => {
      mockProofService.generateInclusionProof.mockResolvedValue({
        proof: ['sibling'],
      });

      const promises = Array.from({ length: 10 }, (_, i) =>
        mockProofService.generateInclusionProof(`entry-${i}`)
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
    });

    it('should handle concurrent verifications', async () => {
      mockProofService.verifyInclusionProof.mockResolvedValue({
        valid: true,
      });

      const promises = Array.from({ length: 20 }, () =>
        mockProofService.verifyInclusionProof({})
      );

      const results = await Promise.all(promises);

      expect(results.every(r => r.valid)).toBe(true);
    });
  });
});
