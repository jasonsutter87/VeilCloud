/**
 * Jest Test Setup
 * Global configuration and test utilities
 */

// Set test environment
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'error';

// Mock environment variables
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/veilcloud_test';
process.env['S3_ENDPOINT'] = 'http://localhost:9000';
process.env['S3_BUCKET'] = 'veilcloud-test';
process.env['S3_ACCESS_KEY'] = 'test-access-key';
process.env['S3_SECRET_KEY'] = 'test-secret-key';
process.env['VEILKEY_URL'] = 'http://localhost:3001';
process.env['VEILCHAIN_URL'] = 'http://localhost:3002';
process.env['VEILSIGN_URL'] = 'http://localhost:3003';

// Increase timeout for integration tests
jest.setTimeout(30000);

// Global test utilities
export const testUtils = {
  /**
   * Generate a random UUID-like string
   */
  randomId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  },

  /**
   * Create a mock user
   */
  mockUser(overrides: Partial<{
    id: string;
    email: string;
    permissions: string[];
  }> = {}) {
    return {
      id: overrides.id ?? this.randomId(),
      email: overrides.email ?? `test-${Date.now()}@example.com`,
      permissions: overrides.permissions ?? [],
      displayName: 'Test User',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },

  /**
   * Create a mock project
   */
  mockProject(overrides: Partial<{
    id: string;
    ownerId: string;
    name: string;
  }> = {}) {
    return {
      id: overrides.id ?? this.randomId(),
      ownerId: overrides.ownerId ?? this.randomId(),
      name: overrides.name ?? `Test Project ${Date.now()}`,
      description: 'A test project',
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },

  /**
   * Create a mock team
   */
  mockTeam(overrides: Partial<{
    id: string;
    ownerId: string;
    name: string;
    threshold: number;
    totalShares: number;
  }> = {}) {
    return {
      id: overrides.id ?? this.randomId(),
      ownerId: overrides.ownerId ?? this.randomId(),
      name: overrides.name ?? `Test Team ${Date.now()}`,
      description: 'A test team',
      veilkeyGroupId: null,
      threshold: overrides.threshold ?? 2,
      totalShares: overrides.totalShares ?? 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },

  /**
   * Create a mock environment
   */
  mockEnvironment(overrides: Partial<{
    id: string;
    projectId: string;
    name: string;
  }> = {}) {
    return {
      id: overrides.id ?? this.randomId(),
      projectId: overrides.projectId ?? this.randomId(),
      name: overrides.name ?? 'production',
      blobKey: `projects/${overrides.projectId ?? 'test'}/envs/${overrides.name ?? 'production'}/blob`,
      blobHash: null,
      blobSize: 0,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },

  /**
   * Wait for a specified duration
   */
  async wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  /**
   * Create mock FastifyRequest
   */
  mockRequest(overrides: Partial<{
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
    params: Record<string, string>;
    query: Record<string, string>;
  }> = {}) {
    return {
      method: overrides.method ?? 'GET',
      url: overrides.url ?? '/',
      headers: overrides.headers ?? {},
      body: overrides.body ?? {},
      params: overrides.params ?? {},
      query: overrides.query ?? {},
      ip: '127.0.0.1',
      user: null,
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    };
  },

  /**
   * Create mock FastifyReply
   */
  mockReply() {
    const reply = {
      statusCode: 200,
      status: jest.fn().mockImplementation((code: number) => {
        reply.statusCode = code;
        return reply;
      }),
      send: jest.fn().mockImplementation((payload: unknown) => {
        reply._sent = payload;
        return reply;
      }),
      header: jest.fn().mockReturnThis(),
      _sent: null as unknown,
    };
    return reply;
  },
};

// Make testUtils available globally in tests
declare global {
  const testUtils: typeof import('./setup').testUtils;
}

(globalThis as any).testUtils = testUtils;

// Cleanup after all tests
afterAll(async () => {
  // Add any global cleanup here
});
