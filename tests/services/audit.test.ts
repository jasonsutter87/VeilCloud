/**
 * Audit Service Tests
 */

import { AuditService } from '../../src/services/audit.js';

// Mock the dependencies
jest.mock('../../src/integrations/veilchain.js', () => ({
  getVeilChainClient: jest.fn(() => ({
    log: jest.fn().mockResolvedValue({
      entryId: 'mock-entry-id',
      position: BigInt(1),
      hash: 'mock-hash',
      proof: { root: 'mock-root', proof: [] },
    }),
    getAuditTrail: jest.fn(),
  })),
}));

jest.mock('../../src/db/connection.js', () => ({
  query: jest.fn().mockResolvedValue({
    rows: [{ id: 'mock-db-id' }],
  }),
}));

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(() => {
    service = new AuditService();
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('should log to VeilChain and database', async () => {
      const result = await service.log({
        action: 'blob.read',
        userId: 'user-1' as any,
        projectId: 'project-1' as any,
        context: { envName: 'production' },
        ipAddress: '192.168.1.1',
      });

      expect(result).toEqual({
        entryId: 'mock-entry-id',
        position: BigInt(1),
        hash: 'mock-hash',
        proof: { root: 'mock-root', proof: [] },
      });
    });

    it('should fallback to local-only when VeilChain unavailable', async () => {
      const { getVeilChainClient } = require('../../src/integrations/veilchain.js');
      getVeilChainClient.mockReturnValueOnce({
        log: jest.fn().mockRejectedValue(new Error('VeilChain unavailable')),
      });

      const result = await service.log({
        action: 'blob.write',
        userId: 'user-1' as any,
      });

      expect(result.entryId).toBe('mock-db-id');
      expect(result.position).toBe(BigInt(0));
      expect(result.hash).toBe('');
    });

    it('should include all required fields in log entry', async () => {
      const { query } = require('../../src/db/connection.js');

      await service.log({
        action: 'project.create',
        userId: 'user-1' as any,
        projectId: 'project-1' as any,
        teamId: 'team-1' as any,
        context: { test: true },
        ipAddress: '10.0.0.1',
        userAgent: 'test-agent',
      });

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_log'),
        expect.arrayContaining([
          'mock-entry-id',
          'project.create',
          'user-1',
          'project-1',
          'team-1',
          '10.0.0.1',
          'test-agent',
          '{"test":true}',
          expect.any(Date),
        ])
      );
    });
  });

  describe('logBlobRead', () => {
    it('should log blob read action', async () => {
      const logSpy = jest.spyOn(service, 'log');

      await service.logBlobRead(
        'user-1' as any,
        'project-1' as any,
        'production',
        '192.168.1.1'
      );

      expect(logSpy).toHaveBeenCalledWith({
        action: 'blob.read',
        userId: 'user-1',
        projectId: 'project-1',
        context: { envName: 'production' },
        ipAddress: '192.168.1.1',
      });
    });
  });

  describe('logBlobWrite', () => {
    it('should log blob write action with size', async () => {
      const logSpy = jest.spyOn(service, 'log');

      await service.logBlobWrite(
        'user-1' as any,
        'project-1' as any,
        'staging',
        1024,
        '10.0.0.1'
      );

      expect(logSpy).toHaveBeenCalledWith({
        action: 'blob.write',
        userId: 'user-1',
        projectId: 'project-1',
        context: { envName: 'staging', size: 1024 },
        ipAddress: '10.0.0.1',
      });
    });
  });

  describe('logBlobDelete', () => {
    it('should log blob delete action', async () => {
      const logSpy = jest.spyOn(service, 'log');

      await service.logBlobDelete(
        'user-1' as any,
        'project-1' as any,
        'development'
      );

      expect(logSpy).toHaveBeenCalledWith({
        action: 'blob.delete',
        userId: 'user-1',
        projectId: 'project-1',
        context: { envName: 'development' },
        ipAddress: undefined,
      });
    });
  });

  describe('logProjectCreate', () => {
    it('should log project creation', async () => {
      const logSpy = jest.spyOn(service, 'log');

      await service.logProjectCreate(
        'user-1' as any,
        'project-1' as any,
        'My Project',
        '172.16.0.1'
      );

      expect(logSpy).toHaveBeenCalledWith({
        action: 'project.create',
        userId: 'user-1',
        projectId: 'project-1',
        context: { projectName: 'My Project' },
        ipAddress: '172.16.0.1',
      });
    });
  });

  describe('logProjectShare', () => {
    it('should log project sharing', async () => {
      const logSpy = jest.spyOn(service, 'log');

      await service.logProjectShare(
        'user-1' as any,
        'project-1' as any,
        'team-1' as any,
        ['read', 'write'],
        '192.168.1.1'
      );

      expect(logSpy).toHaveBeenCalledWith({
        action: 'project.share',
        userId: 'user-1',
        projectId: 'project-1',
        teamId: 'team-1',
        context: { permissions: ['read', 'write'] },
        ipAddress: '192.168.1.1',
      });
    });
  });

  describe('logTeamCreate', () => {
    it('should log team creation', async () => {
      const logSpy = jest.spyOn(service, 'log');

      await service.logTeamCreate(
        'user-1' as any,
        'team-1' as any,
        'Engineering',
        2,
        '10.0.0.1'
      );

      expect(logSpy).toHaveBeenCalledWith({
        action: 'team.create',
        userId: 'user-1',
        teamId: 'team-1',
        context: { teamName: 'Engineering', threshold: 2 },
        ipAddress: '10.0.0.1',
      });
    });
  });

  describe('logTeamJoin', () => {
    it('should log team member join', async () => {
      const logSpy = jest.spyOn(service, 'log');

      await service.logTeamJoin(
        'admin-1' as any,
        'team-1' as any,
        'new-user-1' as any,
        3,
        '192.168.1.1'
      );

      expect(logSpy).toHaveBeenCalledWith({
        action: 'team.join',
        userId: 'admin-1',
        teamId: 'team-1',
        context: { newMemberId: 'new-user-1', shareIndex: 3 },
        ipAddress: '192.168.1.1',
      });
    });
  });

  describe('logCredentialIssue', () => {
    it('should log credential issuance', async () => {
      const logSpy = jest.spyOn(service, 'log');

      await service.logCredentialIssue(
        'user-1' as any,
        'api-key',
        ['read', 'write'],
        '10.0.0.1'
      );

      expect(logSpy).toHaveBeenCalledWith({
        action: 'credential.issue',
        userId: 'user-1',
        context: { credentialType: 'api-key', permissions: ['read', 'write'] },
        ipAddress: '10.0.0.1',
      });
    });
  });

  describe('getLocalTrail', () => {
    it('should query local audit trail', async () => {
      const { query } = require('../../src/db/connection.js');
      query.mockResolvedValueOnce({
        rows: [
          {
            id: 'entry-1',
            veilchain_entry_id: 'vc-1',
            action: 'blob.read',
            user_id: 'user-1',
            project_id: 'project-1',
            team_id: null,
            ip_address: '192.168.1.1',
            context: { envName: 'prod' },
            created_at: new Date('2024-01-01'),
          },
        ],
      });

      const result = await service.getLocalTrail('project-1' as any, 10, 0);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        entryId: 'vc-1',
        position: BigInt(0),
        action: 'blob.read',
        userId: 'user-1',
        projectId: 'project-1',
        teamId: undefined,
        context: { envName: 'prod' },
        ipAddress: '192.168.1.1',
        timestamp: new Date('2024-01-01'),
      });
    });

    it('should use default limit and offset', async () => {
      const { query } = require('../../src/db/connection.js');
      query.mockResolvedValueOnce({ rows: [] });

      await service.getLocalTrail();

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2 OFFSET $3'),
        [null, 50, 0]
      );
    });

    it('should filter by projectId', async () => {
      const { query } = require('../../src/db/connection.js');
      query.mockResolvedValueOnce({ rows: [] });

      await service.getLocalTrail('project-1' as any);

      expect(query).toHaveBeenCalledWith(
        expect.any(String),
        ['project-1', 50, 0]
      );
    });
  });
});
