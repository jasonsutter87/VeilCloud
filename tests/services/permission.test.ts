/**
 * Permission Service Tests
 */

// Mock permission service
class PermissionService {
  private permissions: Map<string, Set<string>> = new Map();
  private rolePermissions: Map<string, Set<string>> = new Map();

  constructor() {
    // Default role permissions
    this.rolePermissions.set('admin', new Set(['read', 'write', 'delete', 'admin']));
    this.rolePermissions.set('editor', new Set(['read', 'write']));
    this.rolePermissions.set('viewer', new Set(['read']));
  }

  async grant(userId: string, permission: string): Promise<void> {
    if (!this.permissions.has(userId)) {
      this.permissions.set(userId, new Set());
    }
    this.permissions.get(userId)!.add(permission);
  }

  async revoke(userId: string, permission: string): Promise<boolean> {
    const userPerms = this.permissions.get(userId);
    if (!userPerms) return false;
    return userPerms.delete(permission);
  }

  async check(userId: string, permission: string): Promise<boolean> {
    const userPerms = this.permissions.get(userId);
    return userPerms?.has(permission) ?? false;
  }

  async listPermissions(userId: string): Promise<string[]> {
    const userPerms = this.permissions.get(userId);
    return userPerms ? Array.from(userPerms) : [];
  }

  async assignRole(userId: string, role: string): Promise<void> {
    const rolePerms = this.rolePermissions.get(role);
    if (!rolePerms) throw new Error(`Unknown role: ${role}`);

    if (!this.permissions.has(userId)) {
      this.permissions.set(userId, new Set());
    }
    for (const perm of rolePerms) {
      this.permissions.get(userId)!.add(perm);
    }
  }

  async hasAny(userId: string, permissions: string[]): Promise<boolean> {
    const userPerms = this.permissions.get(userId);
    if (!userPerms) return false;
    return permissions.some(p => userPerms.has(p));
  }

  async hasAll(userId: string, permissions: string[]): Promise<boolean> {
    const userPerms = this.permissions.get(userId);
    if (!userPerms) return false;
    return permissions.every(p => userPerms.has(p));
  }

  async clear(userId: string): Promise<void> {
    this.permissions.delete(userId);
  }
}

describe('PermissionService', () => {
  let service: PermissionService;

  beforeEach(() => {
    service = new PermissionService();
  });

  describe('grant', () => {
    it('should grant permission to user', async () => {
      await service.grant('user-1', 'read');
      expect(await service.check('user-1', 'read')).toBe(true);
    });

    it('should grant multiple permissions', async () => {
      await service.grant('user-1', 'read');
      await service.grant('user-1', 'write');
      expect(await service.check('user-1', 'read')).toBe(true);
      expect(await service.check('user-1', 'write')).toBe(true);
    });

    it('should be idempotent', async () => {
      await service.grant('user-1', 'read');
      await service.grant('user-1', 'read');
      const perms = await service.listPermissions('user-1');
      expect(perms.filter(p => p === 'read')).toHaveLength(1);
    });

    it('should grant to new user', async () => {
      await service.grant('new-user', 'read');
      expect(await service.check('new-user', 'read')).toBe(true);
    });

    it('should handle special characters in permission names', async () => {
      await service.grant('user-1', 'project:read');
      expect(await service.check('user-1', 'project:read')).toBe(true);
    });
  });

  describe('revoke', () => {
    it('should revoke permission', async () => {
      await service.grant('user-1', 'read');
      await service.revoke('user-1', 'read');
      expect(await service.check('user-1', 'read')).toBe(false);
    });

    it('should return true when permission revoked', async () => {
      await service.grant('user-1', 'read');
      const result = await service.revoke('user-1', 'read');
      expect(result).toBe(true);
    });

    it('should return false for non-existent permission', async () => {
      const result = await service.revoke('user-1', 'nonexistent');
      expect(result).toBe(false);
    });

    it('should only revoke specified permission', async () => {
      await service.grant('user-1', 'read');
      await service.grant('user-1', 'write');
      await service.revoke('user-1', 'read');
      expect(await service.check('user-1', 'write')).toBe(true);
    });

    it('should handle revoking from non-existent user', async () => {
      const result = await service.revoke('nonexistent', 'read');
      expect(result).toBe(false);
    });
  });

  describe('check', () => {
    it('should return true for granted permission', async () => {
      await service.grant('user-1', 'read');
      expect(await service.check('user-1', 'read')).toBe(true);
    });

    it('should return false for non-granted permission', async () => {
      expect(await service.check('user-1', 'write')).toBe(false);
    });

    it('should return false for non-existent user', async () => {
      expect(await service.check('nonexistent', 'read')).toBe(false);
    });

    it('should distinguish between users', async () => {
      await service.grant('user-1', 'read');
      expect(await service.check('user-1', 'read')).toBe(true);
      expect(await service.check('user-2', 'read')).toBe(false);
    });

    it('should be case-sensitive', async () => {
      await service.grant('user-1', 'read');
      expect(await service.check('user-1', 'READ')).toBe(false);
    });
  });

  describe('listPermissions', () => {
    it('should list all user permissions', async () => {
      await service.grant('user-1', 'read');
      await service.grant('user-1', 'write');
      const perms = await service.listPermissions('user-1');
      expect(perms).toContain('read');
      expect(perms).toContain('write');
    });

    it('should return empty array for new user', async () => {
      const perms = await service.listPermissions('new-user');
      expect(perms).toEqual([]);
    });

    it('should not include revoked permissions', async () => {
      await service.grant('user-1', 'read');
      await service.grant('user-1', 'write');
      await service.revoke('user-1', 'read');
      const perms = await service.listPermissions('user-1');
      expect(perms).not.toContain('read');
      expect(perms).toContain('write');
    });

    it('should return unique permissions', async () => {
      await service.grant('user-1', 'read');
      await service.grant('user-1', 'read');
      const perms = await service.listPermissions('user-1');
      expect(perms.length).toBe(1);
    });
  });

  describe('assignRole', () => {
    it('should assign admin role permissions', async () => {
      await service.assignRole('user-1', 'admin');
      expect(await service.check('user-1', 'admin')).toBe(true);
      expect(await service.check('user-1', 'delete')).toBe(true);
    });

    it('should assign editor role permissions', async () => {
      await service.assignRole('user-1', 'editor');
      expect(await service.check('user-1', 'read')).toBe(true);
      expect(await service.check('user-1', 'write')).toBe(true);
      expect(await service.check('user-1', 'admin')).toBe(false);
    });

    it('should assign viewer role permissions', async () => {
      await service.assignRole('user-1', 'viewer');
      expect(await service.check('user-1', 'read')).toBe(true);
      expect(await service.check('user-1', 'write')).toBe(false);
    });

    it('should throw for unknown role', async () => {
      await expect(service.assignRole('user-1', 'unknown')).rejects.toThrow('Unknown role');
    });

    it('should combine with existing permissions', async () => {
      await service.grant('user-1', 'custom');
      await service.assignRole('user-1', 'viewer');
      expect(await service.check('user-1', 'custom')).toBe(true);
      expect(await service.check('user-1', 'read')).toBe(true);
    });

    it('should allow multiple role assignments', async () => {
      await service.assignRole('user-1', 'viewer');
      await service.assignRole('user-1', 'editor');
      expect(await service.check('user-1', 'write')).toBe(true);
    });
  });

  describe('hasAny', () => {
    it('should return true if user has any permission', async () => {
      await service.grant('user-1', 'read');
      expect(await service.hasAny('user-1', ['read', 'write'])).toBe(true);
    });

    it('should return false if user has none', async () => {
      await service.grant('user-1', 'delete');
      expect(await service.hasAny('user-1', ['read', 'write'])).toBe(false);
    });

    it('should return false for non-existent user', async () => {
      expect(await service.hasAny('nonexistent', ['read'])).toBe(false);
    });

    it('should return false for empty permission list', async () => {
      await service.grant('user-1', 'read');
      expect(await service.hasAny('user-1', [])).toBe(false);
    });

    it('should check all provided permissions', async () => {
      await service.grant('user-1', 'admin');
      expect(await service.hasAny('user-1', ['read', 'write', 'admin'])).toBe(true);
    });
  });

  describe('hasAll', () => {
    it('should return true if user has all permissions', async () => {
      await service.grant('user-1', 'read');
      await service.grant('user-1', 'write');
      expect(await service.hasAll('user-1', ['read', 'write'])).toBe(true);
    });

    it('should return false if user missing one', async () => {
      await service.grant('user-1', 'read');
      expect(await service.hasAll('user-1', ['read', 'write'])).toBe(false);
    });

    it('should return false for non-existent user', async () => {
      expect(await service.hasAll('nonexistent', ['read'])).toBe(false);
    });

    it('should return true for empty permission list', async () => {
      await service.grant('user-1', 'read');
      expect(await service.hasAll('user-1', [])).toBe(true);
    });

    it('should require exact matches', async () => {
      await service.grant('user-1', 'read');
      await service.grant('user-1', 'write');
      expect(await service.hasAll('user-1', ['read', 'write', 'delete'])).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all user permissions', async () => {
      await service.grant('user-1', 'read');
      await service.grant('user-1', 'write');
      await service.clear('user-1');
      expect(await service.listPermissions('user-1')).toEqual([]);
    });

    it('should only clear specified user', async () => {
      await service.grant('user-1', 'read');
      await service.grant('user-2', 'read');
      await service.clear('user-1');
      expect(await service.check('user-2', 'read')).toBe(true);
    });

    it('should handle clearing non-existent user', async () => {
      await expect(service.clear('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('permission inheritance', () => {
    it('should not inherit parent permissions automatically', async () => {
      await service.grant('user-1', 'project:*');
      expect(await service.check('user-1', 'project:read')).toBe(false);
    });

    it('should support wildcard pattern matching manually', async () => {
      const hasWildcard = async (userId: string, permission: string): Promise<boolean> => {
        const perms = await service.listPermissions(userId);
        const parts = permission.split(':');
        if (parts.length > 1) {
          return perms.includes(permission) || perms.includes(`${parts[0]}:*`);
        }
        return perms.includes(permission);
      };

      await service.grant('user-1', 'project:*');
      expect(await hasWildcard('user-1', 'project:read')).toBe(true);
    });
  });

  describe('resource-based permissions', () => {
    it('should support resource-specific permissions', async () => {
      await service.grant('user-1', 'project:123:read');
      expect(await service.check('user-1', 'project:123:read')).toBe(true);
      expect(await service.check('user-1', 'project:456:read')).toBe(false);
    });

    it('should distinguish resource permissions', async () => {
      await service.grant('user-1', 'project:123:read');
      await service.grant('user-1', 'project:456:write');
      expect(await service.check('user-1', 'project:123:write')).toBe(false);
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent grants', async () => {
      await Promise.all([
        service.grant('user-1', 'read'),
        service.grant('user-1', 'write'),
        service.grant('user-1', 'delete'),
      ]);
      const perms = await service.listPermissions('user-1');
      expect(perms).toHaveLength(3);
    });

    it('should handle concurrent checks', async () => {
      await service.grant('user-1', 'read');
      const results = await Promise.all([
        service.check('user-1', 'read'),
        service.check('user-1', 'read'),
        service.check('user-1', 'read'),
      ]);
      expect(results.every(r => r === true)).toBe(true);
    });
  });

  describe('performance', () => {
    it('should handle many permissions', async () => {
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        await service.grant('user-1', `permission-${i}`);
      }
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000);
    });

    it('should have fast permission checks', async () => {
      for (let i = 0; i < 100; i++) {
        await service.grant('user-1', `permission-${i}`);
      }

      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        await service.check('user-1', `permission-${i % 100}`);
      }
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });
  });
});
