/**
 * Teams API Tests
 */

import Fastify, { FastifyInstance } from 'fastify';

// Mock dependencies
const mockTeamRepository = {
  create: jest.fn(),
  findById: jest.fn(),
  findByMember: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  isMember: jest.fn(),
  getMember: jest.fn(),
  getMembers: jest.fn(),
  addMember: jest.fn(),
  removeMember: jest.fn(),
  updateMemberRole: jest.fn(),
  getNextShareIndex: jest.fn(),
};

const mockUserRepository = {
  findById: jest.fn(),
  findByEmail: jest.fn(),
};

const mockVeilKeyClient = {
  generateTeamKey: jest.fn(),
  getKeyGroup: jest.fn(),
};

const mockAuditService = {
  logTeamCreate: jest.fn(),
  logTeamJoin: jest.fn(),
};

jest.mock('../../src/db/repositories/team.js', () => ({
  TeamRepository: mockTeamRepository,
}));

jest.mock('../../src/db/repositories/user.js', () => ({
  UserRepository: mockUserRepository,
}));

jest.mock('../../src/integrations/veilkey.js', () => ({
  getVeilKeyClient: () => mockVeilKeyClient,
}));

jest.mock('../../src/services/audit.js', () => ({
  getAuditService: () => mockAuditService,
}));

jest.mock('../../src/api/middleware/auth.js', () => ({
  authenticate: async (request: any) => {
    request.user = { id: 'user-1', email: 'test@example.com', permissions: [] };
  },
}));

describe('Teams API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { teamRoutes } = await import('../../src/api/routes/teams.js');
    app = Fastify();
    await app.register(teamRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST / - Create Team', () => {
    it('should create team with VeilKey threshold key', async () => {
      mockTeamRepository.create.mockResolvedValue({
        id: 'team-1',
        name: 'Engineering',
        threshold: 2,
        totalShares: 3,
      });

      mockVeilKeyClient.generateTeamKey.mockResolvedValue({
        keyGroup: {
          id: 'vk-group-1',
          publicKey: 'pub-key-123',
          threshold: 2,
          parties: 3,
        },
      });

      mockTeamRepository.update.mockResolvedValue({});

      const response = await app.inject({
        method: 'POST',
        url: '/',
        payload: {
          name: 'Engineering',
          description: 'Engineering team',
          threshold: 2,
          totalShares: 3,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.team.name).toBe('Engineering');
      expect(body.veilkey).toBeDefined();
      expect(body.veilkey.publicKey).toBe('pub-key-123');
    });

    it('should reject if threshold > totalShares', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/',
        payload: {
          name: 'Test',
          threshold: 5,
          totalShares: 3,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should work without VeilKey', async () => {
      mockTeamRepository.create.mockResolvedValue({
        id: 'team-1',
        name: 'Basic Team',
      });

      mockVeilKeyClient.generateTeamKey.mockRejectedValue(new Error('VeilKey unavailable'));

      const response = await app.inject({
        method: 'POST',
        url: '/',
        payload: {
          name: 'Basic Team',
          threshold: 2,
          totalShares: 3,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.veilkey).toBeNull();
    });

    it('should log team creation', async () => {
      mockTeamRepository.create.mockResolvedValue({
        id: 'team-1',
        name: 'Test',
        threshold: 2,
      });
      mockVeilKeyClient.generateTeamKey.mockRejectedValue(new Error());

      await app.inject({
        method: 'POST',
        url: '/',
        payload: { name: 'Test', threshold: 2, totalShares: 3 },
      });

      expect(mockAuditService.logTeamCreate).toHaveBeenCalled();
    });
  });

  describe('GET / - List Teams', () => {
    it('should list user teams', async () => {
      mockTeamRepository.findByMember.mockResolvedValue([
        { id: 'team-1', name: 'Team A' },
        { id: 'team-2', name: 'Team B' },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.teams).toHaveLength(2);
    });
  });

  describe('GET /:id - Get Team', () => {
    it('should return team details', async () => {
      mockTeamRepository.findById.mockResolvedValue({
        id: 'team-1',
        name: 'Engineering',
        threshold: 2,
      });
      mockTeamRepository.isMember.mockResolvedValue(true);
      mockTeamRepository.getMembers.mockResolvedValue([
        { userId: 'user-1', role: 'owner', shareIndex: 1 },
      ]);
      mockUserRepository.findById.mockResolvedValue({
        email: 'user@example.com',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/team-1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.team.name).toBe('Engineering');
      expect(body.members).toHaveLength(1);
    });

    it('should return 404 for non-existent team', async () => {
      mockTeamRepository.findById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 403 for non-members', async () => {
      mockTeamRepository.findById.mockResolvedValue({ id: 'team-1' });
      mockTeamRepository.isMember.mockResolvedValue(false);

      const response = await app.inject({
        method: 'GET',
        url: '/team-1',
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('PATCH /:id - Update Team', () => {
    it('should update team as owner', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        role: 'owner',
      });
      mockTeamRepository.update.mockResolvedValue({
        id: 'team-1',
        name: 'Updated Name',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/team-1',
        payload: { name: 'Updated Name' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should update team as admin', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        role: 'admin',
      });
      mockTeamRepository.update.mockResolvedValue({});

      const response = await app.inject({
        method: 'PATCH',
        url: '/team-1',
        payload: { description: 'New description' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should reject update as member', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        role: 'member',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/team-1',
        payload: { name: 'Attempt' },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('DELETE /:id - Delete Team', () => {
    it('should delete team as owner', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        role: 'owner',
      });
      mockTeamRepository.delete.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: '/team-1',
      });

      expect(response.statusCode).toBe(204);
    });

    it('should reject delete as admin', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        role: 'admin',
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/team-1',
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /:id/members - Add Member', () => {
    it('should add member by email', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        role: 'owner',
      });
      mockUserRepository.findByEmail.mockResolvedValue({
        id: 'new-user-id',
        email: 'newmember@example.com',
      });
      mockTeamRepository.getNextShareIndex.mockResolvedValue(2);
      mockTeamRepository.addMember.mockResolvedValue({
        userId: 'new-user-id',
        role: 'member',
        shareIndex: 2,
        joinedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/team-1/members',
        payload: {
          email: 'newmember@example.com',
          role: 'member',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.member.email).toBe('newmember@example.com');
    });

    it('should reject if user not found', async () => {
      mockTeamRepository.getMember.mockResolvedValue({ role: 'owner' });
      mockUserRepository.findByEmail.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/team-1/members',
        payload: { email: 'nonexistent@example.com' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should reject if all shares assigned', async () => {
      mockTeamRepository.getMember.mockResolvedValue({ role: 'owner' });
      mockUserRepository.findByEmail.mockResolvedValue({ id: 'user-2' });
      mockTeamRepository.getNextShareIndex.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/team-1/members',
        payload: { email: 'new@example.com' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /:id/members/:userId - Remove Member', () => {
    it('should remove member as owner', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        role: 'owner',
      });
      mockTeamRepository.removeMember.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: '/team-1/members/user-2',
      });

      expect(response.statusCode).toBe(204);
    });

    it('should reject removal as member', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        role: 'member',
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/team-1/members/user-2',
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('PATCH /:id/members/:userId - Update Role', () => {
    it('should update role as owner', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        role: 'owner',
      });
      mockTeamRepository.updateMemberRole.mockResolvedValue({
        userId: 'user-2',
        role: 'admin',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/team-1/members/user-2',
        payload: { role: 'admin' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should reject role change as admin', async () => {
      mockTeamRepository.getMember.mockResolvedValue({
        role: 'admin',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/team-1/members/user-2',
        payload: { role: 'member' },
      });

      expect(response.statusCode).toBe(403);
    });
  });
});
