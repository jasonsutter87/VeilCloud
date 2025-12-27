-- VeilCloud Database Schema
-- Zero-knowledge cloud storage platform

-- ============================================================================
-- Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- Users
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  veilsign_credential_id VARCHAR(255),
  display_name VARCHAR(255),
  avatar_url VARCHAR(512),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_veilsign ON users(veilsign_credential_id);

-- ============================================================================
-- Projects
-- ============================================================================

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_id, name)
);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);

-- ============================================================================
-- Environments
-- ============================================================================

CREATE TABLE IF NOT EXISTS environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  blob_key VARCHAR(512) NOT NULL,
  blob_hash VARCHAR(64),
  blob_size BIGINT DEFAULT 0,
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id);

-- ============================================================================
-- Teams
-- ============================================================================

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  veilkey_group_id VARCHAR(255),
  threshold INT NOT NULL DEFAULT 2,
  total_shares INT NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_id);
CREATE INDEX IF NOT EXISTS idx_teams_veilkey ON teams(veilkey_group_id);

-- ============================================================================
-- Team Members
-- ============================================================================

CREATE TABLE IF NOT EXISTS team_members (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_index INT NOT NULL,
  role VARCHAR(50) DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

-- ============================================================================
-- Project Shares
-- ============================================================================

CREATE TABLE IF NOT EXISTS project_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  permissions JSONB DEFAULT '["project:read"]',
  shared_by UUID REFERENCES users(id),
  shared_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_project_shares_project ON project_shares(project_id);
CREATE INDEX IF NOT EXISTS idx_project_shares_team ON project_shares(team_id);

-- ============================================================================
-- API Keys
-- ============================================================================

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(12) NOT NULL, -- First 8 chars for identification
  name VARCHAR(255),
  permissions JSONB DEFAULT '["project:read"]',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);

-- ============================================================================
-- Audit Log (local cache, main log in VeilChain)
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  veilchain_entry_id VARCHAR(255),
  action VARCHAR(50) NOT NULL,
  user_id UUID REFERENCES users(id),
  project_id UUID REFERENCES projects(id),
  team_id UUID REFERENCES teams(id),
  ip_address INET,
  user_agent TEXT,
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

-- ============================================================================
-- Updated At Trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables with updated_at
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['users', 'projects', 'environments', 'teams'])
  LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trigger_update_updated_at ON %I;
      CREATE TRIGGER trigger_update_updated_at
      BEFORE UPDATE ON %I
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    ', t, t);
  END LOOP;
END;
$$;

-- ============================================================================
-- Helpful Views
-- ============================================================================

CREATE OR REPLACE VIEW user_projects AS
SELECT
  p.*,
  u.email as owner_email,
  u.display_name as owner_name,
  (SELECT COUNT(*) FROM environments e WHERE e.project_id = p.id) as env_count
FROM projects p
JOIN users u ON p.owner_id = u.id
WHERE p.is_archived = false;

CREATE OR REPLACE VIEW team_with_members AS
SELECT
  t.*,
  u.email as owner_email,
  (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) as member_count,
  (SELECT json_agg(json_build_object(
    'user_id', tm.user_id,
    'email', mu.email,
    'role', tm.role,
    'share_index', tm.share_index
  )) FROM team_members tm
  JOIN users mu ON tm.user_id = mu.id
  WHERE tm.team_id = t.id) as members
FROM teams t
JOIN users u ON t.owner_id = u.id;

-- ============================================================================
-- Credentials (VeilSign integration)
-- ============================================================================

CREATE TABLE IF NOT EXISTS credentials (
  id VARCHAR(255) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  permissions JSONB NOT NULL DEFAULT '[]',
  one_time BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_credentials_project ON credentials(project_id);
CREATE INDEX IF NOT EXISTS idx_credentials_expires ON credentials(expires_at);

-- ============================================================================
-- Credential Revocations
-- ============================================================================

CREATE TABLE IF NOT EXISTS credential_revocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id VARCHAR(255) NOT NULL,
  revoked_by UUID REFERENCES users(id),
  reason TEXT,
  revoked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credential_revocations_cred ON credential_revocations(credential_id);

-- ============================================================================
-- Decryption Requests (VeilKey threshold operations)
-- ============================================================================

CREATE TABLE IF NOT EXISTS decryption_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES users(id),
  ciphertext_hash VARCHAR(64) NOT NULL,
  shares_collected INT DEFAULT 0,
  shares_needed INT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_decryption_requests_team ON decryption_requests(team_id);
CREATE INDEX IF NOT EXISTS idx_decryption_requests_status ON decryption_requests(status);

-- ============================================================================
-- Decryption Shares
-- ============================================================================

CREATE TABLE IF NOT EXISTS decryption_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES decryption_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  share_index INT NOT NULL,
  partial_decryption TEXT NOT NULL,
  proof TEXT NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(request_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_decryption_shares_request ON decryption_shares(request_id);

-- ============================================================================
-- Audit Snapshots (for consistency proofs)
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  root_hash VARCHAR(128) NOT NULL,
  tree_size VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_snapshots_project ON audit_snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_snapshots_created ON audit_snapshots(created_at DESC);

-- ============================================================================
-- IP Reputation (security hardening)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ip_reputation (
  ip INET PRIMARY KEY,
  score INT DEFAULT 50 CHECK (score >= 0 AND score <= 100),
  request_count BIGINT DEFAULT 0,
  failed_attempts INT DEFAULT 0,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  blocked BOOLEAN DEFAULT false,
  blocked_reason TEXT,
  blocked_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ip_reputation_blocked ON ip_reputation(blocked) WHERE blocked = true;
CREATE INDEX IF NOT EXISTS idx_ip_reputation_score ON ip_reputation(score) WHERE score < 50;

-- ============================================================================
-- Security Events (for monitoring)
-- ============================================================================

CREATE TABLE IF NOT EXISTS security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(50) NOT NULL,
  ip INET,
  user_id UUID REFERENCES users(id),
  severity VARCHAR(20) DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_ip ON security_events(ip);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at DESC);
