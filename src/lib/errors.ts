/**
 * VeilCloud Error Types
 * Structured error handling
 */

export class VeilCloudError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    statusCode: number = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'VeilCloudError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

// ============================================================================
// Authentication Errors (401)
// ============================================================================

export class UnauthorizedError extends VeilCloudError {
  constructor(message: string = 'Authentication required', details?: Record<string, unknown>) {
    super('UNAUTHORIZED', message, 401, details);
    this.name = 'UnauthorizedError';
  }
}

export class InvalidCredentialError extends VeilCloudError {
  constructor(message: string = 'Invalid or expired credential', details?: Record<string, unknown>) {
    super('INVALID_CREDENTIAL', message, 401, details);
    this.name = 'InvalidCredentialError';
  }
}

// ============================================================================
// Authorization Errors (403)
// ============================================================================

export class ForbiddenError extends VeilCloudError {
  constructor(message: string = 'Access denied', details?: Record<string, unknown>) {
    super('FORBIDDEN', message, 403, details);
    this.name = 'ForbiddenError';
  }
}

export class InsufficientPermissionError extends VeilCloudError {
  constructor(
    requiredPermission: string,
    details?: Record<string, unknown>
  ) {
    super(
      'INSUFFICIENT_PERMISSION',
      `Missing required permission: ${requiredPermission}`,
      403,
      { requiredPermission, ...details }
    );
    this.name = 'InsufficientPermissionError';
  }
}

// ============================================================================
// Not Found Errors (404)
// ============================================================================

export class NotFoundError extends VeilCloudError {
  constructor(resource: string, id?: string, details?: Record<string, unknown>) {
    const message = id ? `${resource} not found: ${id}` : `${resource} not found`;
    super('NOT_FOUND', message, 404, { resource, id, ...details });
    this.name = 'NotFoundError';
  }
}

export class ProjectNotFoundError extends NotFoundError {
  constructor(projectId: string) {
    super('Project', projectId);
    this.name = 'ProjectNotFoundError';
  }
}

export class TeamNotFoundError extends NotFoundError {
  constructor(teamId: string) {
    super('Team', teamId);
    this.name = 'TeamNotFoundError';
  }
}

export class BlobNotFoundError extends NotFoundError {
  constructor(blobKey: string) {
    super('Blob', blobKey);
    this.name = 'BlobNotFoundError';
  }
}

// ============================================================================
// Validation Errors (400)
// ============================================================================

export class ValidationError extends VeilCloudError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class InvalidInputError extends VeilCloudError {
  constructor(field: string, reason: string, details?: Record<string, unknown>) {
    super('INVALID_INPUT', `Invalid ${field}: ${reason}`, 400, { field, reason, ...details });
    this.name = 'InvalidInputError';
  }
}

// ============================================================================
// Conflict Errors (409)
// ============================================================================

export class ConflictError extends VeilCloudError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFLICT', message, 409, details);
    this.name = 'ConflictError';
  }
}

export class DuplicateError extends VeilCloudError {
  constructor(resource: string, field: string, details?: Record<string, unknown>) {
    super('DUPLICATE', `${resource} with this ${field} already exists`, 409, {
      resource,
      field,
      ...details,
    });
    this.name = 'DuplicateError';
  }
}

// ============================================================================
// Rate Limit Errors (429)
// ============================================================================

export class RateLimitError extends VeilCloudError {
  constructor(retryAfter?: number, details?: Record<string, unknown>) {
    super('RATE_LIMITED', 'Too many requests', 429, { retryAfter, ...details });
    this.name = 'RateLimitError';
  }
}

// ============================================================================
// Integration Errors (502/503)
// ============================================================================

export class IntegrationError extends VeilCloudError {
  constructor(service: string, message: string, details?: Record<string, unknown>) {
    super('INTEGRATION_ERROR', `${service}: ${message}`, 502, { service, ...details });
    this.name = 'IntegrationError';
  }
}

export class VeilKeyError extends IntegrationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VeilKey', message, details);
    this.name = 'VeilKeyError';
  }
}

export class VeilChainError extends IntegrationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VeilChain', message, details);
    this.name = 'VeilChainError';
  }
}

export class VeilSignError extends IntegrationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VeilSign', message, details);
    this.name = 'VeilSignError';
  }
}

export class StorageError extends IntegrationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('Storage', message, details);
    this.name = 'StorageError';
  }
}

// ============================================================================
// Threshold Crypto Errors
// ============================================================================

export class ThresholdNotMetError extends VeilCloudError {
  constructor(required: number, provided: number, details?: Record<string, unknown>) {
    super(
      'THRESHOLD_NOT_MET',
      `Threshold not met: need ${required} shares, got ${provided}`,
      400,
      { required, provided, ...details }
    );
    this.name = 'ThresholdNotMetError';
  }
}
