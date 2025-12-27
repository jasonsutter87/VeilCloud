/**
 * Team Crypto Service Tests
 */

// Mock dependencies
jest.mock('../../src/integrations/veilkey.js', () => ({
  getVeilKeyClient: jest.fn(() => mockVeilKeyClient),
}));

jest.mock('../../src/db/repositories/team.js', () => ({
  TeamRepository: mockTeamRepository,
}));

jest.mock('../../src/services/audit.js', () => ({
  getAuditService: () => mockAuditService,
}));

const mockVeilKeyClient = {
  encrypt: jest.fn(),
  partialDecrypt: jest.fn(),
  combineShares: jest.fn(),
  getKeyGroup: jest.fn(),
  generateTeamKey: jest.fn(),
  reshareKeyGroup: jest.fn(),
};

const mockTeamRepository = {
  findById: jest.fn(),
  isMember: jest.fn(),
  getMember: jest.fn(),
  getMembers: jest.fn(),
  update: jest.fn(),
};

const mockAuditService = {
  log: jest.fn(),
};

import { TeamCryptoService } from '../../src/services/teamCrypto.js';

describe('TeamCryptoService', () => {
  let service: TeamCryptoService;

  beforeEach(() => {
    service = new TeamCryptoService();
    jest.clearAllMocks();
  });

  describe('encryptForTeam', () => {
    it('should encrypt data using team public key', async () => {
      mockTeamRepository.isMember.mockResolvedValue(true);
      mockTeamRepository.findById.mockResolvedValue({
        id: 'team-1',
        veilkeyGroupId: 'vk-group-1',
      });
      mockVeilKeyClient.encrypt.mockResolvedValue('encrypted-ciphertext');

      const result = await service.encryptForTeam({
        teamId: 'team-1' as any,
        plaintext: 'secret data',
        userId: 'user-1' as any,
        ipAddress: '192.168.1.1',
      });

      expect(result).toBe('encrypted-ciphertext');
      expect(mockVeilKeyClient.encrypt).toHaveBeenCalledWith({
        groupId: 'vk-group-1',
        plaintext: 'secret data',
      });
    });

    it('should reject non-members', async () => {
      mockTeamRepository.isMember.mockResolvedValue(false);

      await expect(
        service.encryptForTeam({
          teamId: 'team-1' as any,
          plaintext: 'secret',
          userId: 'user-1' as any,
        })
      ).rejects.toThrow('Not a member of this team');
    });

    it('should reject teams without threshold encryption', async () => {
      mockTeamRepository.isMember.mockResolvedValue(true);
      mockTeamRepository.findById.mockResolvedValue({
        id: 'team-1',
        veilkeyGroupId: null,
      });

      await expect(
        service.encryptForTeam({
          teamId: 'team-1' as any,
          plaintext: 'secret',
          userId: 'user-1' as any,
        })
      ).rejects.toThrow('threshold encryption');
    });

    it('should log encryption to audit service', async () => {
      mockTeamRepository.isMember.mockResolvedValue(true);
      mockTeamRepository.findById.mockResolvedValue({
        id: 'team-1',
        veilkeyGroupId: 'vk-group-1',
      });
      mockVeilKeyClient.encrypt.mockResolvedValue('ciphertext');

      await service.encryptForTeam({
        teamId: 'team-1' as any,
        plaintext: 'secret data',
        userId: 'user-1' as any,
        ipAddress: '10.0.0.1',
      });

      expect(mockAuditService.log).toHaveBeenCalledWith({
        action: 'team.encrypt',
        userId: 'user-1',
        teamId: 'team-1',
        context: { size: 11 },
        ipAddress: '10.0.0.1',
      });
    });
  });

  describe('generateDecryptionShare', () => {
    it('should generate partial decryption share', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        userId: 'user-1',
        shareIndex: 2,
        role: 'member',
      });
      mockTeamRepository.findById.mockResolvedValue({
        id: 'team-1',
        veilkeyGroupId: 'vk-group-1',
      });
      mockVeilKeyClient.partialDecrypt.mockResolvedValue({
        partialDecryption: 'partial-decrypt-data',
        proof: 'zkp-proof',
      });

      const result = await service.generateDecryptionShare({
        teamId: 'team-1' as any,
        userId: 'user-1' as any,
        ciphertext: 'encrypted-data',
        ipAddress: '192.168.1.1',
      });

      expect(result).toEqual({
        shareIndex: 2,
        partialDecryption: 'partial-decrypt-data',
        proof: 'zkp-proof',
      });
    });

    it('should reject non-members', async () => {
      mockTeamRepository.getMember.mockResolvedValue(null);

      await expect(
        service.generateDecryptionShare({
          teamId: 'team-1' as any,
          userId: 'user-1' as any,
          ciphertext: 'data',
        })
      ).rejects.toThrow('Not a member');
    });

    it('should log partial decryption', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        userId: 'user-1',
        shareIndex: 1,
      });
      mockTeamRepository.findById.mockResolvedValue({
        id: 'team-1',
        veilkeyGroupId: 'vk-group-1',
      });
      mockVeilKeyClient.partialDecrypt.mockResolvedValue({
        partialDecryption: 'partial',
        proof: 'proof',
      });

      await service.generateDecryptionShare({
        teamId: 'team-1' as any,
        userId: 'user-1' as any,
        ciphertext: 'data',
      });

      expect(mockAuditService.log).toHaveBeenCalledWith({
        action: 'team.partial_decrypt',
        userId: 'user-1',
        teamId: 'team-1',
        context: { shareIndex: 1 },
        ipAddress: undefined,
      });
    });
  });

  describe('combineShares', () => {
    it('should combine shares to decrypt', async () => {
      mockTeamRepository.findById.mockResolvedValue({
        id: 'team-1',
        veilkeyGroupId: 'vk-group-1',
        threshold: 2,
      });
      mockVeilKeyClient.combineShares.mockResolvedValue('decrypted-plaintext');

      const result = await service.combineShares({
        teamId: 'team-1' as any,
        ciphertext: 'encrypted-data',
        shares: [
          { shareIndex: 1, partialDecryption: 'pd1', proof: 'p1' },
          { shareIndex: 2, partialDecryption: 'pd2', proof: 'p2' },
        ],
      });

      expect(result).toBe('decrypted-plaintext');
    });

    it('should reject if not enough shares', async () => {
      mockTeamRepository.findById.mockResolvedValue({
        id: 'team-1',
        veilkeyGroupId: 'vk-group-1',
        threshold: 3,
      });

      await expect(
        service.combineShares({
          teamId: 'team-1' as any,
          ciphertext: 'data',
          shares: [
            { shareIndex: 1, partialDecryption: 'pd1', proof: 'p1' },
          ],
        })
      ).rejects.toThrow('Need at least 3 shares');
    });

    it('should reject team without VeilKey', async () => {
      mockTeamRepository.findById.mockResolvedValue({
        id: 'team-1',
        veilkeyGroupId: null,
      });

      await expect(
        service.combineShares({
          teamId: 'team-1' as any,
          ciphertext: 'data',
          shares: [],
        })
      ).rejects.toThrow('threshold encryption');
    });
  });

  describe('getTeamKeyInfo', () => {
    it('should return team key info', async () => {
      mockTeamRepository.isMember.mockResolvedValue(true);
      mockTeamRepository.findById.mockResolvedValue({
        id: 'team-1',
        veilkeyGroupId: 'vk-group-1',
        threshold: 2,
        totalShares: 3,
      });
      mockTeamRepository.getMembers.mockResolvedValue([
        { userId: 'u1' },
        { userId: 'u2' },
      ]);
      mockVeilKeyClient.getKeyGroup.mockResolvedValue({
        publicKey: 'public-key-123',
      });

      const result = await service.getTeamKeyInfo('team-1' as any, 'user-1' as any);

      expect(result).toEqual({
        teamId: 'team-1',
        publicKey: 'public-key-123',
        threshold: 2,
        totalShares: 3,
        activeShares: 2,
      });
    });

    it('should reject non-members', async () => {
      mockTeamRepository.isMember.mockResolvedValue(false);

      await expect(
        service.getTeamKeyInfo('team-1' as any, 'user-1' as any)
      ).rejects.toThrow('Not a member');
    });
  });

  describe('rotateTeamKey', () => {
    it('should rotate team key as owner', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        role: 'owner',
      });
      mockTeamRepository.findById.mockResolvedValue({
        id: 'team-1',
        veilkeyGroupId: 'old-group-id',
        threshold: 2,
        totalShares: 3,
      });
      mockTeamRepository.getMembers.mockResolvedValue([{ userId: 'u1' }]);
      mockVeilKeyClient.generateTeamKey.mockResolvedValue({
        keyGroup: {
          id: 'new-group-id',
          publicKey: 'new-public-key',
        },
      });
      mockTeamRepository.update.mockResolvedValue({});

      const result = await service.rotateTeamKey('team-1' as any, 'user-1' as any);

      expect(result.publicKey).toBe('new-public-key');
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'team.key_rotate',
          context: expect.objectContaining({
            oldGroupId: 'old-group-id',
            newGroupId: 'new-group-id',
          }),
        })
      );
    });

    it('should rotate team key as admin', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        role: 'admin',
      });
      mockTeamRepository.findById.mockResolvedValue({
        id: 'team-1',
        veilkeyGroupId: 'group-1',
        threshold: 2,
        totalShares: 3,
      });
      mockTeamRepository.getMembers.mockResolvedValue([]);
      mockVeilKeyClient.generateTeamKey.mockResolvedValue({
        keyGroup: { id: 'new', publicKey: 'pk' },
      });

      await expect(
        service.rotateTeamKey('team-1' as any, 'admin-1' as any)
      ).resolves.toBeDefined();
    });

    it('should reject rotation by members', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        role: 'member',
      });

      await expect(
        service.rotateTeamKey('team-1' as any, 'member-1' as any)
      ).rejects.toThrow('Only owner or admin');
    });
  });

  describe('reshareTeamKey', () => {
    it('should reshare key after member changes', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        role: 'owner',
      });
      mockTeamRepository.findById.mockResolvedValue({
        id: 'team-1',
        veilkeyGroupId: 'vk-group-1',
      });
      mockTeamRepository.getMembers.mockResolvedValue([
        { userId: 'u1' },
        { userId: 'u2' },
        { userId: 'u3' },
      ]);
      mockVeilKeyClient.reshareKeyGroup.mockResolvedValue({});

      await service.reshareTeamKey('team-1' as any, 'user-1' as any);

      expect(mockVeilKeyClient.reshareKeyGroup).toHaveBeenCalledWith({
        groupId: 'vk-group-1',
        newPartyCount: 3,
      });
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'team.key_reshare',
          context: { partyCount: 3 },
        })
      );
    });

    it('should reject reshare by non-admins', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        role: 'viewer',
      });

      await expect(
        service.reshareTeamKey('team-1' as any, 'viewer-1' as any)
      ).rejects.toThrow('Only owner or admin');
    });
  });

  describe('isVeilKeyAvailable', () => {
    it('should return true by default', () => {
      expect(service.isVeilKeyAvailable()).toBe(true);
    });
  });
});
