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
