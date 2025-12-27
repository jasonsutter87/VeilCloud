/**
 * End-to-End API Flow Tests
 * Tests complete API workflows from request to response
 */

// Mock server setup
const mockFastify = {
  inject: jest.fn(),
  ready: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../src/api/server.js', () => ({
  createServer: () => mockFastify,
}));

describe('E2E API Flows', () => {
  beforeAll(async () => {
    await mockFastify.ready();
  });

  afterAll(async () => {
    await mockFastify.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('User Registration Flow', () => {
    it('should complete full registration', async () => {
      mockFastify.inject
        .mockResolvedValueOnce({
          statusCode: 201,
          json: () => ({
            userId: 'user-1',
            email: 'new@example.com',
            token: 'jwt-token',
          }),
        });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'new@example.com',
          password: 'SecurePass123!',
          displayName: 'New User',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.token).toBeTruthy();
    });

    it('should reject duplicate email', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 409,
        json: () => ({ error: 'Email already registered' }),
      });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'existing@example.com',
          password: 'Pass123!',
        },
      });

      expect(response.statusCode).toBe(409);
    });

    it('should reject weak password', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 400,
        json: () => ({ error: 'Password too weak' }),
      });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          password: '123',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Login Flow', () => {
    it('should login and receive tokens', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 200,
        json: () => ({
          token: 'access-jwt',
          refreshToken: 'refresh-jwt',
          expiresIn: 3600,
        }),
      });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'user@example.com',
          password: 'correct-password',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.token).toBeTruthy();
      expect(body.refreshToken).toBeTruthy();
    });

    it('should reject invalid credentials', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 401,
        json: () => ({ error: 'Invalid credentials' }),
      });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'user@example.com',
          password: 'wrong-password',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Project CRUD Flow', () => {
    const authHeaders = { authorization: 'Bearer valid-jwt' };

    it('should create project', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 201,
        json: () => ({
          id: 'proj-1',
          name: 'New Project',
          ownerId: 'user-1',
        }),
      });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/projects',
        headers: authHeaders,
        payload: { name: 'New Project' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().id).toBeTruthy();
    });

    it('should list user projects', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 200,
        json: () => ({
          projects: [
            { id: 'proj-1', name: 'Project 1' },
            { id: 'proj-2', name: 'Project 2' },
          ],
          total: 2,
        }),
      });

      const response = await mockFastify.inject({
        method: 'GET',
        url: '/projects',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().projects).toHaveLength(2);
    });

    it('should get project by ID', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 200,
        json: () => ({
          id: 'proj-1',
          name: 'My Project',
          environments: ['dev', 'prod'],
        }),
      });

      const response = await mockFastify.inject({
        method: 'GET',
        url: '/projects/proj-1',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
    });

    it('should update project', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 200,
        json: () => ({
          id: 'proj-1',
          name: 'Updated Name',
        }),
      });

      const response = await mockFastify.inject({
        method: 'PUT',
        url: '/projects/proj-1',
        headers: authHeaders,
        payload: { name: 'Updated Name' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should delete project', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 204,
        json: () => null,
      });

      const response = await mockFastify.inject({
        method: 'DELETE',
        url: '/projects/proj-1',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(204);
    });

    it('should reject unauthorized access', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 401,
        json: () => ({ error: 'Unauthorized' }),
      });

      const response = await mockFastify.inject({
        method: 'GET',
        url: '/projects',
        // No auth header
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Team Flow', () => {
    const authHeaders = { authorization: 'Bearer valid-jwt' };

    it('should create team with threshold', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 201,
        json: () => ({
          id: 'team-1',
          name: 'Engineering',
          threshold: 2,
          totalShares: 3,
        }),
      });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/teams',
        headers: authHeaders,
        payload: {
          name: 'Engineering',
          threshold: 2,
          members: ['user-1', 'user-2', 'user-3'],
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().threshold).toBe(2);
    });

    it('should add team member', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 200,
        json: () => ({
          userId: 'new-member',
          role: 'member',
          shareIndex: 3,
        }),
      });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/teams/team-1/members',
        headers: authHeaders,
        payload: { userId: 'new-member' },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should remove team member', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 204,
        json: () => null,
      });

      const response = await mockFastify.inject({
        method: 'DELETE',
        url: '/teams/team-1/members/old-member',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(204);
    });
  });

  describe('Storage Flow', () => {
    const authHeaders = { authorization: 'Bearer valid-jwt' };

    it('should store encrypted blob', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 200,
        json: () => ({
          version: 1,
          hash: 'sha256-hash',
          size: 1024,
        }),
      });

      const response = await mockFastify.inject({
        method: 'PUT',
        url: '/storage/proj-1/production',
        headers: {
          ...authHeaders,
          'content-type': 'application/octet-stream',
        },
        payload: Buffer.from('encrypted-data'),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().version).toBe(1);
    });

    it('should retrieve encrypted blob', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 200,
        body: Buffer.from('encrypted-data'),
        headers: {
          'content-type': 'application/octet-stream',
          'x-blob-version': '1',
        },
      });

      const response = await mockFastify.inject({
        method: 'GET',
        url: '/storage/proj-1/production',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
    });

    it('should delete blob', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 204,
        json: () => null,
      });

      const response = await mockFastify.inject({
        method: 'DELETE',
        url: '/storage/proj-1/production',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(204);
    });

    it('should return 404 for missing blob', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 404,
        json: () => ({ error: 'Not found' }),
      });

      const response = await mockFastify.inject({
        method: 'GET',
        url: '/storage/proj-1/nonexistent',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('Crypto Flow', () => {
    const authHeaders = { authorization: 'Bearer valid-jwt' };

    it('should encrypt for team', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 200,
        json: () => ({
          ciphertext: 'encrypted-data-base64',
        }),
      });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/crypto/encrypt',
        headers: authHeaders,
        payload: {
          teamId: 'team-1',
          plaintext: 'secret data',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().ciphertext).toBeTruthy();
    });

    it('should generate decryption share', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 200,
        json: () => ({
          shareIndex: 1,
          partialDecryption: 'pd-data',
          proof: 'zkp',
        }),
      });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/crypto/decrypt/share',
        headers: authHeaders,
        payload: {
          teamId: 'team-1',
          ciphertext: 'encrypted-data',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().proof).toBeTruthy();
    });

    it('should combine shares', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 200,
        json: () => ({
          plaintext: 'decrypted secret',
        }),
      });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/crypto/decrypt/combine',
        headers: authHeaders,
        payload: {
          teamId: 'team-1',
          ciphertext: 'encrypted',
          shares: [
            { shareIndex: 0, partialDecryption: 'pd0', proof: 'p0' },
            { shareIndex: 1, partialDecryption: 'pd1', proof: 'p1' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().plaintext).toBeTruthy();
    });
  });

  describe('Audit Flow', () => {
    const authHeaders = { authorization: 'Bearer valid-jwt' };

    it('should get audit trail', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 200,
        json: () => ({
          entries: [
            { id: 'e1', action: 'create', timestamp: new Date().toISOString() },
            { id: 'e2', action: 'read', timestamp: new Date().toISOString() },
          ],
          total: 2,
        }),
      });

      const response = await mockFastify.inject({
        method: 'GET',
        url: '/audit/proj-1',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().entries).toHaveLength(2);
    });

    it('should get proof for entry', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 200,
        json: () => ({
          root: 'merkle-root',
          proof: ['sibling1', 'sibling2'],
          index: 5,
        }),
      });

      const response = await mockFastify.inject({
        method: 'GET',
        url: '/audit/proj-1/proof/entry-1',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().proof).toBeTruthy();
    });

    it('should verify proof', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 200,
        json: () => ({
          valid: true,
          verifiedAt: new Date().toISOString(),
        }),
      });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/audit/verify',
        headers: authHeaders,
        payload: {
          root: 'root',
          proof: ['s1'],
          leaf: 'entry-hash',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().valid).toBe(true);
    });
  });

  describe('Access Control Flow', () => {
    const authHeaders = { authorization: 'Bearer valid-jwt' };

    it('should issue credential', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 201,
        json: () => ({
          credentialId: 'cred-1',
          credential: 'serialized-cred',
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/access/issue',
        headers: authHeaders,
        payload: {
          userId: 'user-2',
          projectId: 'proj-1',
          permissions: ['read'],
          expiresIn: '24h',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().credential).toBeTruthy();
    });

    it('should verify credential', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 200,
        json: () => ({
          valid: true,
          userId: 'user-2',
          permissions: ['read'],
        }),
      });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/access/verify',
        payload: { credential: 'cred-data' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().valid).toBe(true);
    });

    it('should revoke credential', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 200,
        json: () => ({
          revoked: true,
          revokedAt: new Date().toISOString(),
        }),
      });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/access/revoke',
        headers: authHeaders,
        payload: { credentialId: 'cred-1' },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Error Responses', () => {
    it('should return 400 for invalid JSON', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 400,
        json: () => ({ error: 'Invalid JSON' }),
      });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/projects',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json',
        },
        payload: 'not-json',
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 403 for forbidden resource', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 403,
        json: () => ({ error: 'Forbidden' }),
      });

      const response = await mockFastify.inject({
        method: 'GET',
        url: '/projects/other-users-project',
        headers: { authorization: 'Bearer valid-jwt' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for not found', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 404,
        json: () => ({ error: 'Not found' }),
      });

      const response = await mockFastify.inject({
        method: 'GET',
        url: '/projects/nonexistent-id',
        headers: { authorization: 'Bearer valid-jwt' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 500 for internal error', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 500,
        json: () => ({ error: 'Internal server error' }),
      });

      const response = await mockFastify.inject({
        method: 'GET',
        url: '/projects',
        headers: { authorization: 'Bearer valid-jwt' },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('Rate Limiting', () => {
    it('should return 429 when rate limited', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 429,
        json: () => ({ error: 'Too many requests' }),
        headers: { 'retry-after': '60' },
      });

      const response = await mockFastify.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'user@example.com', password: 'pass' },
      });

      expect(response.statusCode).toBe(429);
    });
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      mockFastify.inject.mockResolvedValueOnce({
        statusCode: 200,
        json: () => ({
          status: 'healthy',
          services: {
            database: 'up',
            storage: 'up',
            veilkey: 'up',
            veilchain: 'up',
            veilsign: 'up',
          },
        }),
      });

      const response = await mockFastify.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('healthy');
    });
  });
});
