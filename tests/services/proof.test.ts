/**
 * Proof Service Tests
 */

// Mock dependencies
jest.mock('../../src/integrations/veilchain.js', () => ({
  getVeilChainClient: () => mockVeilChainClient,
}));

jest.mock('../../src/db/connection.js', () => ({
  query: jest.fn(),
}));

const mockVeilChainClient = {
  getProof: jest.fn(),
  getEntry: jest.fn(),
  getConsistencyProof: jest.fn(),
  verifyProof: jest.fn(),
  verifyConsistencyProof: jest.fn(),
  getRootHash: jest.fn(),
  getTreeSize: jest.fn(),
  getLatestEntry: jest.fn(),
};

import { ProofService } from '../../src/services/proof.js';
import { query } from '../../src/db/connection.js';

const mockQuery = query as jest.Mock;

describe('ProofService', () => {
  let service: ProofService;

  beforeEach(() => {
    service = new ProofService();
    jest.clearAllMocks();
  });

  describe('generateInclusionProof', () => {
    it('should generate inclusion proof for an entry', async () => {
      mockVeilChainClient.getProof.mockResolvedValue({
        root: 'root-hash-123',
        proof: ['sibling1', 'sibling2', 'sibling3'],
        index: 5,
        treeSize: 16,
      });
      mockVeilChainClient.getEntry.mockResolvedValue({
        entryId: 'entry-123',
        hash: 'entry-hash-456',
        data: { action: 'blob.read' },
      });

      const result = await service.generateInclusionProof('entry-123');

      expect(result).toEqual({
        entryId: 'entry-123',
        entryHash: 'entry-hash-456',
        root: 'root-hash-123',
        proof: ['sibling1', 'sibling2', 'sibling3'],
        index: BigInt(5),
        treeSize: BigInt(16),
      });
    });

    it('should use entry index + 1 as tree size if not provided', async () => {
      mockVeilChainClient.getProof.mockResolvedValue({
        root: 'root',
        proof: [],
        index: 10,
        // treeSize not provided
      });
      mockVeilChainClient.getEntry.mockResolvedValue({
        entryId: 'entry',
        hash: 'hash',
      });

      const result = await service.generateInclusionProof('entry');

      expect(result.treeSize).toBe(BigInt(11));
    });
  });

  describe('generateConsistencyProof', () => {
    it('should generate consistency proof between snapshots', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'snap-1',
            project_id: 'proj-1',
            root_hash: 'old-root',
            tree_size: '100',
            created_at: new Date('2024-01-01'),
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'snap-2',
            project_id: 'proj-1',
            root_hash: 'new-root',
            tree_size: '150',
            created_at: new Date('2024-01-02'),
          }],
        });

      mockVeilChainClient.getConsistencyProof.mockResolvedValue({
        proof: ['hash1', 'hash2', 'hash3'],
      });

      const result = await service.generateConsistencyProof('snap-1', 'snap-2');

      expect(result).toEqual({
        fromRoot: 'old-root',
        toRoot: 'new-root',
        proof: ['hash1', 'hash2', 'hash3'],
        treeSize: {
          from: BigInt(100),
          to: BigInt(150),
        },
      });
    });

    it('should throw if snapshot not found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await expect(
        service.generateConsistencyProof('missing-1', 'missing-2')
      ).rejects.toThrow('Snapshot not found');
    });
  });

  describe('verifyInclusionProof', () => {
    it('should verify valid inclusion proof', async () => {
      mockVeilChainClient.verifyProof.mockResolvedValue(true);

      const result = await service.verifyInclusionProof({
        entryId: 'entry-123',
        entryHash: 'hash-456',
        root: 'root-789',
        proof: ['s1', 's2'],
        index: BigInt(5),
        treeSize: BigInt(16),
      });

      expect(result.valid).toBe(true);
      expect(result.type).toBe('inclusion');
      expect(result.verifiedAt).toBeInstanceOf(Date);
    });

    it('should return false for invalid proof', async () => {
      mockVeilChainClient.verifyProof.mockResolvedValue(false);

      const result = await service.verifyInclusionProof({
        entryId: 'entry',
        entryHash: 'wrong-hash',
        root: 'root',
        proof: [],
        index: BigInt(0),
        treeSize: BigInt(1),
      });

      expect(result.valid).toBe(false);
    });
  });

  describe('verifyConsistencyProof', () => {
    it('should verify valid consistency proof', async () => {
      mockVeilChainClient.verifyConsistencyProof.mockResolvedValue(true);

      const result = await service.verifyConsistencyProof({
        fromRoot: 'old-root',
        toRoot: 'new-root',
        proof: ['h1', 'h2'],
        treeSize: {
          from: BigInt(100),
          to: BigInt(150),
        },
      });

      expect(result.valid).toBe(true);
      expect(result.type).toBe('consistency');
      expect(result.details).toEqual({
        fromRoot: 'old-root',
        toRoot: 'new-root',
        fromSize: '100',
        toSize: '150',
      });
    });

    it('should return false for invalid consistency proof', async () => {
      mockVeilChainClient.verifyConsistencyProof.mockResolvedValue(false);

      const result = await service.verifyConsistencyProof({
        fromRoot: 'tampered',
        toRoot: 'new',
        proof: [],
        treeSize: { from: BigInt(10), to: BigInt(20) },
      });

      expect(result.valid).toBe(false);
    });
  });

  describe('createSnapshot', () => {
    it('should create audit snapshot', async () => {
      mockVeilChainClient.getRootHash.mockResolvedValue('current-root-hash');
      mockVeilChainClient.getTreeSize.mockResolvedValue(BigInt(500));
      mockQuery.mockResolvedValue({
        rows: [{ id: 'snapshot-uuid-123' }],
      });

      const result = await service.createSnapshot('project-1' as any);

      expect(result).toEqual({
        snapshotId: 'snapshot-uuid-123',
        projectId: 'project-1',
        root: 'current-root-hash',
        treeSize: BigInt(500),
        timestamp: expect.any(Date),
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_snapshots'),
        ['project-1', 'current-root-hash', '500']
      );
    });
  });

  describe('getSnapshot', () => {
    it('should return snapshot by ID', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 'snap-123',
          project_id: 'proj-1',
          root_hash: 'root-abc',
          tree_size: '200',
          created_at: new Date('2024-01-15'),
        }],
      });

      const result = await service.getSnapshot('snap-123');

      expect(result).toEqual({
        snapshotId: 'snap-123',
        projectId: 'proj-1',
        root: 'root-abc',
        treeSize: BigInt(200),
        timestamp: new Date('2024-01-15'),
      });
    });

    it('should return null for non-existent snapshot', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await service.getSnapshot('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('listSnapshots', () => {
    it('should list snapshots for project', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'snap-1',
            project_id: 'proj-1',
            root_hash: 'root-1',
            tree_size: '100',
            created_at: new Date('2024-01-02'),
          },
          {
            id: 'snap-2',
            project_id: 'proj-1',
            root_hash: 'root-2',
            tree_size: '150',
            created_at: new Date('2024-01-01'),
          },
        ],
      });

      const result = await service.listSnapshots('proj-1' as any, 10);

      expect(result).toHaveLength(2);
      expect(result[0]!.snapshotId).toBe('snap-1');
      expect(result[1]!.snapshotId).toBe('snap-2');
    });

    it('should respect limit parameter', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await service.listSnapshots('proj-1' as any, 5);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2'),
        ['proj-1', 5]
      );
    });
  });

  describe('exportProofBundle', () => {
    it('should export proof bundle for entries', async () => {
      mockVeilChainClient.getRootHash.mockResolvedValue('current-root');
      mockVeilChainClient.getEntry
        .mockResolvedValueOnce({ entryId: 'e1', hash: 'h1' })
        .mockResolvedValueOnce({ entryId: 'e2', hash: 'h2' });
      mockVeilChainClient.getProof
        .mockResolvedValueOnce({ root: 'root', proof: ['p1'], index: 0, treeSize: 2 })
        .mockResolvedValueOnce({ root: 'root', proof: ['p2'], index: 1, treeSize: 2 });

      const result = await service.exportProofBundle(['e1', 'e2']);

      expect(result.entries).toHaveLength(2);
      expect(result.currentRoot).toBe('current-root');
      expect(result.verificationInstructions).toContain('verify');
      expect(result.exportedAt).toBeInstanceOf(Date);
    });

    it('should include proofs for each entry', async () => {
      mockVeilChainClient.getRootHash.mockResolvedValue('root');
      mockVeilChainClient.getEntry.mockResolvedValue({ entryId: 'e1', hash: 'h1' });
      mockVeilChainClient.getProof.mockResolvedValue({
        root: 'root',
        proof: ['sibling'],
        index: 0,
        treeSize: 2,
      });

      const result = await service.exportProofBundle(['e1']);

      expect(result.entries[0]).toEqual({
        id: 'e1',
        hash: 'h1',
        proof: {
          entryId: 'e1',
          entryHash: 'h1',
          root: 'root',
          proof: ['sibling'],
          index: BigInt(0),
          treeSize: BigInt(2),
        },
      });
    });
  });

  describe('getTreeState', () => {
    it('should return current tree state', async () => {
      mockVeilChainClient.getRootHash.mockResolvedValue('latest-root');
      mockVeilChainClient.getTreeSize.mockResolvedValue(BigInt(1000));
      mockVeilChainClient.getLatestEntry.mockResolvedValue({
        entryId: 'latest-entry-id',
      });

      const result = await service.getTreeState();

      expect(result).toEqual({
        root: 'latest-root',
        treeSize: BigInt(1000),
        lastEntryId: 'latest-entry-id',
      });
    });

    it('should handle empty tree', async () => {
      mockVeilChainClient.getRootHash.mockResolvedValue('empty-root');
      mockVeilChainClient.getTreeSize.mockResolvedValue(BigInt(0));
      mockVeilChainClient.getLatestEntry.mockResolvedValue(null);

      const result = await service.getTreeState();

      expect(result.lastEntryId).toBeNull();
    });
  });

  describe('computeDirections (private method via verifyInclusionProof)', () => {
    it('should compute correct directions for left leaf', async () => {
      mockVeilChainClient.verifyProof.mockImplementation(({ directions }) => {
        // Index 0 in tree of size 4 should have right siblings
        expect(directions[0]).toBe('right');
        expect(directions[1]).toBe('right');
        return true;
      });

      await service.verifyInclusionProof({
        entryId: 'e',
        entryHash: 'h',
        root: 'r',
        proof: ['s1', 's2'],
        index: BigInt(0),
        treeSize: BigInt(4),
      });
    });

    it('should compute correct directions for right leaf', async () => {
      mockVeilChainClient.verifyProof.mockImplementation(({ directions }) => {
        // Index 1 in tree of size 2 should have left sibling
        expect(directions[0]).toBe('left');
        return true;
      });

      await service.verifyInclusionProof({
        entryId: 'e',
        entryHash: 'h',
        root: 'r',
        proof: ['s1'],
        index: BigInt(1),
        treeSize: BigInt(2),
      });
    });
  });
});
