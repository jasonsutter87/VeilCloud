/**
 * Error Handling Integration Tests
 */

// Mock error types
class VeilCloudError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'VeilCloudError';
  }

  toJSON() {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

class ValidationError extends VeilCloudError {
  constructor(message: string, public field?: string, public value?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, { field, value });
    this.name = 'ValidationError';
  }
}

class AuthenticationError extends VeilCloudError {
  constructor(message: string = 'Authentication required') {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

class AuthorizationError extends VeilCloudError {
  constructor(message: string = 'Permission denied') {
    super(message, 'FORBIDDEN', 403);
    this.name = 'AuthorizationError';
  }
}

class NotFoundError extends VeilCloudError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404, { resource, id });
    this.name = 'NotFoundError';
  }
}

class ConflictError extends VeilCloudError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409);
    this.name = 'ConflictError';
  }
}

class RateLimitError extends VeilCloudError {
  constructor(public retryAfter: number) {
    super('Rate limit exceeded', 'RATE_LIMITED', 429, { retryAfter });
    this.name = 'RateLimitError';
  }
}

class ServiceUnavailableError extends VeilCloudError {
  constructor(service: string) {
    super(`Service unavailable: ${service}`, 'SERVICE_UNAVAILABLE', 503, { service });
    this.name = 'ServiceUnavailableError';
  }
}

// Mock error handler
class ErrorHandler {
  private handlers: Map<string, (error: VeilCloudError) => void> = new Map();
  private logged: VeilCloudError[] = [];

  register(errorType: string, handler: (error: VeilCloudError) => void): void {
    this.handlers.set(errorType, handler);
  }

  handle(error: Error): { statusCode: number; body: Record<string, unknown> } {
    if (error instanceof VeilCloudError) {
      this.logged.push(error);
      const handler = this.handlers.get(error.name);
      if (handler) {
        handler(error);
      }
      return {
        statusCode: error.statusCode,
        body: error.toJSON(),
      };
    }

    // Unknown error
    return {
      statusCode: 500,
      body: {
        error: 'InternalError',
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    };
  }

  getLoggedErrors(): VeilCloudError[] {
    return [...this.logged];
  }

  clearLogs(): void {
    this.logged = [];
  }
}

describe('Error Handling', () => {
  let handler: ErrorHandler;

  beforeEach(() => {
    handler = new ErrorHandler();
  });

  describe('VeilCloudError', () => {
    it('should create error with message', () => {
      const error = new VeilCloudError('Test error', 'TEST', 400);
      expect(error.message).toBe('Test error');
    });

    it('should include error code', () => {
      const error = new VeilCloudError('Test', 'MY_CODE', 400);
      expect(error.code).toBe('MY_CODE');
    });

    it('should include status code', () => {
      const error = new VeilCloudError('Test', 'CODE', 404);
      expect(error.statusCode).toBe(404);
    });

    it('should include details', () => {
      const error = new VeilCloudError('Test', 'CODE', 400, { key: 'value' });
      expect(error.details?.key).toBe('value');
    });

    it('should serialize to JSON', () => {
      const error = new VeilCloudError('Test', 'CODE', 400);
      const json = error.toJSON();
      expect(json.error).toBe('VeilCloudError');
      expect(json.message).toBe('Test');
    });

    it('should default to 500 status', () => {
      const error = new VeilCloudError('Test', 'CODE');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('ValidationError', () => {
    it('should create with field info', () => {
      const error = new ValidationError('Invalid email', 'email', 'not-an-email');
      expect(error.field).toBe('email');
      expect(error.value).toBe('not-an-email');
    });

    it('should have 400 status', () => {
      const error = new ValidationError('Invalid input');
      expect(error.statusCode).toBe(400);
    });

    it('should have VALIDATION_ERROR code', () => {
      const error = new ValidationError('Test');
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    it('should include field in details', () => {
      const error = new ValidationError('Invalid', 'username');
      expect(error.details?.field).toBe('username');
    });
  });

  describe('AuthenticationError', () => {
    it('should have default message', () => {
      const error = new AuthenticationError();
      expect(error.message).toBe('Authentication required');
    });

    it('should have 401 status', () => {
      const error = new AuthenticationError();
      expect(error.statusCode).toBe(401);
    });

    it('should allow custom message', () => {
      const error = new AuthenticationError('Token expired');
      expect(error.message).toBe('Token expired');
    });
  });

  describe('AuthorizationError', () => {
    it('should have default message', () => {
      const error = new AuthorizationError();
      expect(error.message).toBe('Permission denied');
    });

    it('should have 403 status', () => {
      const error = new AuthorizationError();
      expect(error.statusCode).toBe(403);
    });

    it('should allow custom message', () => {
      const error = new AuthorizationError('Cannot access project');
      expect(error.message).toBe('Cannot access project');
    });
  });

  describe('NotFoundError', () => {
    it('should include resource type', () => {
      const error = new NotFoundError('Project', 'proj-123');
      expect(error.message).toContain('Project');
    });

    it('should include resource ID', () => {
      const error = new NotFoundError('Project', 'proj-123');
      expect(error.message).toContain('proj-123');
    });

    it('should have 404 status', () => {
      const error = new NotFoundError('User', 'user-1');
      expect(error.statusCode).toBe(404);
    });

    it('should include details', () => {
      const error = new NotFoundError('Secret', 'sec-1');
      expect(error.details?.resource).toBe('Secret');
      expect(error.details?.id).toBe('sec-1');
    });
  });

  describe('ConflictError', () => {
    it('should have 409 status', () => {
      const error = new ConflictError('Resource already exists');
      expect(error.statusCode).toBe(409);
    });

    it('should have CONFLICT code', () => {
      const error = new ConflictError('Duplicate');
      expect(error.code).toBe('CONFLICT');
    });
  });

  describe('RateLimitError', () => {
    it('should have 429 status', () => {
      const error = new RateLimitError(60);
      expect(error.statusCode).toBe(429);
    });

    it('should include retry-after', () => {
      const error = new RateLimitError(120);
      expect(error.retryAfter).toBe(120);
    });

    it('should include in details', () => {
      const error = new RateLimitError(30);
      expect(error.details?.retryAfter).toBe(30);
    });
  });

  describe('ServiceUnavailableError', () => {
    it('should have 503 status', () => {
      const error = new ServiceUnavailableError('VeilKey');
      expect(error.statusCode).toBe(503);
    });

    it('should include service name', () => {
      const error = new ServiceUnavailableError('VeilChain');
      expect(error.message).toContain('VeilChain');
    });
  });

  describe('ErrorHandler', () => {
    it('should handle VeilCloud errors', () => {
      const error = new ValidationError('Invalid input');
      const result = handler.handle(error);

      expect(result.statusCode).toBe(400);
      expect(result.body.code).toBe('VALIDATION_ERROR');
    });

    it('should handle unknown errors', () => {
      const error = new Error('Something went wrong');
      const result = handler.handle(error);

      expect(result.statusCode).toBe(500);
      expect(result.body.code).toBe('INTERNAL_ERROR');
    });

    it('should log errors', () => {
      const error = new NotFoundError('Project', 'p-1');
      handler.handle(error);

      const logged = handler.getLoggedErrors();
      expect(logged).toHaveLength(1);
      expect(logged[0]).toBe(error);
    });

    it('should call registered handlers', () => {
      const callback = jest.fn();
      handler.register('ValidationError', callback);

      const error = new ValidationError('Test');
      handler.handle(error);

      expect(callback).toHaveBeenCalledWith(error);
    });

    it('should clear logs', () => {
      handler.handle(new ValidationError('Test'));
      handler.clearLogs();

      expect(handler.getLoggedErrors()).toHaveLength(0);
    });
  });

  describe('Error handling scenarios', () => {
    it('should handle missing required field', () => {
      const error = new ValidationError('name is required', 'name', undefined);
      const result = handler.handle(error);

      expect(result.statusCode).toBe(400);
      expect(result.body.details).toEqual({ field: 'name', value: undefined });
    });

    it('should handle invalid format', () => {
      const error = new ValidationError('Invalid email format', 'email', 'not-email');
      const result = handler.handle(error);

      expect(result.body.message).toContain('Invalid email');
    });

    it('should handle expired token', () => {
      const error = new AuthenticationError('Token has expired');
      const result = handler.handle(error);

      expect(result.statusCode).toBe(401);
    });

    it('should handle insufficient permissions', () => {
      const error = new AuthorizationError('Write access required');
      const result = handler.handle(error);

      expect(result.statusCode).toBe(403);
    });

    it('should handle resource not found', () => {
      const error = new NotFoundError('Environment', 'production');
      const result = handler.handle(error);

      expect(result.statusCode).toBe(404);
    });

    it('should handle duplicate resource', () => {
      const error = new ConflictError('Project name already exists');
      const result = handler.handle(error);

      expect(result.statusCode).toBe(409);
    });

    it('should handle rate limiting', () => {
      const error = new RateLimitError(60);
      const result = handler.handle(error);

      expect(result.statusCode).toBe(429);
      expect(result.body.details).toEqual({ retryAfter: 60 });
    });

    it('should handle service outage', () => {
      const error = new ServiceUnavailableError('VeilSign');
      const result = handler.handle(error);

      expect(result.statusCode).toBe(503);
    });
  });

  describe('Error chaining', () => {
    it('should preserve original error', () => {
      const original = new Error('Database connection failed');
      const wrapped = new ServiceUnavailableError('Database');
      (wrapped as any).cause = original;

      expect((wrapped as any).cause.message).toBe('Database connection failed');
    });

    it('should handle nested errors', () => {
      try {
        try {
          throw new Error('Inner error');
        } catch (inner) {
          throw new VeilCloudError('Outer error', 'WRAPPED', 500, { inner: (inner as Error).message });
        }
      } catch (error) {
        const result = handler.handle(error as Error);
        expect(result.body.details).toEqual({ inner: 'Inner error' });
      }
    });
  });

  describe('Error serialization', () => {
    it('should serialize all error types', () => {
      const errors = [
        new ValidationError('Invalid'),
        new AuthenticationError(),
        new AuthorizationError(),
        new NotFoundError('Project', 'p-1'),
        new ConflictError('Conflict'),
        new RateLimitError(60),
        new ServiceUnavailableError('Service'),
      ];

      for (const error of errors) {
        const json = error.toJSON();
        expect(json.error).toBeDefined();
        expect(json.code).toBeDefined();
        expect(json.message).toBeDefined();
        expect(json.statusCode).toBeDefined();
      }
    });

    it('should be JSON stringifiable', () => {
      const error = new ValidationError('Test', 'field', 'value');
      const json = JSON.stringify(error.toJSON());
      const parsed = JSON.parse(json);

      expect(parsed.error).toBe('ValidationError');
    });
  });

  describe('Error recovery', () => {
    it('should allow retry for rate limit', () => {
      const error = new RateLimitError(30);
      expect(error.retryAfter).toBe(30);
      // Client should wait 30 seconds before retry
    });

    it('should allow retry for service unavailable', () => {
      const error = new ServiceUnavailableError('VeilKey');
      expect(error.statusCode).toBe(503);
      // Client should implement exponential backoff
    });

    it('should not retry auth errors', () => {
      const error = new AuthenticationError();
      expect(error.statusCode).toBe(401);
      // Client should re-authenticate, not retry
    });

    it('should not retry validation errors', () => {
      const error = new ValidationError('Invalid input');
      expect(error.statusCode).toBe(400);
      // Client should fix input, not retry
    });
  });

  describe('concurrent error handling', () => {
    it('should handle multiple errors', async () => {
      const errors = [
        new ValidationError('Error 1'),
        new NotFoundError('Project', 'p-1'),
        new AuthenticationError(),
      ];

      const results = await Promise.all(
        errors.map(e => Promise.resolve(handler.handle(e)))
      );

      expect(results[0]!.statusCode).toBe(400);
      expect(results[1]!.statusCode).toBe(404);
      expect(results[2]!.statusCode).toBe(401);
    });

    it('should log all errors', async () => {
      const errors = Array.from({ length: 10 }, (_, i) =>
        new ValidationError(`Error ${i}`)
      );

      await Promise.all(errors.map(e => Promise.resolve(handler.handle(e))));

      expect(handler.getLoggedErrors()).toHaveLength(10);
    });
  });
});
