/**
 * VeilSuite Integrations
 * Unified exports for VeilKey, VeilChain, and VeilSign clients
 */

// VeilSign - Privacy-preserving credentials
export {
  VeilSignClient,
  getVeilSignClient,
  initVeilSign,
  type VeilSignCredential,
  type VeilSignAuthority,
  type BlindedMessage,
  type IssueCredentialRequest,
  type VerifyCredentialRequest,
  type VerifyCredentialResponse,
} from './veilsign.js';

// VeilKey - Threshold cryptography
export {
  VeilKeyClient,
  getVeilKeyClient,
  type Algorithm,
  type KeyGroup,
  type Share,
  type PartialSignature,
  type PartialDecryption,
  type CreateTeamKeyRequest,
  type CreateTeamKeyResponse,
} from './veilkey.js';

// VeilChain - Immutable audit logging
export {
  VeilChainClient,
  getVeilChainClient,
  initVeilChain,
  type LedgerInfo,
  type AppendResult,
  type AuditLogRequest,
} from './veilchain.js';
