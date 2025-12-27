/**
 * Storage API Tests
 */

import Fastify, { FastifyInstance } from 'fastify';

// Mock dependencies
const mockStorageService = {
  put: jest.fn(),
  get: jest.fn(),
  delete: jest.fn(),
  listByProject: jest.fn(),
  getMetadata: jest.fn(),
};

const mockAuditService = {
  logBlobRead: jest.fn(),
  logBlobWrite: jest.fn(),
  logBlobDelete: jest.fn(),
};

const mockProjectRepository = {
  hasPermission: jest.fn(),
};

jest.mock('../../src/services/storage.js', () => ({
  getStorageService: () => mockStorageService,
}));

jest.mock('../../src/services/audit.js', () => ({
  getAuditService: () => mockAuditService,
}));

jest.mock('../../src/db/repositories/project.js', () => ({
  ProjectRepository: mockProjectRepository,
}));

jest.mock('../../src/api/middleware/auth.js', () => ({
  authenticate: async (request: any) => {
    request.user = { id: 'user-1', email: 'test@example.com', permissions: [] };
  },
  requirePermission: () => async () => {},
}));

describe('Storage API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { storageRoutes } = await import('../../src/api/routes/storage.js');
    app = Fastify();
    await app.register(storageRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockProjectRepository.hasPermission.mockResolvedValue(true);
  });

  describe('PUT /:projectId/:envName', () => {
    it('should store encrypted blob', async () => {
      mockStorageService.put.mockResolvedValue({
        key: 'projects/proj-1/envs/production/blob',
        size: 100,
        hash: 'abc123',
        version: 1,
      });

      const response = await app.inject({
        method: 'PUT',
        url: '/proj-1/production',
        payload: {
          data: 'base64encodeddata',
          metadata: 'encryptedmetadata',
          contentType: 'application/octet-stream',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.blob).toHaveProperty('key');
      expect(body.blob).toHaveProperty('size', 100);
    });

    it('should require data field', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/proj-1/production',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('should check write permission', async () => {
      mockProjectRepository.hasPermission.mockResolvedValue(false);

      const response = await app.inject({
        method: 'PUT',
        url: '/proj-1/production',
        payload: { data: 'test' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should log to audit service', async () => {
      mockStorageService.put.mockResolvedValue({ size: 100 });

      await app.inject({
        method: 'PUT',
        url: '/proj-1/production',
        payload: { data: 'test' },
      });

      expect(mockAuditService.logBlobWrite).toHaveBeenCalledWith(
        'user-1',
        'proj-1',
        'production',
        100,
        expect.any(String)
      );
    });
  });

  describe('GET /:projectId/:envName', () => {
    it('should retrieve encrypted blob', async () => {
      mockStorageService.get.mockResolvedValue({
        data: 'encrypteddata',
        metadata: 'meta',
        size: 100,
        hash: 'abc123',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/proj-1/production',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBe('encrypteddata');
    });

    it('should check read permission', async () => {
      mockProjectRepository.hasPermission.mockResolvedValue(false);

      const response = await app.inject({
        method: 'GET',
        url: '/proj-1/production',
      });

      expect(response.statusCode).toBe(403);
    });

    it('should log to audit service', async () => {
      mockStorageService.get.mockResolvedValue({ data: 'test' });

      await app.inject({
        method: 'GET',
        url: '/proj-1/production',
      });

      expect(mockAuditService.logBlobRead).toHaveBeenCalledWith(
        'user-1',
        'proj-1',
        'production',
        expect.any(String)
      );
    });
  });

  describe('DELETE /:projectId/:envName', () => {
    it('should delete blob', async () => {
      mockStorageService.delete.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: '/proj-1/production',
      });

      expect(response.statusCode).toBe(204);
    });

    it('should check delete permission', async () => {
      mockProjectRepository.hasPermission.mockResolvedValue(false);

      const response = await app.inject({
        method: 'DELETE',
        url: '/proj-1/production',
      });

      expect(response.statusCode).toBe(403);
    });

    it('should log to audit service', async () => {
      await app.inject({
        method: 'DELETE',
        url: '/proj-1/production',
      });

      expect(mockAuditService.logBlobDelete).toHaveBeenCalledWith(
        'user-1',
        'proj-1',
        'production',
        expect.any(String)
      );
    });
  });

  describe('GET /:projectId', () => {
    it('should list blobs for project', async () => {
      mockStorageService.listByProject.mockResolvedValue({
        items: [
          { key: 'prod', size: 100 },
          { key: 'staging', size: 50 },
        ],
        continuationToken: null,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/proj-1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(2);
    });

    it('should support pagination', async () => {
      mockStorageService.listByProject.mockResolvedValue({
        items: [{ key: 'env1' }],
        continuationToken: 'token123',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/proj-1?continuationToken=token123',
      });

      expect(response.statusCode).toBe(200);
      expect(mockStorageService.listByProject).toHaveBeenCalledWith(
        'proj-1',
        'token123'
      );
    });
  });

  describe('HEAD /:projectId/:envName', () => {
    it('should return metadata headers', async () => {
      mockStorageService.getMetadata.mockResolvedValue({
        size: 1024,
        hash: 'abc123def',
      });

      const response = await app.inject({
        method: 'HEAD',
        url: '/proj-1/production',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-veilcloud-size']).toBe('1024');
      expect(response.headers['x-veilcloud-hash']).toBe('abc123def');
    });

    it('should return 404 for non-existent blob', async () => {
      mockStorageService.getMetadata.mockResolvedValue(null);

      const response = await app.inject({
        method: 'HEAD',
        url: '/proj-1/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
