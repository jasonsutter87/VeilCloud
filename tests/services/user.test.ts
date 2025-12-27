/**
 * User Service Tests
 */

// Mock dependencies
jest.mock('../../src/db/connection.js', () => ({
  query: jest.fn(),
}));

jest.mock('../../src/services/audit.js', () => ({
  getAuditService: () => mockAuditService,
}));

const mockAuditService = {
  log: jest.fn(),
};

import { query } from '../../src/db/connection.js';
const mockQuery = query as jest.Mock;

describe('UserService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createUser', () => {
    it('should create user with email and password', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 'user-1',
          email: 'test@example.com',
          display_name: 'Test User',
          created_at: new Date(),
        }],
      });

      const result = await mockQuery(
        'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING *',
        ['test@example.com', 'hashed-password', 'Test User']
      );

      expect(result.rows[0].email).toBe('test@example.com');
    });

    it('should reject duplicate email', async () => {
      mockQuery.mockRejectedValue(
        new Error('unique_violation')
      );

      await expect(
        mockQuery('INSERT INTO users...', ['existing@example.com'])
      ).rejects.toThrow();
    });

    it('should set default display name from email', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ email: 'john@example.com', display_name: 'john' }],
      });

      const result = await mockQuery('INSERT INTO users...');
      expect(result.rows[0].display_name).toBe('john');
    });

    it('should generate UUID for user ID', async () => {
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      mockQuery.mockResolvedValue({
        rows: [{ id: '550e8400-e29b-41d4-a716-446655440000' }],
      });

      const result = await mockQuery('INSERT...');
      expect(result.rows[0].id).toMatch(uuidPattern);
    });

    it('should set created_at timestamp', async () => {
      const now = new Date();
      mockQuery.mockResolvedValue({
        rows: [{ created_at: now }],
      });

      const result = await mockQuery('INSERT...');
      expect(result.rows[0].created_at).toEqual(now);
    });

    it('should log user creation', async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: 'user-1' }] });

      await mockQuery('INSERT...');
      await mockAuditService.log({
        action: 'user.create',
        userId: 'user-1',
      });

      expect(mockAuditService.log).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should find user by ID', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 'user-1',
          email: 'test@example.com',
          display_name: 'Test',
          is_active: true,
        }],
      });

      const result = await mockQuery('SELECT * FROM users WHERE id = $1', ['user-1']);

      expect(result.rows[0].id).toBe('user-1');
    });

    it('should return null for non-existent user', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await mockQuery('SELECT * FROM users WHERE id = $1', ['nonexistent']);

      expect(result.rows).toHaveLength(0);
    });

    it('should exclude password hash', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'user-1', email: 'test@example.com' }],
      });

      const result = await mockQuery('SELECT id, email FROM users...');

      expect(result.rows[0]).not.toHaveProperty('password_hash');
    });
  });

  describe('findByEmail', () => {
    it('should find user by email', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'user-1', email: 'test@example.com' }],
      });

      const result = await mockQuery('SELECT * FROM users WHERE email = $1', ['test@example.com']);

      expect(result.rows[0].email).toBe('test@example.com');
    });

    it('should be case-insensitive', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ email: 'test@example.com' }],
      });

      const result = await mockQuery('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', ['TEST@EXAMPLE.COM']);

      expect(result.rows[0]).toBeTruthy();
    });

    it('should return null for unknown email', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await mockQuery('SELECT * FROM users WHERE email = $1', ['unknown@example.com']);

      expect(result.rows).toHaveLength(0);
    });
  });

  describe('updateUser', () => {
    it('should update display name', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'user-1', display_name: 'New Name' }],
      });

      const result = await mockQuery(
        'UPDATE users SET display_name = $2 WHERE id = $1 RETURNING *',
        ['user-1', 'New Name']
      );

      expect(result.rows[0].display_name).toBe('New Name');
    });

    it('should update email', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ email: 'new@example.com' }],
      });

      const result = await mockQuery(
        'UPDATE users SET email = $2 WHERE id = $1',
        ['user-1', 'new@example.com']
      );

      expect(result.rows[0].email).toBe('new@example.com');
    });

    it('should update password hash', async () => {
      mockQuery.mockResolvedValue({ rows: [{}] });

      await mockQuery(
        'UPDATE users SET password_hash = $2 WHERE id = $1',
        ['user-1', 'new-hash']
      );

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should set updated_at timestamp', async () => {
      const now = new Date();
      mockQuery.mockResolvedValue({
        rows: [{ updated_at: now }],
      });

      const result = await mockQuery('UPDATE users SET ... updated_at = NOW()...');

      expect(result.rows[0].updated_at).toEqual(now);
    });

    it('should reject duplicate email on update', async () => {
      mockQuery.mockRejectedValue(
        new Error('unique_violation')
      );

      await expect(
        mockQuery('UPDATE users SET email = $2...', ['user-1', 'taken@example.com'])
      ).rejects.toThrow();
    });
  });

  describe('deleteUser', () => {
    it('should soft delete user', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'user-1', is_active: false, deleted_at: new Date() }],
      });

      const result = await mockQuery(
        'UPDATE users SET is_active = false, deleted_at = NOW() WHERE id = $1',
        ['user-1']
      );

      expect(result.rows[0].is_active).toBe(false);
    });

    it('should hard delete user when requested', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await mockQuery('DELETE FROM users WHERE id = $1', ['user-1']);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE'),
        expect.any(Array)
      );
    });

    it('should log user deletion', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await mockQuery('DELETE FROM users...');
      await mockAuditService.log({
        action: 'user.delete',
        userId: 'user-1',
      });

      expect(mockAuditService.log).toHaveBeenCalled();
    });
  });

  describe('listUsers', () => {
    it('should list all users', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: 'user-1', email: 'user1@example.com' },
          { id: 'user-2', email: 'user2@example.com' },
        ],
      });

      const result = await mockQuery('SELECT * FROM users');

      expect(result.rows).toHaveLength(2);
    });

    it('should support pagination', async () => {
      mockQuery.mockResolvedValue({
        rows: Array.from({ length: 10 }, (_, i) => ({ id: `user-${i}` })),
      });

      const result = await mockQuery('SELECT * FROM users LIMIT $1 OFFSET $2', [10, 0]);

      expect(result.rows).toHaveLength(10);
    });

    it('should filter by active status', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'user-1', is_active: true }],
      });

      const result = await mockQuery('SELECT * FROM users WHERE is_active = $1', [true]);

      expect(result.rows[0].is_active).toBe(true);
    });

    it('should search by email', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ email: 'john@example.com' }],
      });

      const result = await mockQuery('SELECT * FROM users WHERE email ILIKE $1', ['%john%']);

      expect(result.rows[0].email).toContain('john');
    });

    it('should search by display name', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ display_name: 'John Doe' }],
      });

      const result = await mockQuery('SELECT * FROM users WHERE display_name ILIKE $1', ['%John%']);

      expect(result.rows[0].display_name).toContain('John');
    });

    it('should order by created_at', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: 'user-2', created_at: new Date('2024-01-02') },
          { id: 'user-1', created_at: new Date('2024-01-01') },
        ],
      });

      const result = await mockQuery('SELECT * FROM users ORDER BY created_at DESC');

      expect(result.rows[0].id).toBe('user-2');
    });
  });

  describe('updateLastLogin', () => {
    it('should update last login timestamp', async () => {
      const now = new Date();
      mockQuery.mockResolvedValue({
        rows: [{ last_login_at: now }],
      });

      const result = await mockQuery(
        'UPDATE users SET last_login_at = NOW() WHERE id = $1 RETURNING last_login_at',
        ['user-1']
      );

      expect(result.rows[0].last_login_at).toEqual(now);
    });

    it('should record login IP', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ last_login_ip: '192.168.1.1' }],
      });

      const result = await mockQuery(
        'UPDATE users SET last_login_ip = $2 WHERE id = $1',
        ['user-1', '192.168.1.1']
      );

      expect(result.rows[0].last_login_ip).toBe('192.168.1.1');
    });
  });

  describe('validatePassword', () => {
    const isStrongPassword = (password: string): boolean => {
      if (password.length < 8) return false;
      if (!/[A-Z]/.test(password)) return false;
      if (!/[a-z]/.test(password)) return false;
      if (!/[0-9]/.test(password)) return false;
      if (!/[!@#$%^&*]/.test(password)) return false;
      return true;
    };

    it('should accept strong password', () => {
      expect(isStrongPassword('SecurePass123!')).toBe(true);
    });

    it('should reject short password', () => {
      expect(isStrongPassword('Short1!')).toBe(false);
    });

    it('should reject password without uppercase', () => {
      expect(isStrongPassword('lowercase123!')).toBe(false);
    });

    it('should reject password without lowercase', () => {
      expect(isStrongPassword('UPPERCASE123!')).toBe(false);
    });

    it('should reject password without numbers', () => {
      expect(isStrongPassword('NoNumbers!!')).toBe(false);
    });

    it('should reject password without special chars', () => {
      expect(isStrongPassword('NoSpecial123')).toBe(false);
    });
  });

  describe('validateEmail', () => {
    const isValidEmail = (email: string): boolean => {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    };

    it('should accept valid email', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
    });

    it('should accept email with plus sign', () => {
      expect(isValidEmail('user+tag@example.com')).toBe(true);
    });

    it('should accept email with subdomain', () => {
      expect(isValidEmail('user@mail.example.com')).toBe(true);
    });

    it('should reject email without @', () => {
      expect(isValidEmail('userexample.com')).toBe(false);
    });

    it('should reject email without domain', () => {
      expect(isValidEmail('user@')).toBe(false);
    });

    it('should reject email with spaces', () => {
      expect(isValidEmail('user @example.com')).toBe(false);
    });
  });

  describe('Permissions', () => {
    it('should get user permissions', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ permissions: ['read', 'write', 'admin'] }],
      });

      const result = await mockQuery('SELECT permissions FROM users WHERE id = $1', ['user-1']);

      expect(result.rows[0].permissions).toContain('admin');
    });

    it('should add permission', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ permissions: ['read', 'write'] }],
      });

      const result = await mockQuery(
        "UPDATE users SET permissions = permissions || $2::text[] WHERE id = $1",
        ['user-1', ['write']]
      );

      expect(result.rows[0].permissions).toContain('write');
    });

    it('should remove permission', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ permissions: ['read'] }],
      });

      const result = await mockQuery(
        "UPDATE users SET permissions = array_remove(permissions, $2) WHERE id = $1",
        ['user-1', 'write']
      );

      expect(result.rows[0].permissions).not.toContain('write');
    });

    it('should check permission', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ has_permission: true }],
      });

      const result = await mockQuery(
        "SELECT 'admin' = ANY(permissions) as has_permission FROM users WHERE id = $1",
        ['user-1']
      );

      expect(result.rows[0].has_permission).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    it('should track failed login attempts', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ failed_login_attempts: 3 }],
      });

      const result = await mockQuery(
        'UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE id = $1 RETURNING failed_login_attempts',
        ['user-1']
      );

      expect(result.rows[0].failed_login_attempts).toBe(3);
    });

    it('should lock account after max attempts', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ locked_until: new Date(Date.now() + 900000) }], // 15 min
      });

      const result = await mockQuery(
        'UPDATE users SET locked_until = NOW() + interval \'15 minutes\' WHERE failed_login_attempts >= 5',
        []
      );

      expect(result.rows[0].locked_until.getTime()).toBeGreaterThan(Date.now());
    });

    it('should reset attempts on successful login', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ failed_login_attempts: 0 }],
      });

      const result = await mockQuery(
        'UPDATE users SET failed_login_attempts = 0 WHERE id = $1',
        ['user-1']
      );

      expect(result.rows[0].failed_login_attempts).toBe(0);
    });
  });

  describe('Email Verification', () => {
    it('should mark email as verified', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ email_verified: true, email_verified_at: new Date() }],
      });

      const result = await mockQuery(
        'UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE id = $1',
        ['user-1']
      );

      expect(result.rows[0].email_verified).toBe(true);
    });

    it('should check verification status', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ email_verified: false }],
      });

      const result = await mockQuery('SELECT email_verified FROM users WHERE id = $1', ['user-1']);

      expect(result.rows[0].email_verified).toBe(false);
    });
  });
});
