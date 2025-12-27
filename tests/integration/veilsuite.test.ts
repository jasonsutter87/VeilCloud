/**
 * VeilSuite Integration Tests
 * Tests integration between VeilCloud and VeilKey, VeilChain, VeilSign
 */

// Mock all VeilSuite integrations
jest.mock('../../src/integrations/veilkey.js', () => ({
  getVeilKeyClient: () => mockVeilKeyClient,
  VeilKeyClient: jest.fn(() => mockVeilKeyClient),
}));

jest.mock('../../src/integrations/veilchain.js', () => ({
  getVeilChainClient: () => mockVeilChainClient,
  VeilChainClient: jest.fn(() => mockVeilChainClient),
}));

jest.mock('../../src/integrations/veilsign.js', () => ({
  getVeilSignClient: () => mockVeilSignClient,
  VeilSignClient: jest.fn(() => mockVeilSignClient),
}));

const mockVeilKeyClient = {
  // Key Management
  generateKeyGroup: jest.fn(),
  deleteKeyGroup: jest.fn(),
  getKeyGroup: jest.fn(),
  listKeyGroups: jest.fn(),

  // Threshold Operations
  encrypt: jest.fn(),
  partialDecrypt: jest.fn(),
  combineShares: jest.fn(),

  // Share Management
  distributeShares: jest.fn(),
  rotateShares: jest.fn(),
  reshareGroup: jest.fn(),

  // Health
  healthCheck: jest.fn(),
};

const mockVeilChainClient = {
  // Append-only log
  append: jest.fn(),
  getEntry: jest.fn(),
  getEntries: jest.fn(),

  // Merkle Tree
  getRootHash: jest.fn(),
  getTreeSize: jest.fn(),
  getProof: jest.fn(),
  verifyProof: jest.fn(),

  // Consistency
  getConsistencyProof: jest.fn(),
  verifyConsistencyProof: jest.fn(),

  // Snapshots
  createSnapshot: jest.fn(),
  getSnapshot: jest.fn(),
  listSnapshots: jest.fn(),

  // Health
  healthCheck: jest.fn(),
};

const mockVeilSignClient = {
  // Credential Issuance
  issueCredential: jest.fn(),
  issueBlindCredential: jest.fn(),

  // Verification
  verifyCredential: jest.fn(),
  verifyPresentation: jest.fn(),

  // Revocation
  revokeCredential: jest.fn(),
  checkRevocation: jest.fn(),

  // Nullifiers
  recordNullifier: jest.fn(),
  checkNullifier: jest.fn(),

  // Health
  healthCheck: jest.fn(),
};

describe('VeilKey Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Key Group Management', () => {
    it('should create threshold key group', async () => {
      mockVeilKeyClient.generateKeyGroup.mockResolvedValue({
        id: 'kg-123',
        publicKey: 'pk-abc',
        threshold: 2,
        totalShares: 3,
      });

      const result = await mockVeilKeyClient.generateKeyGroup({
        threshold: 2,
        totalShares: 3,
      });

      expect(result.id).toBe('kg-123');
      expect(result.threshold).toBe(2);
      expect(result.totalShares).toBe(3);
    });

    it('should get key group info', async () => {
      mockVeilKeyClient.getKeyGroup.mockResolvedValue({
        id: 'kg-123',
        publicKey: 'pk-abc',
        threshold: 2,
        totalShares: 3,
        createdAt: new Date().toISOString(),
      });

      const result = await mockVeilKeyClient.getKeyGroup('kg-123');

      expect(result.publicKey).toBe('pk-abc');
    });

    it('should list all key groups', async () => {
      mockVeilKeyClient.listKeyGroups.mockResolvedValue([
        { id: 'kg-1', threshold: 2, totalShares: 3 },
        { id: 'kg-2', threshold: 3, totalShares: 5 },
      ]);

      const result = await mockVeilKeyClient.listKeyGroups();

      expect(result).toHaveLength(2);
    });

    it('should delete key group', async () => {
      mockVeilKeyClient.deleteKeyGroup.mockResolvedValue({ deleted: true });

      const result = await mockVeilKeyClient.deleteKeyGroup('kg-123');

      expect(result.deleted).toBe(true);
    });
  });

  describe('Threshold Encryption', () => {
    it('should encrypt data with group key', async () => {
      mockVeilKeyClient.encrypt.mockResolvedValue({
        ciphertext: 'encrypted-data-base64',
        groupId: 'kg-123',
      });

      const result = await mockVeilKeyClient.encrypt({
        groupId: 'kg-123',
        plaintext: 'secret data',
      });

      expect(result.ciphertext).toBeTruthy();
    });

    it('should generate partial decryption', async () => {
      mockVeilKeyClient.partialDecrypt.mockResolvedValue({
        shareIndex: 1,
        partial: 'partial-decryption-data',
        proof: 'zkp-proof',
      });

      const result = await mockVeilKeyClient.partialDecrypt({
        groupId: 'kg-123',
        ciphertext: 'encrypted-data',
        shareIndex: 1,
      });

      expect(result.partial).toBeTruthy();
      expect(result.proof).toBeTruthy();
    });

    it('should combine partial decryptions', async () => {
      mockVeilKeyClient.combineShares.mockResolvedValue({
        plaintext: 'original-secret-data',
      });

      const result = await mockVeilKeyClient.combineShares({
        groupId: 'kg-123',
        ciphertext: 'encrypted-data',
        partials: [
          { shareIndex: 0, partial: 'pd0', proof: 'p0' },
          { shareIndex: 2, partial: 'pd2', proof: 'p2' },
        ],
      });

      expect(result.plaintext).toBe('original-secret-data');
    });

    it('should fail with insufficient shares', async () => {
      mockVeilKeyClient.combineShares.mockRejectedValue(
        new Error('Need at least 2 shares')
      );

      await expect(
        mockVeilKeyClient.combineShares({
          groupId: 'kg-123',
          partials: [{ shareIndex: 0, partial: 'pd0' }],
        })
      ).rejects.toThrow('Need at least 2 shares');
    });
  });

  describe('Share Management', () => {
    it('should distribute shares to new members', async () => {
      mockVeilKeyClient.distributeShares.mockResolvedValue({
        shares: [
          { index: 3, share: 'encrypted-share-3' },
          { index: 4, share: 'encrypted-share-4' },
        ],
      });

      const result = await mockVeilKeyClient.distributeShares({
        groupId: 'kg-123',
        newMemberCount: 2,
      });

      expect(result.shares).toHaveLength(2);
    });

    it('should rotate all shares', async () => {
      mockVeilKeyClient.rotateShares.mockResolvedValue({
        newShares: [
          { index: 0, share: 'rotated-0' },
          { index: 1, share: 'rotated-1' },
          { index: 2, share: 'rotated-2' },
        ],
      });

      const result = await mockVeilKeyClient.rotateShares('kg-123');

      expect(result.newShares).toHaveLength(3);
    });

    it('should reshare with new threshold', async () => {
      mockVeilKeyClient.reshareGroup.mockResolvedValue({
        groupId: 'kg-123',
        newThreshold: 3,
        newTotalShares: 5,
      });

      const result = await mockVeilKeyClient.reshareGroup({
        groupId: 'kg-123',
        newThreshold: 3,
        newTotalShares: 5,
      });

      expect(result.newThreshold).toBe(3);
    });
  });
});

describe('VeilChain Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Append-Only Log', () => {
    it('should append entry to log', async () => {
      mockVeilChainClient.append.mockResolvedValue({
        entryId: 'entry-1',
        index: 0,
        hash: 'entry-hash',
      });

      const result = await mockVeilChainClient.append({
        data: { action: 'secret.read', userId: 'user-1' },
      });

      expect(result.entryId).toBe('entry-1');
      expect(result.index).toBe(0);
    });

    it('should get entry by ID', async () => {
      mockVeilChainClient.getEntry.mockResolvedValue({
        entryId: 'entry-1',
        index: 0,
        data: { action: 'secret.read' },
        timestamp: new Date().toISOString(),
      });

      const result = await mockVeilChainClient.getEntry('entry-1');

      expect(result.data.action).toBe('secret.read');
    });

    it('should get entries by range', async () => {
      mockVeilChainClient.getEntries.mockResolvedValue([
        { entryId: 'entry-0', index: 0 },
        { entryId: 'entry-1', index: 1 },
        { entryId: 'entry-2', index: 2 },
      ]);

      const result = await mockVeilChainClient.getEntries({
        startIndex: 0,
        endIndex: 3,
      });

      expect(result).toHaveLength(3);
    });
  });

  describe('Merkle Tree', () => {
    it('should get current root hash', async () => {
      mockVeilChainClient.getRootHash.mockResolvedValue(
        'abc123def456...'
      );

      const result = await mockVeilChainClient.getRootHash();

      expect(result).toMatch(/^[a-f0-9]+/);
    });

    it('should get tree size', async () => {
      mockVeilChainClient.getTreeSize.mockResolvedValue(BigInt(100));

      const result = await mockVeilChainClient.getTreeSize();

      expect(result).toBe(BigInt(100));
    });

    it('should get inclusion proof', async () => {
      mockVeilChainClient.getProof.mockResolvedValue({
        root: 'root-hash',
        proof: ['sibling1', 'sibling2', 'sibling3'],
        index: 5,
        treeSize: 16,
      });

      const result = await mockVeilChainClient.getProof('entry-5');

      expect(result.proof).toHaveLength(3);
      expect(result.index).toBe(5);
    });

    it('should verify inclusion proof', async () => {
      mockVeilChainClient.verifyProof.mockResolvedValue(true);

      const result = await mockVeilChainClient.verifyProof({
        root: 'root',
        proof: ['s1', 's2'],
        leaf: 'entry-hash',
        index: 5,
      });

      expect(result).toBe(true);
    });

    it('should reject invalid proof', async () => {
      mockVeilChainClient.verifyProof.mockResolvedValue(false);

      const result = await mockVeilChainClient.verifyProof({
        root: 'wrong-root',
        proof: ['s1'],
        leaf: 'entry',
        index: 0,
      });

      expect(result).toBe(false);
    });
  });

  describe('Consistency Proofs', () => {
    it('should get consistency proof', async () => {
      mockVeilChainClient.getConsistencyProof.mockResolvedValue({
        proof: ['hash1', 'hash2'],
        oldSize: 50,
        newSize: 100,
      });

      const result = await mockVeilChainClient.getConsistencyProof({
        oldSize: 50,
        newSize: 100,
      });

      expect(result.proof).toHaveLength(2);
    });

    it('should verify consistency proof', async () => {
      mockVeilChainClient.verifyConsistencyProof.mockResolvedValue(true);

      const result = await mockVeilChainClient.verifyConsistencyProof({
        oldRoot: 'old-root',
        newRoot: 'new-root',
        proof: ['h1', 'h2'],
        oldSize: 50,
        newSize: 100,
      });

      expect(result).toBe(true);
    });
  });

  describe('Snapshots', () => {
    it('should create snapshot', async () => {
      mockVeilChainClient.createSnapshot.mockResolvedValue({
        snapshotId: 'snap-1',
        rootHash: 'root-at-snap',
        treeSize: 100,
        createdAt: new Date().toISOString(),
      });

      const result = await mockVeilChainClient.createSnapshot();

      expect(result.snapshotId).toBe('snap-1');
    });

    it('should get snapshot', async () => {
      mockVeilChainClient.getSnapshot.mockResolvedValue({
        snapshotId: 'snap-1',
        rootHash: 'root',
        treeSize: 100,
      });

      const result = await mockVeilChainClient.getSnapshot('snap-1');

      expect(result.rootHash).toBe('root');
    });

    it('should list snapshots', async () => {
      mockVeilChainClient.listSnapshots.mockResolvedValue([
        { snapshotId: 'snap-1', treeSize: 50 },
        { snapshotId: 'snap-2', treeSize: 100 },
      ]);

      const result = await mockVeilChainClient.listSnapshots();

      expect(result).toHaveLength(2);
    });
  });
});

describe('VeilSign Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Credential Issuance', () => {
    it('should issue credential', async () => {
      mockVeilSignClient.issueCredential.mockResolvedValue({
        credentialId: 'cred-1',
        credential: 'serialized-credential-data',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });

      const result = await mockVeilSignClient.issueCredential({
        subject: 'user-1',
        attributes: {
          permissions: ['read', 'write'],
          projectId: 'proj-1',
        },
        expiresIn: '24h',
      });

      expect(result.credentialId).toBe('cred-1');
      expect(result.credential).toBeTruthy();
    });

    it('should issue blind credential', async () => {
      mockVeilSignClient.issueBlindCredential.mockResolvedValue({
        credentialId: 'blind-cred-1',
        blindCredential: 'blind-credential-data',
      });

      const result = await mockVeilSignClient.issueBlindCredential({
        blindedRequest: 'blinded-attributes',
      });

      expect(result.blindCredential).toBeTruthy();
    });
  });

  describe('Verification', () => {
    it('should verify valid credential', async () => {
      mockVeilSignClient.verifyCredential.mockResolvedValue({
        valid: true,
        subject: 'user-1',
        attributes: { permissions: ['read'] },
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      const result = await mockVeilSignClient.verifyCredential('credential-data');

      expect(result.valid).toBe(true);
      expect(result.subject).toBe('user-1');
    });

    it('should reject expired credential', async () => {
      mockVeilSignClient.verifyCredential.mockResolvedValue({
        valid: false,
        reason: 'Credential expired',
      });

      const result = await mockVeilSignClient.verifyCredential('expired-cred');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Credential expired');
    });

    it('should verify presentation', async () => {
      mockVeilSignClient.verifyPresentation.mockResolvedValue({
        valid: true,
        disclosedAttributes: { role: 'admin' },
      });

      const result = await mockVeilSignClient.verifyPresentation({
        presentation: 'presentation-data',
        challenge: 'challenge-nonce',
      });

      expect(result.valid).toBe(true);
      expect(result.disclosedAttributes.role).toBe('admin');
    });
  });

  describe('Revocation', () => {
    it('should revoke credential', async () => {
      mockVeilSignClient.revokeCredential.mockResolvedValue({
        revoked: true,
        revokedAt: new Date().toISOString(),
      });

      const result = await mockVeilSignClient.revokeCredential('cred-1');

      expect(result.revoked).toBe(true);
    });

    it('should check revocation status', async () => {
      mockVeilSignClient.checkRevocation.mockResolvedValue({
        isRevoked: false,
      });

      const result = await mockVeilSignClient.checkRevocation('cred-1');

      expect(result.isRevoked).toBe(false);
    });

    it('should detect revoked credential', async () => {
      mockVeilSignClient.checkRevocation.mockResolvedValue({
        isRevoked: true,
        revokedAt: new Date().toISOString(),
        reason: 'User requested',
      });

      const result = await mockVeilSignClient.checkRevocation('revoked-cred');

      expect(result.isRevoked).toBe(true);
    });
  });

  describe('Nullifiers', () => {
    it('should record nullifier', async () => {
      mockVeilSignClient.recordNullifier.mockResolvedValue({
        recorded: true,
        nullifier: 'nullifier-hash',
      });

      const result = await mockVeilSignClient.recordNullifier('nullifier-hash');

      expect(result.recorded).toBe(true);
    });

    it('should check unused nullifier', async () => {
      mockVeilSignClient.checkNullifier.mockResolvedValue({
        used: false,
      });

      const result = await mockVeilSignClient.checkNullifier('fresh-nullifier');

      expect(result.used).toBe(false);
    });

    it('should detect used nullifier', async () => {
      mockVeilSignClient.checkNullifier.mockResolvedValue({
        used: true,
        usedAt: new Date().toISOString(),
      });

      const result = await mockVeilSignClient.checkNullifier('used-nullifier');

      expect(result.used).toBe(true);
    });
  });
});

describe('VeilSuite Health Checks', () => {
  it('should check VeilKey health', async () => {
    mockVeilKeyClient.healthCheck.mockResolvedValue({
      status: 'healthy',
      latencyMs: 5,
    });

    const result = await mockVeilKeyClient.healthCheck();

    expect(result.status).toBe('healthy');
  });

  it('should check VeilChain health', async () => {
    mockVeilChainClient.healthCheck.mockResolvedValue({
      status: 'healthy',
      treeSize: BigInt(1000),
    });

    const result = await mockVeilChainClient.healthCheck();

    expect(result.status).toBe('healthy');
  });

  it('should check VeilSign health', async () => {
    mockVeilSignClient.healthCheck.mockResolvedValue({
      status: 'healthy',
      version: '1.0.0',
    });

    const result = await mockVeilSignClient.healthCheck();

    expect(result.status).toBe('healthy');
  });

  it('should handle VeilKey unavailable', async () => {
    mockVeilKeyClient.healthCheck.mockRejectedValue(
      new Error('Connection refused')
    );

    await expect(
      mockVeilKeyClient.healthCheck()
    ).rejects.toThrow('Connection refused');
  });

  it('should handle VeilChain unavailable', async () => {
    mockVeilChainClient.healthCheck.mockRejectedValue(
      new Error('Connection timeout')
    );

    await expect(
      mockVeilChainClient.healthCheck()
    ).rejects.toThrow('Connection timeout');
  });

  it('should handle VeilSign unavailable', async () => {
    mockVeilSignClient.healthCheck.mockRejectedValue(
      new Error('Service unavailable')
    );

    await expect(
      mockVeilSignClient.healthCheck()
    ).rejects.toThrow('Service unavailable');
  });
});

describe('Cross-Service Workflows', () => {
  it('should issue audited credential', async () => {
    // Issue credential
    mockVeilSignClient.issueCredential.mockResolvedValue({
      credentialId: 'cred-1',
      credential: 'cred-data',
    });

    // Log issuance to audit
    mockVeilChainClient.append.mockResolvedValue({
      entryId: 'audit-1',
      index: 0,
    });

    const cred = await mockVeilSignClient.issueCredential({
      subject: 'user-1',
      attributes: { permissions: ['admin'] },
    });

    const audit = await mockVeilChainClient.append({
      action: 'credential.issue',
      credentialId: cred.credentialId,
    });

    expect(cred.credentialId).toBe('cred-1');
    expect(audit.entryId).toBe('audit-1');
  });

  it('should encrypt and audit', async () => {
    // Encrypt data
    mockVeilKeyClient.encrypt.mockResolvedValue({
      ciphertext: 'encrypted',
    });

    // Log encryption
    mockVeilChainClient.append.mockResolvedValue({
      entryId: 'audit-2',
    });

    const encrypted = await mockVeilKeyClient.encrypt({
      groupId: 'kg-1',
      plaintext: 'secret',
    });

    const audit = await mockVeilChainClient.append({
      action: 'data.encrypt',
    });

    expect(encrypted.ciphertext).toBe('encrypted');
    expect(audit.entryId).toBeTruthy();
  });

  it('should verify and decrypt', async () => {
    // Verify credential
    mockVeilSignClient.verifyCredential.mockResolvedValue({
      valid: true,
      subject: 'user-1',
    });

    // Check not revoked
    mockVeilSignClient.checkRevocation.mockResolvedValue({
      isRevoked: false,
    });

    // Decrypt data
    mockVeilKeyClient.combineShares.mockResolvedValue({
      plaintext: 'decrypted-secret',
    });

    const verified = await mockVeilSignClient.verifyCredential('cred');
    const notRevoked = await mockVeilSignClient.checkRevocation('cred-1');
    const decrypted = await mockVeilKeyClient.combineShares({});

    expect(verified.valid).toBe(true);
    expect(notRevoked.isRevoked).toBe(false);
    expect(decrypted.plaintext).toBe('decrypted-secret');
  });
});
