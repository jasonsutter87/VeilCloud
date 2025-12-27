/**
 * API Middleware
 */

export {
  authenticate,
  optionalAuthenticate,
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  authPlugin,
  type AuthenticatedUser,
} from './auth.js';

export {
  securityPlugin,
  validateRequestBody,
  csrfProtection,
  requireSecurityHeaders,
} from './security.js';
