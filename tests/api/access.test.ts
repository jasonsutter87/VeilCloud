/**
 * Access API Route Tests
 */

// Mock dependencies
jest.mock('../../src/services/access.js', () => ({
  getAccessService: () => mockAccessService,
}));

jest.mock('../../src/services/audit.js', () => ({
  getAuditService: () => mockAuditService,
}));

const mockAccessService = {
  issueCredential: jest.fn(),
  verifyCredential: jest.fn(),
  revokeCredential: jest.fn(),
  listCredentials: jest.fn(),
  issueOneTimeCredential: jest.fn(),
  verifyAndConsumeOneTime: jest.fn(),
};

const mockAuditService = {
  log: jest.fn(),
};

describe('Access API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /access/issue', () => {
    it('should issue credential', async () => {
      mockAccessService.issueCredential.mockResolvedValue({
        credentialId: 'cred-1',
        credential: 'serialized-credential',
        permissions: ['read', 'write'],
        expiresAt: new Date(Date.now() + 86400000),
      });

      const result = await mockAccessService.issueCredential({
        userId: 'user-1',
        projectId: 'proj-1',
        permissions: ['read', 'write'],
        expiresIn: '24h',
      });

      expect(result.credentialId).toBe('cred-1');
      expect(result.credential).toBeTruthy();
    });

    it('should require at least one permission', async () => {
      mockAccessService.issueCredential.mockRejectedValue(
        new Error('At least one permission required')
      );

      await expect(
        mockAccessService.issueCredential({
          userId: 'user-1',
          permissions: [],
        })
      ).rejects.toThrow('At least one permission required');
    });

    it('should set expiration time', async () => {
      mockAccessService.issueCredential.mockResolvedValue({
        credentialId: 'cred-1',
        expiresAt: new Date(Date.now() + 3600000),
      });

      const result = await mockAccessService.issueCredential({
        userId: 'user-1',
        permissions: ['read'],
        expiresIn: '1h',
      });

      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should log credential issuance', async () => {
      mockAccessService.issueCredential.mockResolvedValue({
        credentialId: 'cred-1',
      });

      await mockAccessService.issueCredential({
        userId: 'user-1',
        permissions: ['read'],
      });
      await mockAuditService.log({
        action: 'credential.issue',
        userId: 'user-1',
      });

      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should include project scope', async () => {
      mockAccessService.issueCredential.mockResolvedValue({
        credentialId: 'cred-1',
        projectId: 'proj-1',
      });

      const result = await mockAccessService.issueCredential({
        userId: 'user-1',
        projectId: 'proj-1',
        permissions: ['read'],
      });

      expect(result.projectId).toBe('proj-1');
    });

    it('should include team scope', async () => {
      mockAccessService.issueCredential.mockResolvedValue({
        credentialId: 'cred-1',
        teamId: 'team-1',
      });

      const result = await mockAccessService.issueCredential({
        userId: 'user-1',
        teamId: 'team-1',
        permissions: ['read'],
      });

      expect(result.teamId).toBe('team-1');
    });
  });

  describe('POST /access/verify', () => {
    it('should verify valid credential', async () => {
      mockAccessService.verifyCredential.mockResolvedValue({
        valid: true,
        userId: 'user-1',
        permissions: ['read', 'write'],
      });

      const result = await mockAccessService.verifyCredential({
        credential: 'valid-credential',
      });

      expect(result.valid).toBe(true);
      expect(result.userId).toBe('user-1');
    });

    it('should reject invalid signature', async () => {
      mockAccessService.verifyCredential.mockResolvedValue({
        valid: false,
        reason: 'Invalid credential signature',
      });

      const result = await mockAccessService.verifyCredential({
        credential: 'invalid-credential',
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid credential signature');
    });

    it('should reject expired credential', async () => {
      mockAccessService.verifyCredential.mockResolvedValue({
        valid: false,
        reason: 'Credential has expired',
      });

      const result = await mockAccessService.verifyCredential({
        credential: 'expired-credential',
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('expired');
    });

    it('should reject revoked credential', async () => {
      mockAccessService.verifyCredential.mockResolvedValue({
        valid: false,
        reason: 'Credential has been revoked',
      });

      const result = await mockAccessService.verifyCredential({
        credential: 'revoked-credential',
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('revoked');
    });

    it('should check project scope', async () => {
      mockAccessService.verifyCredential.mockResolvedValue({
        valid: false,
        reason: 'Credential not valid for this project',
      });

      const result = await mockAccessService.verifyCredential({
        credential: 'credential',
        projectId: 'wrong-project',
      });

      expect(result.valid).toBe(false);
    });

    it('should check required permissions', async () => {
      mockAccessService.verifyCredential.mockResolvedValue({
        valid: false,
        reason: 'Insufficient permissions',
      });

      const result = await mockAccessService.verifyCredential({
        credential: 'read-only-cred',
        requiredPermissions: ['write'],
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('permissions');
    });

    it('should return permissions on success', async () => {
      mockAccessService.verifyCredential.mockResolvedValue({
        valid: true,
        permissions: ['read', 'write', 'admin'],
      });

      const result = await mockAccessService.verifyCredential({
        credential: 'admin-cred',
      });

      expect(result.permissions).toContain('admin');
    });
  });

  describe('POST /access/revoke', () => {
    it('should revoke credential', async () => {
      mockAccessService.revokeCredential.mockResolvedValue({
        revoked: true,
        revokedAt: new Date(),
      });

      const result = await mockAccessService.revokeCredential({
        credentialId: 'cred-1',
        userId: 'user-1',
        reason: 'User requested',
      });

      expect(result.revoked).toBe(true);
    });

    it('should require credential ID', async () => {
      mockAccessService.revokeCredential.mockRejectedValue(
        new Error('Credential ID required')
      );

      await expect(
        mockAccessService.revokeCredential({
          userId: 'user-1',
        })
      ).rejects.toThrow();
    });

    it('should reject if credential not found', async () => {
      mockAccessService.revokeCredential.mockRejectedValue(
        new Error('Credential not found')
      );

      await expect(
        mockAccessService.revokeCredential({
          credentialId: 'nonexistent',
          userId: 'user-1',
        })
      ).rejects.toThrow('not found');
    });

    it('should log revocation', async () => {
      mockAccessService.revokeCredential.mockResolvedValue({
        revoked: true,
      });

      await mockAccessService.revokeCredential({
        credentialId: 'cred-1',
        userId: 'user-1',
      });
      await mockAuditService.log({
        action: 'credential.revoke',
        userId: 'user-1',
      });

      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should include revocation reason', async () => {
      mockAccessService.revokeCredential.mockResolvedValue({
        revoked: true,
        reason: 'Compromised',
      });

      const result = await mockAccessService.revokeCredential({
        credentialId: 'cred-1',
        userId: 'user-1',
        reason: 'Compromised',
      });

      expect(result.reason).toBe('Compromised');
    });
  });

  describe('GET /access/credentials', () => {
    it('should list user credentials', async () => {
      mockAccessService.listCredentials.mockResolvedValue([
        { id: 'cred-1', permissions: ['read'], revoked: false },
        { id: 'cred-2', permissions: ['write'], revoked: false },
      ]);

      const result = await mockAccessService.listCredentials('user-1');

      expect(result).toHaveLength(2);
    });

    it('should filter by project', async () => {
      mockAccessService.listCredentials.mockResolvedValue([
        { id: 'cred-1', projectId: 'proj-1' },
      ]);

      const result = await mockAccessService.listCredentials('user-1', {
        projectId: 'proj-1',
      });

      expect(result[0].projectId).toBe('proj-1');
    });

    it('should include expired when requested', async () => {
      mockAccessService.listCredentials.mockResolvedValue([
        { id: 'cred-1', expiresAt: new Date(Date.now() - 1000) },
      ]);

      const result = await mockAccessService.listCredentials('user-1', {
        includeExpired: true,
      });

      expect(result).toHaveLength(1);
    });

    it('should return empty array for new user', async () => {
      mockAccessService.listCredentials.mockResolvedValue([]);

      const result = await mockAccessService.listCredentials('new-user');

      expect(result).toEqual([]);
    });
  });

  describe('POST /access/one-time', () => {
    it('should issue one-time credential', async () => {
      mockAccessService.issueOneTimeCredential.mockResolvedValue({
        credentialId: 'ot-cred-1',
        credential: 'one-time-credential',
        expiresAt: new Date(Date.now() + 3600000),
      });

      const result = await mockAccessService.issueOneTimeCredential({
        userId: 'user-1',
        permissions: ['read'],
      });

      expect(result.credentialId).toBe('ot-cred-1');
    });

    it('should default to 1 hour expiration', async () => {
      const now = Date.now();
      mockAccessService.issueOneTimeCredential.mockResolvedValue({
        credentialId: 'ot-cred-1',
        expiresAt: new Date(now + 3600000),
      });

      const result = await mockAccessService.issueOneTimeCredential({
        userId: 'user-1',
        permissions: ['read'],
      });

      expect(result.expiresAt.getTime()).toBeGreaterThan(now);
      expect(result.expiresAt.getTime()).toBeLessThan(now + 7200000);
    });
  });

  describe('POST /access/consume', () => {
    it('should verify and consume one-time credential', async () => {
      mockAccessService.verifyAndConsumeOneTime.mockResolvedValue({
        valid: true,
        userId: 'user-1',
        permissions: ['read'],
        consumed: true,
      });

      const result = await mockAccessService.verifyAndConsumeOneTime('one-time-cred');

      expect(result.valid).toBe(true);
      expect(result.consumed).toBe(true);
    });

    it('should not consume regular credentials', async () => {
      mockAccessService.verifyAndConsumeOneTime.mockResolvedValue({
        valid: true,
        consumed: false,
      });

      const result = await mockAccessService.verifyAndConsumeOneTime('regular-cred');

      expect(result.consumed).toBe(false);
    });

    it('should reject already consumed credential', async () => {
      mockAccessService.verifyAndConsumeOneTime.mockResolvedValue({
        valid: false,
        reason: 'Credential already used',
      });

      const result = await mockAccessService.verifyAndConsumeOneTime('used-cred');

      expect(result.valid).toBe(false);
    });
  });

  describe('Permission Types', () => {
    it('should support read permission', async () => {
      mockAccessService.issueCredential.mockResolvedValue({
        permissions: ['read'],
      });

      const result = await mockAccessService.issueCredential({
        userId: 'user-1',
        permissions: ['read'],
      });

      expect(result.permissions).toContain('read');
    });

    it('should support write permission', async () => {
      mockAccessService.issueCredential.mockResolvedValue({
        permissions: ['write'],
      });

      const result = await mockAccessService.issueCredential({
        userId: 'user-1',
        permissions: ['write'],
      });

      expect(result.permissions).toContain('write');
    });

    it('should support admin permission', async () => {
      mockAccessService.issueCredential.mockResolvedValue({
        permissions: ['admin'],
      });

      const result = await mockAccessService.issueCredential({
        userId: 'user-1',
        permissions: ['admin'],
      });

      expect(result.permissions).toContain('admin');
    });

    it('should support multiple permissions', async () => {
      mockAccessService.issueCredential.mockResolvedValue({
        permissions: ['read', 'write', 'delete'],
      });

      const result = await mockAccessService.issueCredential({
        userId: 'user-1',
        permissions: ['read', 'write', 'delete'],
      });

      expect(result.permissions).toHaveLength(3);
    });
  });

  describe('Duration Parsing', () => {
    it('should parse hours', async () => {
      mockAccessService.issueCredential.mockResolvedValue({
        expiresAt: new Date(Date.now() + 12 * 3600000),
      });

      const result = await mockAccessService.issueCredential({
        userId: 'user-1',
        permissions: ['read'],
        expiresIn: '12h',
      });

      const expectedMs = 12 * 60 * 60 * 1000;
      const actualMs = result.expiresAt.getTime() - Date.now();
      expect(actualMs).toBeLessThan(expectedMs + 1000);
    });

    it('should parse days', async () => {
      mockAccessService.issueCredential.mockResolvedValue({
        expiresAt: new Date(Date.now() + 7 * 86400000),
      });

      const result = await mockAccessService.issueCredential({
        userId: 'user-1',
        permissions: ['read'],
        expiresIn: '7d',
      });

      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86400000);
    });

    it('should reject invalid duration', async () => {
      mockAccessService.issueCredential.mockRejectedValue(
        new Error('Invalid duration format')
      );

      await expect(
        mockAccessService.issueCredential({
          userId: 'user-1',
          permissions: ['read'],
          expiresIn: 'invalid',
        })
      ).rejects.toThrow('Invalid duration');
    });
  });

  describe('Error Handling', () => {
    it('should handle VeilSign unavailable', async () => {
      mockAccessService.issueCredential.mockRejectedValue(
        new Error('VeilSign service unavailable')
      );

      await expect(
        mockAccessService.issueCredential({
          userId: 'user-1',
          permissions: ['read'],
        })
      ).rejects.toThrow('VeilSign');
    });

    it('should handle database errors', async () => {
      mockAccessService.listCredentials.mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(
        mockAccessService.listCredentials('user-1')
      ).rejects.toThrow('Database');
    });
  });
});
