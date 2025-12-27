/**
 * Access Service Tests
 */

// Mock dependencies
jest.mock('../../src/integrations/veilsign.js', () => ({
  getVeilSignClient: () => mockVeilSignClient,
}));

jest.mock('../../src/db/connection.js', () => ({
  query: jest.fn(),
}));

jest.mock('../../src/services/audit.js', () => ({
  getAuditService: () => mockAuditService,
}));

const mockVeilSignClient = {
  issueCredential: jest.fn(),
  verifyCredential: jest.fn(),
  revokeCredential: jest.fn(),
};

const mockAuditService = {
  logCredentialIssue: jest.fn(),
  log: jest.fn(),
};

import { AccessService } from '../../src/services/access.js';
import { query } from '../../src/db/connection.js';

const mockQuery = query as jest.Mock;

describe('AccessService', () => {
  let service: AccessService;

  beforeEach(() => {
    service = new AccessService();
    jest.clearAllMocks();
  });

  describe('issueCredential', () => {
    it('should issue a credential via VeilSign', async () => {
      mockVeilSignClient.issueCredential.mockResolvedValue({
        credentialId: 'cred-123',
        credential: 'serialized-credential',
      });
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await service.issueCredential({
        userId: 'user-1' as any,
        projectId: 'project-1' as any,
        permissions: ['read', 'write'] as any,
        expiresIn: '24h',
        ipAddress: '192.168.1.1',
      });

      expect(result.credentialId).toBe('cred-123');
      expect(result.credential).toBe('serialized-credential');
      expect(result.permissions).toEqual(['read', 'write']);
    });

    it('should require at least one permission', async () => {
      await expect(
        service.issueCredential({
          userId: 'user-1' as any,
          permissions: [] as any,
        })
      ).rejects.toThrow('At least one permission required');
    });

    it('should store credential in database', async () => {
      mockVeilSignClient.issueCredential.mockResolvedValue({
        credentialId: 'cred-123',
        credential: 'data',
      });
      mockQuery.mockResolvedValue({ rows: [] });

      await service.issueCredential({
        userId: 'user-1' as any,
        projectId: 'project-1' as any,
        permissions: ['read'] as any,
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO credentials'),
        expect.arrayContaining([
          'cred-123',
          'user-1',
          'project-1',
          null, // teamId
          '["read"]',
          expect.any(Date),
        ])
      );
    });

    it('should log credential issuance', async () => {
      mockVeilSignClient.issueCredential.mockResolvedValue({
        credentialId: 'cred-123',
        credential: 'data',
      });
      mockQuery.mockResolvedValue({ rows: [] });

      await service.issueCredential({
        userId: 'user-1' as any,
        permissions: ['admin'] as any,
        ipAddress: '10.0.0.1',
      });

      expect(mockAuditService.logCredentialIssue).toHaveBeenCalledWith(
        'user-1',
        'access',
        ['admin'],
        '10.0.0.1'
      );
    });

    it('should calculate expiration correctly', async () => {
      mockVeilSignClient.issueCredential.mockResolvedValue({
        credentialId: 'cred-123',
        credential: 'data',
      });
      mockQuery.mockResolvedValue({ rows: [] });

      const before = Date.now();
      const result = await service.issueCredential({
        userId: 'user-1' as any,
        permissions: ['read'] as any,
        expiresIn: '7d',
      });
      const after = Date.now();

      const expectedMin = before + 7 * 24 * 60 * 60 * 1000;
      const expectedMax = after + 7 * 24 * 60 * 60 * 1000;

      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedMax);
    });
  });

  describe('verifyCredential', () => {
    it('should verify valid credential', async () => {
      mockVeilSignClient.verifyCredential.mockResolvedValue({
        valid: true,
        credentialId: 'cred-123',
        subject: 'user-1',
        attributes: {
          permissions: ['read', 'write'],
        },
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      mockQuery.mockResolvedValue({ rows: [{ count: '0' }] }); // Not revoked

      const result = await service.verifyCredential({
        credential: 'valid-credential',
      });

      expect(result.valid).toBe(true);
      expect(result.userId).toBe('user-1');
      expect(result.permissions).toEqual(['read', 'write']);
    });

    it('should reject invalid signature', async () => {
      mockVeilSignClient.verifyCredential.mockResolvedValue({
        valid: false,
      });

      const result = await service.verifyCredential({
        credential: 'invalid-credential',
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid credential signature');
    });

    it('should reject revoked credentials', async () => {
      mockVeilSignClient.verifyCredential.mockResolvedValue({
        valid: true,
        credentialId: 'cred-123',
        subject: 'user-1',
        attributes: { permissions: [] },
      });
      mockQuery.mockResolvedValue({ rows: [{ count: '1' }] }); // Revoked

      const result = await service.verifyCredential({
        credential: 'revoked-credential',
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Credential has been revoked');
    });

    it('should reject expired credentials', async () => {
      mockVeilSignClient.verifyCredential.mockResolvedValue({
        valid: true,
        credentialId: 'cred-123',
        subject: 'user-1',
        attributes: { permissions: [] },
        expiresAt: new Date(Date.now() - 1000).toISOString(), // Expired
      });
      mockQuery.mockResolvedValue({ rows: [{ count: '0' }] });

      const result = await service.verifyCredential({
        credential: 'expired-credential',
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Credential has expired');
    });

    it('should check project scope', async () => {
      mockVeilSignClient.verifyCredential.mockResolvedValue({
        valid: true,
        credentialId: 'cred-123',
        subject: 'user-1',
        attributes: {
          projectId: 'project-1',
          permissions: ['read'],
        },
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      mockQuery.mockResolvedValue({ rows: [{ count: '0' }] });

      const result = await service.verifyCredential({
        credential: 'credential',
        projectId: 'project-2' as any, // Different project
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Credential not valid for this project');
    });

    it('should check required permissions', async () => {
      mockVeilSignClient.verifyCredential.mockResolvedValue({
        valid: true,
        credentialId: 'cred-123',
        subject: 'user-1',
        attributes: {
          permissions: ['read'],
        },
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      mockQuery.mockResolvedValue({ rows: [{ count: '0' }] });

      const result = await service.verifyCredential({
        credential: 'credential',
        requiredPermissions: ['write'] as any,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Insufficient permissions');
    });
  });

  describe('revokeCredential', () => {
    it('should revoke credential', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] }) // Find credential
        .mockResolvedValueOnce({ rows: [] }) // Insert revocation
        .mockResolvedValueOnce({ rows: [] }); // VeilSign revoke handled by mock

      mockVeilSignClient.revokeCredential.mockResolvedValue({});

      await service.revokeCredential({
        credentialId: 'cred-123',
        userId: 'user-1' as any,
        reason: 'User requested',
        ipAddress: '192.168.1.1',
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO credential_revocations'),
        expect.arrayContaining(['cred-123', 'user-1', 'User requested'])
      );
    });

    it('should reject if credential not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.revokeCredential({
          credentialId: 'nonexistent',
          userId: 'user-1' as any,
        })
      ).rejects.toThrow('not found');
    });

    it('should log revocation', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] })
        .mockResolvedValue({ rows: [] });
      mockVeilSignClient.revokeCredential.mockResolvedValue({});

      await service.revokeCredential({
        credentialId: 'cred-123',
        userId: 'user-1' as any,
        reason: 'Compromised',
        ipAddress: '10.0.0.1',
      });

      expect(mockAuditService.log).toHaveBeenCalledWith({
        action: 'credential.revoke',
        userId: 'user-1',
        context: { credentialId: 'cred-123', reason: 'Compromised' },
        ipAddress: '10.0.0.1',
      });
    });
  });

  describe('listCredentials', () => {
    it('should list user credentials', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'cred-1',
            project_id: 'proj-1',
            team_id: null,
            permissions: '["read"]',
            expires_at: new Date(),
            revoked: false,
          },
          {
            id: 'cred-2',
            project_id: null,
            team_id: 'team-1',
            permissions: '["admin"]',
            expires_at: new Date(),
            revoked: false,
          },
        ],
      });

      const result = await service.listCredentials('user-1' as any);

      expect(result).toHaveLength(2);
      expect(result[0]!.permissions).toEqual(['read']);
      expect(result[1]!.permissions).toEqual(['admin']);
    });

    it('should filter by project', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await service.listCredentials('user-1' as any, {
        projectId: 'project-1' as any,
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('project_id = $2'),
        expect.arrayContaining(['user-1', 'project-1'])
      );
    });

    it('should include expired when requested', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await service.listCredentials('user-1' as any, {
        includeExpired: true,
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.not.stringContaining('expires_at > NOW()'),
        expect.any(Array)
      );
    });
  });

  describe('issueOneTimeCredential', () => {
    it('should issue one-time credential', async () => {
      mockVeilSignClient.issueCredential.mockResolvedValue({
        credentialId: 'cred-123',
        credential: 'data',
      });
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await service.issueOneTimeCredential({
        userId: 'user-1' as any,
        permissions: ['read'] as any,
      });

      expect(result.credentialId).toBe('cred-123');

      // Should update to mark as one-time
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE credentials SET one_time = true'),
        ['cred-123']
      );
    });

    it('should default to 1 hour expiration', async () => {
      mockVeilSignClient.issueCredential.mockResolvedValue({
        credentialId: 'cred-123',
        credential: 'data',
      });
      mockQuery.mockResolvedValue({ rows: [] });

      const before = Date.now();
      const result = await service.issueOneTimeCredential({
        userId: 'user-1' as any,
        permissions: ['read'] as any,
      });
      const after = Date.now();

      const minExpiry = before + 60 * 60 * 1000;
      const maxExpiry = after + 60 * 60 * 1000;

      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(minExpiry);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(maxExpiry);
    });
  });

  describe('verifyAndConsumeOneTime', () => {
    it('should verify and consume one-time credential', async () => {
      mockVeilSignClient.verifyCredential.mockResolvedValue({
        valid: true,
        credentialId: 'cred-123',
        subject: 'user-1',
        attributes: { permissions: ['read'] },
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // Not revoked
        .mockResolvedValueOnce({ rows: [{ one_time: true }] }) // Is one-time
        .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] }) // Revoke - find
        .mockResolvedValue({ rows: [] }); // Revoke - insert

      mockVeilSignClient.revokeCredential.mockResolvedValue({});

      const result = await service.verifyAndConsumeOneTime('one-time-cred');

      expect(result.valid).toBe(true);
      // Should have been revoked after use
      expect(mockVeilSignClient.revokeCredential).toHaveBeenCalledWith('cred-123');
    });

    it('should not consume non-one-time credentials', async () => {
      mockVeilSignClient.verifyCredential.mockResolvedValue({
        valid: true,
        credentialId: 'cred-123',
        subject: 'user-1',
        attributes: { permissions: ['read'] },
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ one_time: false }] });

      const result = await service.verifyAndConsumeOneTime('regular-cred');

      expect(result.valid).toBe(true);
      expect(mockVeilSignClient.revokeCredential).not.toHaveBeenCalled();
    });
  });

  describe('duration parsing', () => {
    it('should parse hours', async () => {
      mockVeilSignClient.issueCredential.mockResolvedValue({
        credentialId: 'cred',
        credential: 'data',
      });
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await service.issueCredential({
        userId: 'user-1' as any,
        permissions: ['read'] as any,
        expiresIn: '12h',
      });

      const expectedMs = 12 * 60 * 60 * 1000;
      const actualMs = result.expiresAt.getTime() - Date.now();
      expect(actualMs).toBeGreaterThan(expectedMs - 1000);
      expect(actualMs).toBeLessThan(expectedMs + 1000);
    });

    it('should parse days', async () => {
      mockVeilSignClient.issueCredential.mockResolvedValue({
        credentialId: 'cred',
        credential: 'data',
      });
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await service.issueCredential({
        userId: 'user-1' as any,
        permissions: ['read'] as any,
        expiresIn: '30d',
      });

      const expectedMs = 30 * 24 * 60 * 60 * 1000;
      const actualMs = result.expiresAt.getTime() - Date.now();
      expect(actualMs).toBeGreaterThan(expectedMs - 1000);
      expect(actualMs).toBeLessThan(expectedMs + 1000);
    });

    it('should reject invalid duration format', async () => {
      await expect(
        service.issueCredential({
          userId: 'user-1' as any,
          permissions: ['read'] as any,
          expiresIn: 'invalid',
        })
      ).rejects.toThrow('Invalid duration format');
    });
  });
});
