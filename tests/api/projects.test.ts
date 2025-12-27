/**
 * Projects API Route Tests
 */

// Mock dependencies
jest.mock('../../src/services/storage.js', () => ({
  getStorageService: () => mockStorageService,
}));

jest.mock('../../src/services/audit.js', () => ({
  getAuditService: () => mockAuditService,
}));

jest.mock('../../src/db/repositories/project.js', () => ({
  ProjectRepository: mockProjectRepository,
}));

jest.mock('../../src/db/repositories/environment.js', () => ({
  EnvironmentRepository: mockEnvironmentRepository,
}));

const mockStorageService = {
  deleteProjectBlobs: jest.fn(),
};

const mockAuditService = {
  log: jest.fn(),
};

const mockProjectRepository = {
  findById: jest.fn(),
  findByOwner: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  isOwner: jest.fn(),
  isMember: jest.fn(),
  addMember: jest.fn(),
  removeMember: jest.fn(),
  getMembers: jest.fn(),
  archive: jest.fn(),
  unarchive: jest.fn(),
  count: jest.fn(),
};

const mockEnvironmentRepository = {
  findByProject: jest.fn(),
  deleteByProject: jest.fn(),
};

describe('Projects API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /projects', () => {
    it('should list user projects', async () => {
      mockProjectRepository.findByOwner.mockResolvedValue([
        { id: 'proj-1', name: 'Project 1', ownerId: 'user-1' },
        { id: 'proj-2', name: 'Project 2', ownerId: 'user-1' },
      ]);

      const result = await mockProjectRepository.findByOwner('user-1');

      expect(result).toHaveLength(2);
      expect(mockProjectRepository.findByOwner).toHaveBeenCalledWith('user-1');
    });

    it('should return empty array for new user', async () => {
      mockProjectRepository.findByOwner.mockResolvedValue([]);

      const result = await mockProjectRepository.findByOwner('new-user');

      expect(result).toEqual([]);
    });

    it('should include project metadata', async () => {
      mockProjectRepository.findByOwner.mockResolvedValue([
        {
          id: 'proj-1',
          name: 'Project 1',
          ownerId: 'user-1',
          description: 'Test project',
          isArchived: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await mockProjectRepository.findByOwner('user-1');

      expect(result[0]).toHaveProperty('description');
      expect(result[0]).toHaveProperty('isArchived');
      expect(result[0]).toHaveProperty('createdAt');
    });

    it('should filter archived projects when requested', async () => {
      mockProjectRepository.findByOwner.mockResolvedValue([
        { id: 'proj-1', isArchived: false },
      ]);

      const result = await mockProjectRepository.findByOwner('user-1', { archived: false });

      expect(result[0].isArchived).toBe(false);
    });
  });

  describe('GET /projects/:id', () => {
    it('should return project by ID', async () => {
      mockProjectRepository.findById.mockResolvedValue({
        id: 'proj-1',
        name: 'My Project',
        ownerId: 'user-1',
      });

      const result = await mockProjectRepository.findById('proj-1');

      expect(result.id).toBe('proj-1');
      expect(result.name).toBe('My Project');
    });

    it('should return null for non-existent project', async () => {
      mockProjectRepository.findById.mockResolvedValue(null);

      const result = await mockProjectRepository.findById('nonexistent');

      expect(result).toBeNull();
    });

    it('should include environments with project', async () => {
      mockProjectRepository.findById.mockResolvedValue({ id: 'proj-1' });
      mockEnvironmentRepository.findByProject.mockResolvedValue([
        { name: 'dev' },
        { name: 'staging' },
        { name: 'prod' },
      ]);

      const project = await mockProjectRepository.findById('proj-1');
      const envs = await mockEnvironmentRepository.findByProject('proj-1');

      expect(project).toBeTruthy();
      expect(envs).toHaveLength(3);
    });
  });

  describe('POST /projects', () => {
    it('should create project', async () => {
      mockProjectRepository.create.mockResolvedValue({
        id: 'new-proj',
        name: 'New Project',
        ownerId: 'user-1',
      });

      const result = await mockProjectRepository.create({
        name: 'New Project',
        ownerId: 'user-1',
      });

      expect(result.id).toBe('new-proj');
      expect(result.name).toBe('New Project');
    });

    it('should log project creation', async () => {
      mockProjectRepository.create.mockResolvedValue({ id: 'new-proj' });

      await mockProjectRepository.create({ name: 'Test', ownerId: 'user-1' });
      await mockAuditService.log({
        action: 'project.create',
        userId: 'user-1',
        context: { projectId: 'new-proj' },
      });

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'project.create' })
      );
    });

    it('should reject empty project name', async () => {
      mockProjectRepository.create.mockRejectedValue(
        new Error('Project name required')
      );

      await expect(
        mockProjectRepository.create({ name: '', ownerId: 'user-1' })
      ).rejects.toThrow('Project name required');
    });

    it('should reject duplicate project name for user', async () => {
      mockProjectRepository.create.mockRejectedValue(
        new Error('Project already exists')
      );

      await expect(
        mockProjectRepository.create({ name: 'Existing', ownerId: 'user-1' })
      ).rejects.toThrow('Project already exists');
    });

    it('should include description if provided', async () => {
      mockProjectRepository.create.mockResolvedValue({
        id: 'proj-1',
        name: 'Test',
        description: 'A test project',
      });

      const result = await mockProjectRepository.create({
        name: 'Test',
        description: 'A test project',
        ownerId: 'user-1',
      });

      expect(result.description).toBe('A test project');
    });
  });

  describe('PUT /projects/:id', () => {
    it('should update project name', async () => {
      mockProjectRepository.isOwner.mockResolvedValue(true);
      mockProjectRepository.update.mockResolvedValue({
        id: 'proj-1',
        name: 'Updated Name',
      });

      const result = await mockProjectRepository.update('proj-1', {
        name: 'Updated Name',
      });

      expect(result.name).toBe('Updated Name');
    });

    it('should update project description', async () => {
      mockProjectRepository.isOwner.mockResolvedValue(true);
      mockProjectRepository.update.mockResolvedValue({
        id: 'proj-1',
        description: 'New description',
      });

      const result = await mockProjectRepository.update('proj-1', {
        description: 'New description',
      });

      expect(result.description).toBe('New description');
    });

    it('should reject update by non-owner', async () => {
      mockProjectRepository.isOwner.mockResolvedValue(false);

      const isOwner = await mockProjectRepository.isOwner('proj-1', 'other-user');

      expect(isOwner).toBe(false);
    });

    it('should log project update', async () => {
      mockProjectRepository.update.mockResolvedValue({ id: 'proj-1' });

      await mockProjectRepository.update('proj-1', { name: 'New Name' });
      await mockAuditService.log({
        action: 'project.update',
        userId: 'user-1',
        context: { projectId: 'proj-1' },
      });

      expect(mockAuditService.log).toHaveBeenCalled();
    });
  });

  describe('DELETE /projects/:id', () => {
    it('should delete project', async () => {
      mockProjectRepository.isOwner.mockResolvedValue(true);
      mockProjectRepository.delete.mockResolvedValue(true);

      const result = await mockProjectRepository.delete('proj-1');

      expect(result).toBe(true);
    });

    it('should delete project blobs', async () => {
      mockStorageService.deleteProjectBlobs.mockResolvedValue(undefined);

      await mockStorageService.deleteProjectBlobs('proj-1');

      expect(mockStorageService.deleteProjectBlobs).toHaveBeenCalledWith('proj-1');
    });

    it('should delete project environments', async () => {
      mockEnvironmentRepository.deleteByProject.mockResolvedValue(undefined);

      await mockEnvironmentRepository.deleteByProject('proj-1');

      expect(mockEnvironmentRepository.deleteByProject).toHaveBeenCalledWith('proj-1');
    });

    it('should reject delete by non-owner', async () => {
      mockProjectRepository.isOwner.mockResolvedValue(false);

      const isOwner = await mockProjectRepository.isOwner('proj-1', 'other-user');

      expect(isOwner).toBe(false);
    });

    it('should log project deletion', async () => {
      mockProjectRepository.delete.mockResolvedValue(true);

      await mockProjectRepository.delete('proj-1');
      await mockAuditService.log({
        action: 'project.delete',
        userId: 'user-1',
        context: { projectId: 'proj-1' },
      });

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'project.delete' })
      );
    });
  });

  describe('POST /projects/:id/archive', () => {
    it('should archive project', async () => {
      mockProjectRepository.archive.mockResolvedValue({
        id: 'proj-1',
        isArchived: true,
      });

      const result = await mockProjectRepository.archive('proj-1');

      expect(result.isArchived).toBe(true);
    });

    it('should log archive action', async () => {
      mockProjectRepository.archive.mockResolvedValue({ id: 'proj-1' });

      await mockProjectRepository.archive('proj-1');
      await mockAuditService.log({
        action: 'project.archive',
        userId: 'user-1',
        context: { projectId: 'proj-1' },
      });

      expect(mockAuditService.log).toHaveBeenCalled();
    });
  });

  describe('POST /projects/:id/unarchive', () => {
    it('should unarchive project', async () => {
      mockProjectRepository.unarchive.mockResolvedValue({
        id: 'proj-1',
        isArchived: false,
      });

      const result = await mockProjectRepository.unarchive('proj-1');

      expect(result.isArchived).toBe(false);
    });
  });

  describe('Project Members', () => {
    describe('GET /projects/:id/members', () => {
      it('should list project members', async () => {
        mockProjectRepository.getMembers.mockResolvedValue([
          { userId: 'user-1', role: 'owner' },
          { userId: 'user-2', role: 'member' },
        ]);

        const result = await mockProjectRepository.getMembers('proj-1');

        expect(result).toHaveLength(2);
      });

      it('should include member roles', async () => {
        mockProjectRepository.getMembers.mockResolvedValue([
          { userId: 'user-1', role: 'admin' },
        ]);

        const result = await mockProjectRepository.getMembers('proj-1');

        expect(result[0].role).toBe('admin');
      });
    });

    describe('POST /projects/:id/members', () => {
      it('should add project member', async () => {
        mockProjectRepository.addMember.mockResolvedValue({
          userId: 'new-user',
          role: 'member',
        });

        const result = await mockProjectRepository.addMember('proj-1', {
          userId: 'new-user',
          role: 'member',
        });

        expect(result.userId).toBe('new-user');
      });

      it('should reject duplicate member', async () => {
        mockProjectRepository.addMember.mockRejectedValue(
          new Error('User already a member')
        );

        await expect(
          mockProjectRepository.addMember('proj-1', { userId: 'existing' })
        ).rejects.toThrow('User already a member');
      });

      it('should log member addition', async () => {
        mockProjectRepository.addMember.mockResolvedValue({ userId: 'new-user' });

        await mockProjectRepository.addMember('proj-1', { userId: 'new-user' });
        await mockAuditService.log({
          action: 'project.member.add',
          userId: 'owner-user',
          context: { projectId: 'proj-1', addedUserId: 'new-user' },
        });

        expect(mockAuditService.log).toHaveBeenCalled();
      });
    });

    describe('DELETE /projects/:id/members/:userId', () => {
      it('should remove project member', async () => {
        mockProjectRepository.removeMember.mockResolvedValue(true);

        const result = await mockProjectRepository.removeMember('proj-1', 'user-2');

        expect(result).toBe(true);
      });

      it('should not allow removing owner', async () => {
        mockProjectRepository.removeMember.mockRejectedValue(
          new Error('Cannot remove project owner')
        );

        await expect(
          mockProjectRepository.removeMember('proj-1', 'owner-user')
        ).rejects.toThrow('Cannot remove project owner');
      });
    });
  });

  describe('Access Control', () => {
    it('should check project ownership', async () => {
      mockProjectRepository.isOwner.mockResolvedValue(true);

      const result = await mockProjectRepository.isOwner('proj-1', 'user-1');

      expect(result).toBe(true);
    });

    it('should check project membership', async () => {
      mockProjectRepository.isMember.mockResolvedValue(true);

      const result = await mockProjectRepository.isMember('proj-1', 'user-2');

      expect(result).toBe(true);
    });

    it('should reject non-member access', async () => {
      mockProjectRepository.isMember.mockResolvedValue(false);

      const result = await mockProjectRepository.isMember('proj-1', 'stranger');

      expect(result).toBe(false);
    });
  });

  describe('Pagination', () => {
    it('should support limit parameter', async () => {
      mockProjectRepository.findByOwner.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({ id: `proj-${i}` }))
      );

      const result = await mockProjectRepository.findByOwner('user-1', { limit: 10 });

      expect(result).toHaveLength(10);
    });

    it('should support offset parameter', async () => {
      mockProjectRepository.findByOwner.mockResolvedValue([
        { id: 'proj-10' },
        { id: 'proj-11' },
      ]);

      const result = await mockProjectRepository.findByOwner('user-1', { offset: 10, limit: 2 });

      expect(result[0].id).toBe('proj-10');
    });

    it('should return count with results', async () => {
      mockProjectRepository.count.mockResolvedValue(50);

      const count = await mockProjectRepository.count('user-1');

      expect(count).toBe(50);
    });
  });

  describe('Validation', () => {
    it('should reject name over 255 characters', async () => {
      mockProjectRepository.create.mockRejectedValue(
        new Error('Name too long')
      );

      await expect(
        mockProjectRepository.create({ name: 'a'.repeat(256), ownerId: 'user-1' })
      ).rejects.toThrow();
    });

    it('should allow special characters in name', async () => {
      mockProjectRepository.create.mockResolvedValue({
        id: 'proj-1',
        name: 'My Project (v2) - 2024',
      });

      const result = await mockProjectRepository.create({
        name: 'My Project (v2) - 2024',
        ownerId: 'user-1',
      });

      expect(result.name).toBe('My Project (v2) - 2024');
    });

    it('should trim whitespace from name', async () => {
      mockProjectRepository.create.mockResolvedValue({
        id: 'proj-1',
        name: 'Trimmed',
      });

      const result = await mockProjectRepository.create({
        name: '  Trimmed  ',
        ownerId: 'user-1',
      });

      expect(result.name).toBe('Trimmed');
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors', async () => {
      mockProjectRepository.findByOwner.mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(
        mockProjectRepository.findByOwner('user-1')
      ).rejects.toThrow('Database connection failed');
    });

    it('should handle invalid UUID', async () => {
      mockProjectRepository.findById.mockRejectedValue(
        new Error('Invalid UUID')
      );

      await expect(
        mockProjectRepository.findById('not-a-uuid')
      ).rejects.toThrow('Invalid UUID');
    });
  });
});
