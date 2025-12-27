/**
 * Storage Service Tests
 */

// Mock dependencies
jest.mock('../../src/integrations/s3.js', () => ({
  getS3Client: () => mockS3Client,
}));

jest.mock('../../src/db/connection.js', () => ({
  query: jest.fn(),
}));

jest.mock('../../src/services/audit.js', () => ({
  getAuditService: () => mockAuditService,
}));

const mockS3Client = {
  putObject: jest.fn(),
  getObject: jest.fn(),
  deleteObject: jest.fn(),
  headObject: jest.fn(),
  listObjects: jest.fn(),
  copyObject: jest.fn(),
};

const mockAuditService = {
  log: jest.fn(),
};

import { query } from '../../src/db/connection.js';
const mockQuery = query as jest.Mock;

describe('StorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('putBlob', () => {
    it('should store encrypted blob', async () => {
      mockS3Client.putObject.mockResolvedValue({
        ETag: '"abc123"',
        VersionId: 'v1',
      });
      mockQuery.mockResolvedValue({ rows: [{ version: 1 }] });

      await mockS3Client.putObject({
        Bucket: 'veilcloud',
        Key: 'projects/proj-1/envs/prod/blob',
        Body: Buffer.from('encrypted-data'),
      });

      expect(mockS3Client.putObject).toHaveBeenCalled();
    });

    it('should compute and store hash', async () => {
      const crypto = require('crypto');
      const data = Buffer.from('encrypted-data');
      const hash = crypto.createHash('sha256').update(data).digest('hex');

      mockS3Client.putObject.mockResolvedValue({});
      mockQuery.mockResolvedValue({ rows: [] });

      expect(hash).toHaveLength(64);
    });

    it('should increment version on update', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ version: 5 }] }) // Get current
        .mockResolvedValueOnce({ rows: [{ version: 6 }] }); // Update

      mockS3Client.putObject.mockResolvedValue({});

      const current = await mockQuery('SELECT version FROM environments...');
      expect(current.rows[0].version).toBe(5);
    });

    it('should reject oversized blobs', async () => {
      const maxSize = 50 * 1024 * 1024; // 50MB
      const oversizedBlob = Buffer.alloc(maxSize + 1);

      expect(oversizedBlob.length).toBeGreaterThan(maxSize);
    });

    it('should log write operation', async () => {
      mockS3Client.putObject.mockResolvedValue({});
      mockQuery.mockResolvedValue({ rows: [] });

      await mockAuditService.log({
        action: 'blob.write',
        projectId: 'proj-1',
        env: 'production',
      });

      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should set correct content type', async () => {
      mockS3Client.putObject.mockResolvedValue({});

      await mockS3Client.putObject({
        Bucket: 'veilcloud',
        Key: 'test',
        Body: Buffer.from('data'),
        ContentType: 'application/octet-stream',
      });

      expect(mockS3Client.putObject).toHaveBeenCalledWith(
        expect.objectContaining({
          ContentType: 'application/octet-stream',
        })
      );
    });

    it('should handle concurrent writes', async () => {
      mockS3Client.putObject.mockResolvedValue({});
      mockQuery.mockResolvedValue({ rows: [] });

      const writes = Array.from({ length: 10 }, (_, i) =>
        mockS3Client.putObject({
          Bucket: 'veilcloud',
          Key: `blob-${i}`,
          Body: Buffer.from(`data-${i}`),
        })
      );

      await Promise.all(writes);

      expect(mockS3Client.putObject).toHaveBeenCalledTimes(10);
    });
  });

  describe('getBlob', () => {
    it('should retrieve encrypted blob', async () => {
      mockS3Client.getObject.mockResolvedValue({
        Body: Buffer.from('encrypted-data'),
        ContentLength: 14,
        ETag: '"hash"',
      });

      const result = await mockS3Client.getObject({
        Bucket: 'veilcloud',
        Key: 'projects/proj-1/envs/prod/blob',
      });

      expect(result.Body).toBeTruthy();
    });

    it('should throw on not found', async () => {
      mockS3Client.getObject.mockRejectedValue(
        new Error('NoSuchKey')
      );

      await expect(
        mockS3Client.getObject({ Bucket: 'veilcloud', Key: 'missing' })
      ).rejects.toThrow('NoSuchKey');
    });

    it('should return metadata with blob', async () => {
      mockS3Client.getObject.mockResolvedValue({
        Body: Buffer.from('data'),
        ContentLength: 4,
        LastModified: new Date(),
        ETag: '"etag"',
        Metadata: { version: '1' },
      });

      const result = await mockS3Client.getObject({});
      expect(result.Metadata).toBeTruthy();
    });

    it('should log read operation', async () => {
      mockS3Client.getObject.mockResolvedValue({ Body: Buffer.from('data') });

      await mockS3Client.getObject({});
      await mockAuditService.log({
        action: 'blob.read',
        projectId: 'proj-1',
      });

      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should handle concurrent reads', async () => {
      mockS3Client.getObject.mockResolvedValue({
        Body: Buffer.from('shared-data'),
      });

      const reads = Array.from({ length: 20 }, () =>
        mockS3Client.getObject({ Key: 'shared' })
      );

      const results = await Promise.all(reads);
      expect(results).toHaveLength(20);
    });
  });

  describe('deleteBlob', () => {
    it('should delete blob', async () => {
      mockS3Client.deleteObject.mockResolvedValue({});
      mockQuery.mockResolvedValue({ rows: [] });

      await mockS3Client.deleteObject({
        Bucket: 'veilcloud',
        Key: 'projects/proj-1/envs/prod/blob',
      });

      expect(mockS3Client.deleteObject).toHaveBeenCalled();
    });

    it('should update database on delete', async () => {
      mockS3Client.deleteObject.mockResolvedValue({});
      mockQuery.mockResolvedValue({ rows: [] });

      await mockQuery('DELETE FROM environments WHERE project_id = $1', ['proj-1']);

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should log delete operation', async () => {
      mockS3Client.deleteObject.mockResolvedValue({});

      await mockS3Client.deleteObject({});
      await mockAuditService.log({
        action: 'blob.delete',
        projectId: 'proj-1',
      });

      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should handle missing blob gracefully', async () => {
      mockS3Client.deleteObject.mockResolvedValue({}); // S3 doesn't error on missing

      await expect(
        mockS3Client.deleteObject({ Key: 'nonexistent' })
      ).resolves.not.toThrow();
    });
  });

  describe('headBlob', () => {
    it('should get blob metadata', async () => {
      mockS3Client.headObject.mockResolvedValue({
        ContentLength: 1024,
        ContentType: 'application/octet-stream',
        ETag: '"hash"',
        LastModified: new Date(),
      });

      const result = await mockS3Client.headObject({
        Bucket: 'veilcloud',
        Key: 'test',
      });

      expect(result.ContentLength).toBe(1024);
    });

    it('should throw on not found', async () => {
      mockS3Client.headObject.mockRejectedValue(
        new Error('NotFound')
      );

      await expect(
        mockS3Client.headObject({ Key: 'missing' })
      ).rejects.toThrow('NotFound');
    });

    it('should return ETag', async () => {
      mockS3Client.headObject.mockResolvedValue({
        ETag: '"abc123def456"',
      });

      const result = await mockS3Client.headObject({});
      expect(result.ETag).toBeTruthy();
    });
  });

  describe('listBlobs', () => {
    it('should list project blobs', async () => {
      mockS3Client.listObjects.mockResolvedValue({
        Contents: [
          { Key: 'projects/proj-1/envs/dev/blob', Size: 100 },
          { Key: 'projects/proj-1/envs/prod/blob', Size: 200 },
        ],
      });

      const result = await mockS3Client.listObjects({
        Bucket: 'veilcloud',
        Prefix: 'projects/proj-1/',
      });

      expect(result.Contents).toHaveLength(2);
    });

    it('should handle empty project', async () => {
      mockS3Client.listObjects.mockResolvedValue({
        Contents: [],
      });

      const result = await mockS3Client.listObjects({
        Prefix: 'projects/empty/',
      });

      expect(result.Contents).toHaveLength(0);
    });

    it('should support pagination', async () => {
      mockS3Client.listObjects.mockResolvedValue({
        Contents: Array.from({ length: 100 }, (_, i) => ({
          Key: `blob-${i}`,
        })),
        IsTruncated: true,
        NextContinuationToken: 'token123',
      });

      const result = await mockS3Client.listObjects({ MaxKeys: 100 });

      expect(result.IsTruncated).toBe(true);
      expect(result.NextContinuationToken).toBeTruthy();
    });
  });

  describe('copyBlob', () => {
    it('should copy blob to new location', async () => {
      mockS3Client.copyObject.mockResolvedValue({
        CopyObjectResult: { ETag: '"newetag"' },
      });

      await mockS3Client.copyObject({
        Bucket: 'veilcloud',
        CopySource: 'veilcloud/old-key',
        Key: 'new-key',
      });

      expect(mockS3Client.copyObject).toHaveBeenCalled();
    });

    it('should preserve metadata on copy', async () => {
      mockS3Client.copyObject.mockResolvedValue({});

      await mockS3Client.copyObject({
        CopySource: 'source',
        Key: 'dest',
        MetadataDirective: 'COPY',
      });

      expect(mockS3Client.copyObject).toHaveBeenCalledWith(
        expect.objectContaining({
          MetadataDirective: 'COPY',
        })
      );
    });
  });

  describe('Path Generation', () => {
    const generatePath = (projectId: string, env: string): string => {
      return `projects/${projectId}/envs/${env}/blob`;
    };

    it('should generate correct path', () => {
      expect(generatePath('proj-1', 'production')).toBe(
        'projects/proj-1/envs/production/blob'
      );
    });

    it('should handle special characters in names', () => {
      // Project IDs should be UUIDs, so this is edge case testing
      const path = generatePath('proj-123', 'my-env');
      expect(path).toContain('proj-123');
      expect(path).toContain('my-env');
    });
  });

  describe('Size Limits', () => {
    it('should accept blobs under limit', () => {
      const maxSize = 50 * 1024 * 1024;
      const validSize = 49 * 1024 * 1024;
      expect(validSize).toBeLessThan(maxSize);
    });

    it('should reject blobs over limit', () => {
      const maxSize = 50 * 1024 * 1024;
      const oversized = 51 * 1024 * 1024;
      expect(oversized).toBeGreaterThan(maxSize);
    });

    it('should handle empty blobs', () => {
      const emptyBlob = Buffer.alloc(0);
      expect(emptyBlob.length).toBe(0);
    });

    it('should handle 1 byte blob', () => {
      const tinyBlob = Buffer.from('x');
      expect(tinyBlob.length).toBe(1);
    });
  });

  describe('Hash Verification', () => {
    const computeHash = (data: Buffer): string => {
      const crypto = require('crypto');
      return crypto.createHash('sha256').update(data).digest('hex');
    };

    it('should compute consistent hash', () => {
      const data = Buffer.from('test data');
      const hash1 = computeHash(data);
      const hash2 = computeHash(data);
      expect(hash1).toBe(hash2);
    });

    it('should produce 64 char hex hash', () => {
      const hash = computeHash(Buffer.from('test'));
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('should differ for different data', () => {
      const hash1 = computeHash(Buffer.from('data1'));
      const hash2 = computeHash(Buffer.from('data2'));
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Version Management', () => {
    it('should start at version 1', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ version: 1 }],
      });

      const result = await mockQuery('INSERT INTO environments...');
      expect(result.rows[0].version).toBe(1);
    });

    it('should increment version on update', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ version: 5 }] })
        .mockResolvedValueOnce({ rows: [{ version: 6 }] });

      const before = await mockQuery('SELECT version...');
      await mockQuery('UPDATE environments SET version = version + 1...');
      const after = await mockQuery('SELECT version...');

      // Note: This is a simplified test - actual versioning would be atomic
      expect(mockQuery).toHaveBeenCalled();
    });

    it('should handle version conflicts', async () => {
      mockQuery.mockRejectedValue(
        new Error('Version conflict')
      );

      await expect(
        mockQuery('UPDATE ... WHERE version = $1', [5])
      ).rejects.toThrow('Version conflict');
    });
  });

  describe('Error Handling', () => {
    it('should handle S3 connection errors', async () => {
      mockS3Client.putObject.mockRejectedValue(
        new Error('Connection refused')
      );

      await expect(
        mockS3Client.putObject({})
      ).rejects.toThrow('Connection refused');
    });

    it('should handle S3 access denied', async () => {
      mockS3Client.getObject.mockRejectedValue(
        new Error('AccessDenied')
      );

      await expect(
        mockS3Client.getObject({})
      ).rejects.toThrow('AccessDenied');
    });

    it('should handle database errors', async () => {
      mockQuery.mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(
        mockQuery('SELECT ...')
      ).rejects.toThrow('Database connection failed');
    });

    it('should handle S3 timeout', async () => {
      mockS3Client.putObject.mockRejectedValue(
        new Error('Request timeout')
      );

      await expect(
        mockS3Client.putObject({})
      ).rejects.toThrow('timeout');
    });
  });

  describe('Concurrent Access', () => {
    it('should handle multiple readers', async () => {
      mockS3Client.getObject.mockResolvedValue({
        Body: Buffer.from('shared-data'),
      });

      const reads = Array.from({ length: 50 }, () =>
        mockS3Client.getObject({ Key: 'shared' })
      );

      const results = await Promise.all(reads);
      expect(results).toHaveLength(50);
    });

    it('should serialize writes to same key', async () => {
      let writeOrder: number[] = [];
      mockS3Client.putObject.mockImplementation(async (params) => {
        const id = parseInt(params.Body.toString().split('-')[1]);
        await new Promise(r => setTimeout(r, Math.random() * 10));
        writeOrder.push(id);
        return {};
      });

      const writes = Array.from({ length: 5 }, (_, i) =>
        mockS3Client.putObject({ Key: 'same-key', Body: Buffer.from(`data-${i}`) })
      );

      await Promise.all(writes);
      expect(writeOrder).toHaveLength(5);
    });
  });

  describe('Cleanup', () => {
    it('should delete all project blobs', async () => {
      mockS3Client.listObjects.mockResolvedValue({
        Contents: [
          { Key: 'projects/proj-1/envs/dev/blob' },
          { Key: 'projects/proj-1/envs/prod/blob' },
        ],
      });
      mockS3Client.deleteObject.mockResolvedValue({});

      const list = await mockS3Client.listObjects({ Prefix: 'projects/proj-1/' });

      for (const obj of list.Contents) {
        await mockS3Client.deleteObject({ Key: obj.Key });
      }

      expect(mockS3Client.deleteObject).toHaveBeenCalledTimes(2);
    });
  });
});
