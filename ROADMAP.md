# VeilCloud — Development Roadmap

## Vision
Build a production-grade, zero-knowledge cloud storage platform that integrates with the VeilSuite ecosystem (VeilKey, VeilChain, VeilSign) to provide encrypted storage with threshold cryptography, immutable audit, and privacy-preserving access control.

**Target**: 1500+ tests covering unit, integration, e2e, smoke, security red-team, and Playwright user flows.

---

## Phase 1: Core Infrastructure ✅ COMPLETE

### 1.1 Project Scaffold
- [x] package.json with dependencies
- [x] TypeScript configuration (strict mode)
- [x] Project structure (src/, tests/, etc.)
- [x] Git repository setup

### 1.2 Type System
- [x] Core types (User, Project, Team, Environment)
- [x] Storage types (EncryptedBlob, StorageRequest/Response)
- [x] Audit types (AuditEntry, AuditAction, MerkleProof)
- [x] Access types (Permission, AccessCredential)
- [x] Configuration types

### 1.3 Error Handling
- [x] Base VeilCloudError class
- [x] Authentication errors (401)
- [x] Authorization errors (403)
- [x] Not found errors (404)
- [x] Validation errors (400)
- [x] Integration errors (502/503)

### 1.4 API Server
- [x] Fastify server setup
- [x] CORS, Helmet, rate limiting
- [x] Health check endpoints (/health, /health/ready)
- [x] Error handler middleware

### 1.5 VeilSuite Integration Wrappers
- [x] VeilSign client (credential issuance/verification)
- [x] VeilKey client (threshold crypto operations)
- [x] VeilChain client (audit logging with proofs)

### 1.6 Storage Service
- [x] S3/MinIO client configuration
- [x] Blob put/get/delete operations
- [x] Project-based blob listing
- [x] Metadata storage in S3 headers

### 1.7 Storage API Routes
- [x] PUT /v1/storage/:projectId/:envName
- [x] GET /v1/storage/:projectId/:envName
- [x] DELETE /v1/storage/:projectId/:envName
- [x] GET /v1/storage/:projectId (list)
- [x] HEAD /v1/storage/:projectId/:envName

### 1.8 SDK Client
- [x] VeilCloudClient class
- [x] Storage, Projects, Teams, Audit sub-clients
- [x] Retry logic with exponential backoff
- [x] Error handling

### Deliverables
- [x] Working server with health checks
- [x] Storage API functional (needs auth)
- [x] SDK client ready for use
- [x] README documentation

---

## Phase 2: Database Layer

### 2.1 PostgreSQL Setup
- [ ] Database connection pool (pg)
- [ ] Connection health checks
- [ ] Graceful shutdown handling

### 2.2 Schema Design
```sql
-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  veilsign_credential_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Projects
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_id, name)
);

-- Environments
CREATE TABLE environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  blob_key VARCHAR(512) NOT NULL,
  blob_hash VARCHAR(64),
  blob_size BIGINT DEFAULT 0,
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, name)
);

-- Teams
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  veilkey_group_id VARCHAR(255),
  threshold INT NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Team Members
CREATE TABLE team_members (
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  share_index INT NOT NULL,
  role VARCHAR(50) DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

-- Project Sharing
CREATE TABLE project_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  permissions JSONB DEFAULT '["read"]',
  shared_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, team_id)
);

-- API Keys (for service-to-service)
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  permissions JSONB DEFAULT '["read"]',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_projects_owner ON projects(owner_id);
CREATE INDEX idx_environments_project ON environments(project_id);
CREATE INDEX idx_team_members_user ON team_members(user_id);
CREATE INDEX idx_project_shares_team ON project_shares(team_id);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
```

### 2.3 Repository Layer
- [ ] UserRepository (CRUD)
- [ ] ProjectRepository (CRUD + sharing)
- [ ] TeamRepository (CRUD + members)
- [ ] EnvironmentRepository (CRUD)
- [ ] ApiKeyRepository (CRUD)

### 2.4 Migrations
- [ ] Migration runner
- [ ] Up/down migration support
- [ ] Version tracking

### Deliverables
- [ ] Database schema deployed
- [ ] All repositories with CRUD operations
- [ ] Migration system working
- [ ] Connection pooling optimized

---

## Phase 3: Authentication & Authorization

### 3.1 VeilSign Auth Middleware
- [ ] Credential extraction from headers
- [ ] Credential verification via VeilSign
- [ ] User lookup/creation from credential
- [ ] Request context injection

### 3.2 API Key Authentication
- [ ] API key generation (bcrypt hashed)
- [ ] API key validation middleware
- [ ] Key rotation support
- [ ] Usage tracking

### 3.3 Permission System
- [ ] Permission definitions
  - `project:read` - Read project data
  - `project:write` - Write project data
  - `project:delete` - Delete project
  - `project:share` - Share project with teams
  - `team:manage` - Manage team members
  - `audit:read` - Read audit logs
- [ ] Permission checking middleware
- [ ] Project-level permission inheritance
- [ ] Team-based permission grants

### 3.4 Session Management
- [ ] Stateless credential validation
- [ ] Credential caching (Redis)
- [ ] Credential expiration handling

### Deliverables
- [ ] All routes protected by auth
- [ ] VeilSign integration working
- [ ] API key auth as fallback
- [ ] Permission checks on all operations

---

## Phase 4: Complete API Routes

### 4.1 User Routes
```
POST   /v1/auth/register       # Create account
POST   /v1/auth/login          # Get credential
POST   /v1/auth/refresh        # Refresh credential
GET    /v1/users/me            # Get current user
PATCH  /v1/users/me            # Update profile
DELETE /v1/users/me            # Delete account
```

### 4.2 Project Routes
```
POST   /v1/projects            # Create project
GET    /v1/projects            # List user's projects
GET    /v1/projects/:id        # Get project
PATCH  /v1/projects/:id        # Update project
DELETE /v1/projects/:id        # Delete project
POST   /v1/projects/:id/share  # Share with team
DELETE /v1/projects/:id/share/:teamId  # Unshare
```

### 4.3 Environment Routes
```
POST   /v1/projects/:id/envs           # Create environment
GET    /v1/projects/:id/envs           # List environments
GET    /v1/projects/:id/envs/:name     # Get environment
DELETE /v1/projects/:id/envs/:name     # Delete environment
POST   /v1/projects/:id/envs/:name/clone  # Clone environment
```

### 4.4 Team Routes
```
POST   /v1/teams               # Create team (generates VeilKey group)
GET    /v1/teams               # List user's teams
GET    /v1/teams/:id           # Get team
PATCH  /v1/teams/:id           # Update team
DELETE /v1/teams/:id           # Delete team
POST   /v1/teams/:id/members   # Add member (distribute share)
DELETE /v1/teams/:id/members/:userId  # Remove member
POST   /v1/teams/:id/decrypt   # Submit partial decryption
```

### 4.5 Audit Routes
```
GET    /v1/audit/:projectId              # Get audit trail
GET    /v1/audit/:projectId/proof/:id    # Get Merkle proof
POST   /v1/audit/verify                  # Verify proof
GET    /v1/audit/:projectId/export       # Export audit trail
```

### 4.6 Access Routes
```
POST   /v1/access/issue        # Issue credential
POST   /v1/access/verify       # Verify credential
POST   /v1/access/revoke       # Revoke credential
GET    /v1/access/permissions  # List available permissions
```

### 4.7 API Key Routes
```
POST   /v1/api-keys            # Create API key
GET    /v1/api-keys            # List API keys
DELETE /v1/api-keys/:id        # Revoke API key
POST   /v1/api-keys/:id/rotate # Rotate API key
```

### Deliverables
- [ ] All routes implemented
- [ ] Input validation (JSON Schema)
- [ ] Consistent error responses
- [ ] OpenAPI 3.0 specification

---

## Phase 5: VeilSuite Deep Integration

### 5.1 VeilKey Team Crypto
- [ ] Team key generation on team creation
- [ ] Share distribution to members
- [ ] Partial decryption collection
- [ ] Full decryption when threshold met
- [ ] Key refresh (proactive security)

### 5.2 VeilChain Audit Logging
- [ ] Auto-log on all mutations
- [ ] Log categories:
  - `blob.*` (read, write, delete)
  - `project.*` (create, update, delete, share)
  - `team.*` (create, join, leave, decrypt)
  - `auth.*` (login, logout, credential.issue)
- [ ] Proof retrieval
- [ ] Offline verification support

### 5.3 VeilSign Access Control
- [ ] Credential issuance on login
- [ ] Permission embedding in credentials
- [ ] Credential verification on every request
- [ ] Nullifier tracking (prevent replay)
- [ ] Credential revocation

### 5.4 Cross-Service Communication
- [ ] Service-to-service authentication
- [ ] Health checks for all integrations
- [ ] Graceful degradation when services unavailable
- [ ] Circuit breaker pattern

### Deliverables
- [ ] Full VeilKey threshold workflow
- [ ] Complete audit trail
- [ ] VeilSign-based auth working
- [ ] Resilient service communication

---

## Phase 6: Security Hardening

### 6.1 Input Validation
- [ ] JSON Schema validation on all inputs
- [ ] Size limits (blob max size configurable)
- [ ] Content type validation
- [ ] Path traversal prevention
- [ ] SQL injection prevention (parameterized queries)

### 6.2 Rate Limiting
- [ ] Per-user rate limits
- [ ] Per-IP rate limits
- [ ] Endpoint-specific limits
- [ ] Tiered limits by plan:
  ```
  Free:       100 req/min,   1,000/day
  Pro:        1,000 req/min, 50,000/day
  Team:       5,000 req/min, unlimited
  Enterprise: Custom
  ```

### 6.3 Encryption
- [ ] TLS 1.3 only
- [ ] Strong cipher suites
- [ ] Certificate management
- [ ] Encryption at rest (S3 SSE)

### 6.4 Security Headers
- [ ] Content-Security-Policy
- [ ] X-Frame-Options
- [ ] X-Content-Type-Options
- [ ] Strict-Transport-Security
- [ ] Referrer-Policy

### 6.5 Audit & Compliance
- [ ] Request logging (sanitized)
- [ ] Access logging
- [ ] Error logging
- [ ] PII redaction in logs
- [ ] Log retention policy

### 6.6 Secret Management
- [ ] No secrets in code
- [ ] Environment variable validation
- [ ] Secret rotation procedures
- [ ] HSM integration (optional)

### Deliverables
- [ ] OWASP Top 10 addressed
- [ ] Security headers configured
- [ ] Rate limiting active
- [ ] Audit logs complete

---

## Phase 7: Testing (1500+ Tests)

### 7.1 Unit Tests (Target: 600+)
```
tests/unit/
├── lib/
│   ├── config.test.ts         (~20 tests)
│   ├── errors.test.ts         (~50 tests)
│   └── crypto.test.ts         (~30 tests)
├── services/
│   ├── storage.test.ts        (~80 tests)
│   ├── user.test.ts           (~60 tests)
│   ├── project.test.ts        (~70 tests)
│   ├── team.test.ts           (~80 tests)
│   ├── audit.test.ts          (~50 tests)
│   └── access.test.ts         (~60 tests)
├── integrations/
│   ├── veilsign.test.ts       (~40 tests)
│   ├── veilkey.test.ts        (~50 tests)
│   └── veilchain.test.ts      (~40 tests)
└── sdk/
    └── client.test.ts         (~50 tests)
```

### 7.2 Integration Tests (Target: 400+)
```
tests/integration/
├── api/
│   ├── storage.test.ts        (~60 tests)
│   ├── projects.test.ts       (~50 tests)
│   ├── teams.test.ts          (~60 tests)
│   ├── audit.test.ts          (~40 tests)
│   ├── access.test.ts         (~50 tests)
│   └── auth.test.ts           (~40 tests)
├── database/
│   ├── migrations.test.ts     (~20 tests)
│   ├── repositories.test.ts   (~60 tests)
│   └── transactions.test.ts   (~30 tests)
└── services/
    └── workflows.test.ts      (~50 tests)
```

### 7.3 End-to-End Tests (Target: 200+)
```
tests/e2e/
├── user-journeys/
│   ├── registration.test.ts   (~15 tests)
│   ├── project-crud.test.ts   (~20 tests)
│   ├── team-sharing.test.ts   (~25 tests)
│   ├── threshold-decrypt.test.ts (~30 tests)
│   └── audit-verification.test.ts (~20 tests)
├── scenarios/
│   ├── envsync-workflow.test.ts   (~40 tests)
│   ├── multi-user.test.ts         (~25 tests)
│   └── disaster-recovery.test.ts  (~15 tests)
└── performance/
    └── load.test.ts           (~15 tests)
```

### 7.4 Security Tests (Target: 150+)
```
tests/security/
├── authentication/
│   ├── credential-bypass.test.ts   (~20 tests)
│   ├── session-hijack.test.ts      (~15 tests)
│   └── token-replay.test.ts        (~15 tests)
├── authorization/
│   ├── privilege-escalation.test.ts (~25 tests)
│   ├── idor.test.ts                 (~20 tests)
│   └── permission-bypass.test.ts    (~20 tests)
├── injection/
│   ├── sql-injection.test.ts       (~15 tests)
│   ├── nosql-injection.test.ts     (~10 tests)
│   └── path-traversal.test.ts      (~10 tests)
└── red-team/
    ├── data-exfiltration.test.ts   (~15 tests)
    ├── api-abuse.test.ts           (~20 tests)
    └── crypto-attacks.test.ts      (~15 tests)
```

### 7.5 Smoke Tests (Target: 50+)
```
tests/smoke/
├── health.test.ts             (~10 tests)
├── critical-paths.test.ts     (~25 tests)
└── integrations.test.ts       (~15 tests)
```

### 7.6 Playwright UI Tests (Target: 100+)
```
tests/playwright/
├── auth/
│   ├── login.spec.ts          (~15 tests)
│   ├── register.spec.ts       (~10 tests)
│   └── logout.spec.ts         (~5 tests)
├── projects/
│   ├── create.spec.ts         (~10 tests)
│   ├── edit.spec.ts           (~10 tests)
│   └── share.spec.ts          (~15 tests)
├── teams/
│   ├── create.spec.ts         (~10 tests)
│   ├── members.spec.ts        (~10 tests)
│   └── threshold.spec.ts      (~15 tests)
└── accessibility/
    └── a11y.spec.ts           (~10 tests)
```

### Test Infrastructure
- [ ] Jest configuration
- [ ] Test database setup/teardown
- [ ] Mocking utilities
- [ ] Test fixtures
- [ ] CI/CD pipeline integration
- [ ] Coverage reporting (target: 90%+)
- [ ] Playwright configuration

### Deliverables
- [ ] 600+ unit tests
- [ ] 400+ integration tests
- [ ] 200+ e2e tests
- [ ] 150+ security tests
- [ ] 50+ smoke tests
- [ ] 100+ Playwright tests
- [ ] **Total: 1500+ tests**
- [ ] 90%+ code coverage

---

## Phase 8: Performance & Monitoring

### 8.1 Performance Optimization
- [ ] Connection pooling tuning
- [ ] Query optimization
- [ ] Caching strategy (Redis)
  - [ ] Credential cache (5 min TTL)
  - [ ] User cache (1 min TTL)
  - [ ] Permission cache (30 sec TTL)
- [ ] Blob streaming (no full load)
- [ ] Batch operations

### 8.2 Metrics (Prometheus)
- [ ] Request latency (p50, p95, p99)
- [ ] Request rate by endpoint
- [ ] Error rate by type
- [ ] Active connections
- [ ] Cache hit/miss ratio
- [ ] Database query time
- [ ] S3 operation time
- [ ] VeilSuite service health

### 8.3 Logging (Pino/ELK)
- [ ] Structured JSON logging
- [ ] Request ID tracing
- [ ] Log levels (debug, info, warn, error)
- [ ] Log aggregation
- [ ] Log search

### 8.4 Alerting
- [ ] Error rate threshold
- [ ] Latency threshold
- [ ] Service unavailability
- [ ] Storage quota
- [ ] Rate limit hits

### 8.5 Health Checks
- [ ] Liveness probe
- [ ] Readiness probe
- [ ] Dependency health
- [ ] Self-diagnostics

### Deliverables
- [ ] Response time p99 < 200ms
- [ ] Prometheus metrics exposed
- [ ] Grafana dashboards
- [ ] Alert rules configured

---

## Phase 9: SDK & Client Libraries

### 9.1 TypeScript/JavaScript SDK
- [ ] Complete API coverage
- [ ] Browser + Node.js support
- [ ] Tree-shakeable exports
- [ ] TypeScript definitions
- [ ] Offline proof verification
- [ ] Retry logic
- [ ] npm package published

### 9.2 Python SDK (Optional)
- [ ] Full API coverage
- [ ] Async support
- [ ] Type hints
- [ ] PyPI package

### 9.3 CLI Tool
```bash
veilcloud login
veilcloud projects list
veilcloud projects create my-app
veilcloud storage put my-app production ./secrets.enc
veilcloud storage get my-app production > secrets.enc
veilcloud teams create "Dev Team" --threshold 2
veilcloud audit export my-app --format json
```

### Deliverables
- [ ] TypeScript SDK on npm
- [ ] CLI tool working
- [ ] SDK documentation

---

## Phase 10: Documentation & Polish

### 10.1 API Documentation
- [ ] OpenAPI 3.0 spec complete
- [ ] Swagger UI hosted
- [ ] Code examples for all endpoints
- [ ] Error code reference

### 10.2 Guides
- [ ] Quick start (5 min)
- [ ] EnvSync integration guide
- [ ] Team sharing guide
- [ ] Self-hosting guide
- [ ] Security best practices

### 10.3 Architecture Docs
- [ ] System architecture diagram
- [ ] Data flow diagrams
- [ ] Security model documentation
- [ ] VeilSuite integration docs

### 10.4 Code Quality
- [ ] ESLint rules enforced
- [ ] Prettier formatting
- [ ] No TypeScript `any` types
- [ ] JSDoc comments on public APIs
- [ ] CHANGELOG.md maintained

### Deliverables
- [ ] Complete API docs
- [ ] User guides
- [ ] Architecture docs
- [ ] Clean codebase

---

## Phase 11: Production Readiness

### 11.1 Deployment
- [ ] Docker image
- [ ] Docker Compose (dev)
- [ ] Kubernetes manifests
- [ ] Helm chart
- [ ] Terraform modules (optional)

### 11.2 CI/CD
- [ ] GitHub Actions workflow
- [ ] Test on PR
- [ ] Build on merge
- [ ] Auto-deploy to staging
- [ ] Manual deploy to prod

### 11.3 Operations
- [ ] Runbooks
- [ ] Incident response plan
- [ ] Backup procedures
- [ ] Disaster recovery plan
- [ ] On-call rotation setup

### 11.4 Compliance
- [ ] SOC 2 controls documented
- [ ] GDPR compliance
- [ ] Data retention policy
- [ ] Privacy policy
- [ ] Terms of service

### Deliverables
- [ ] Production-ready deployment
- [ ] CI/CD pipeline
- [ ] Operations documentation
- [ ] Compliance documentation

---

## Phase 12: Horizontal Scaling Infrastructure 🚀

**Purpose**: Enable VeilCloud to handle 100K+ votes/sec for TVS (Trustless Voting System) and other high-throughput VeilSuite applications.

### 12.1 Kafka Message Queue (Async Vote Ingestion)

**Problem**: Synchronous API calls bottleneck at ~20 votes/sec. Need async ingestion for 100K+/sec.

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  VeilCloud  │───▶│   Kafka     │───▶│   Worker    │───▶│  Database   │
│  API        │    │   Topic     │    │   Pool      │    │  (Citus)    │
│  (accepts)  │    │  (buffers)  │    │  (processes)│    │  (stores)   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
     │                                      │
     │ immediate ACK                        │ batch Merkle updates
     ▼                                      ▼
   voter                              VeilChain audit
```

#### Tasks
- [ ] Kafka client setup (kafkajs)
- [ ] Topic configuration
  - `veilcloud.votes.incoming` — Vote submission events
  - `veilcloud.audit.events` — Audit log events
  - `veilcloud.merkle.updates` — Merkle tree batch updates
- [ ] Producer service (API → Kafka)
- [ ] Consumer workers (Kafka → DB)
- [ ] Dead letter queue (DLQ) for failed messages
- [ ] Exactly-once semantics (idempotency keys)
- [ ] Consumer group management
- [ ] Lag monitoring and alerting
- [ ] Backpressure handling

#### Configuration
```typescript
// src/config/kafka.ts
export const kafkaConfig = {
  brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
  clientId: 'veilcloud',
  topics: {
    votesIncoming: 'veilcloud.votes.incoming',
    auditEvents: 'veilcloud.audit.events',
    merkleUpdates: 'veilcloud.merkle.updates',
  },
  consumer: {
    groupId: 'veilcloud-workers',
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
  },
  producer: {
    acks: -1, // all replicas
    idempotent: true,
    maxInFlightRequests: 5,
  },
};
```

### 12.2 Citus Sharding (Distributed PostgreSQL)

**Problem**: Single PostgreSQL node can't handle 350M votes. Need horizontal data distribution.

```
┌─────────────────────────────────────────────────────────────┐
│                     CITUS COORDINATOR                        │
│                 (Routes queries to shards)                   │
└─────────────────────────┬───────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│   Worker 1    │ │   Worker 2    │ │   Worker N    │
│  (shard 0-99) │ │ (shard 100-199)│ │ (shard N...)  │
│               │ │               │ │               │
│  elections    │ │  elections    │ │  elections    │
│  A, B, C...   │ │  D, E, F...   │ │  X, Y, Z...   │
└───────────────┘ └───────────────┘ └───────────────┘
```

#### Tasks
- [ ] Citus extension setup
- [ ] Distributed table design
  ```sql
  -- Shard votes by election_id (co-locate related votes)
  SELECT create_distributed_table('votes', 'election_id');
  SELECT create_distributed_table('nullifiers', 'election_id');
  SELECT create_distributed_table('merkle_nodes', 'election_id');

  -- Reference tables (replicated to all nodes)
  SELECT create_reference_table('elections');
  SELECT create_reference_table('trustees');
  ```
- [ ] Shard key strategy (election_id for vote co-location)
- [ ] Reference tables for shared data
- [ ] Query routing optimization
- [ ] Rebalancing procedures
- [ ] Shard health monitoring
- [ ] Cross-shard query optimization

#### Configuration
```typescript
// src/config/citus.ts
export const citusConfig = {
  coordinator: process.env.CITUS_COORDINATOR_URL,
  shardCount: parseInt(process.env.CITUS_SHARD_COUNT || '32'),
  replicationFactor: parseInt(process.env.CITUS_REPLICATION_FACTOR || '2'),
  distributedTables: ['votes', 'nullifiers', 'merkle_nodes'],
  referenceTables: ['elections', 'trustees', 'candidates'],
};
```

### 12.3 Redis Cache (Nullifier Bloom Filters)

**Problem**: Checking 350M nullifiers for duplicates is slow. Need O(1) lookups.

```
┌─────────────────────────────────────────────────────────────┐
│                      VOTE SUBMISSION                         │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Redis Bloom Filter: "Is this nullifier POSSIBLY used?"     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  election:abc123:nullifiers (Bloom Filter)          │   │
│  │  - False positive rate: 0.01%                       │   │
│  │  - Memory: ~1.2GB for 350M entries                  │   │
│  │  - Lookup: O(1)                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  if NOT in bloom filter → definitely new, accept            │
│  if IN bloom filter → check PostgreSQL to confirm          │
└─────────────────────────────────────────────────────────────┘
```

#### Tasks
- [ ] Redis Bloom module (RedisBloom)
- [ ] Bloom filter per election
- [ ] Nullifier check flow:
  1. Check bloom filter (O(1))
  2. If negative → accept (definitely new)
  3. If positive → check DB (might be false positive)
- [ ] Credential cache (reduce VeilSign calls)
- [ ] Session/rate limit state
- [ ] Cluster mode configuration
- [ ] Persistence (AOF for durability)
- [ ] Memory management and eviction

#### Configuration
```typescript
// src/config/redis.ts
export const redisConfig = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  cluster: process.env.REDIS_CLUSTER === 'true',
  bloomFilter: {
    errorRate: 0.0001, // 0.01% false positive
    capacity: 400_000_000, // 400M entries
  },
  cache: {
    credentialTTL: 300, // 5 minutes
    userTTL: 60, // 1 minute
    permissionTTL: 30, // 30 seconds
  },
};
```

### 12.4 Kubernetes Autoscaling

**Problem**: Fixed pod count can't handle vote bursts. Need dynamic scaling.

```yaml
# k8s/veilcloud-hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: veilcloud-api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: veilcloud-api
  minReplicas: 3
  maxReplicas: 100
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Pods
      pods:
        metric:
          name: kafka_consumer_lag
        target:
          type: AverageValue
          averageValue: "1000"
```

#### Tasks
- [ ] Horizontal Pod Autoscaler (HPA)
  - CPU-based scaling
  - Custom metrics (Kafka lag, request queue)
- [ ] Vertical Pod Autoscaler (VPA) - optional
- [ ] Cluster autoscaling (node pool)
- [ ] Pod disruption budgets
- [ ] Resource requests/limits tuning
- [ ] Affinity/anti-affinity rules
- [ ] Multi-region deployment
- [ ] Traffic splitting (canary/blue-green)

#### Kubernetes Manifests
```
k8s/
├── base/
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── deployment.yaml
│   ├── service.yaml
│   └── hpa.yaml
├── overlays/
│   ├── development/
│   ├── staging/
│   └── production/
└── helm/
    └── veilcloud/
        ├── Chart.yaml
        ├── values.yaml
        └── templates/
```

### 12.5 Scaling Targets

| Metric | Current | Phase 12 Target |
|--------|---------|-----------------|
| Vote throughput | ~20/sec | 100,000/sec |
| Max concurrent elections | 1 | 1,000+ |
| Max votes per election | ~100K | 350M+ |
| Nullifier lookup | O(n) DB | O(1) Bloom |
| API latency p99 | ~200ms | <50ms |
| Availability | 99.9% | 99.99% |

### Deliverables
- [ ] Kafka cluster deployed and integrated
- [ ] Citus-based distributed database
- [ ] Redis Bloom filters for nullifiers
- [ ] Kubernetes autoscaling configured
- [ ] Load tested at 100K votes/sec
- [ ] Monitoring dashboards for scaling metrics

---

## Phase 13: Edge Node Architecture (Raspberry Pi) 🇺🇸

**Purpose**: Enable distributed edge deployment for resilient, offline-capable vote collection at polling stations.

### Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  RASPBERRY PI   │      │   MAIN SERVER   │      │    VEILPROOF    │
│  (Edge Node)    │      │   (Central)     │      │   (Proofs)      │
├─────────────────┤      ├─────────────────┤      ├─────────────────┤
│                 │      │                 │      │                 │
│  VeilCloud Edge │─────▶│  VeilCloud      │─────▶│  ZK Circuits    │
│                 │      │  Aggregation    │      │                 │
│  • Vote intake  │      │  • Kafka queue  │      │  • Groth16      │
│  • Local Bloom  │      │  • Citus DB     │      │  • Batch proofs │
│  • SQLite queue │      │  • Merkle tree  │      │                 │
│  • Offline sync │      │                 │      │                 │
└─────────────────┘      └─────────────────┘      └─────────────────┘
     ARM64 / 8GB              Full stack            GPU accelerated
```

### 13.1 Edge Queue (SQLite-based)

**Problem**: Network failures shouldn't lose votes. Edge must queue locally and sync when connected.

#### Tasks
- [ ] SQLite queue schema (votes pending sync)
- [ ] Queue service (add, peek, ack, retry)
- [ ] Configurable retry policy (exponential backoff)
- [ ] Queue size limits and overflow handling
- [ ] Persistence across restarts

### 13.2 Edge Sync Service

**Problem**: Edge nodes need to reliably forward votes to central server.

#### Tasks
- [ ] Sync worker (background process)
- [ ] Batch forwarding (100 votes per request)
- [ ] Central server health checks
- [ ] Automatic retry on failure
- [ ] Sync status reporting
- [ ] Conflict resolution (duplicate handling)

### 13.3 Edge API

**Problem**: Edge needs lightweight API for vote intake without full stack.

#### Tasks
- [ ] POST /edge/votes - Accept vote, queue locally, ACK immediately
- [ ] GET /edge/status - Queue depth, sync status, central connectivity
- [ ] GET /edge/health - Edge node health
- [ ] Local Bloom filter for instant duplicate rejection

### 13.4 Central Aggregation API

**Problem**: Central needs endpoints to receive from edge nodes.

#### Tasks
- [ ] POST /central/ingest - Receive batch from edge
- [ ] Edge authentication (API keys per edge node)
- [ ] Idempotency (handle duplicate batches)
- [ ] Edge registration and management

### 13.5 Edge Configuration

```typescript
// src/edge/config.ts
export const edgeConfig = {
  mode: 'edge' | 'central' | 'standalone',
  central: {
    url: process.env.CENTRAL_URL,
    apiKey: process.env.CENTRAL_API_KEY,
  },
  queue: {
    path: process.env.EDGE_QUEUE_PATH || './data/edge-queue.db',
    maxSize: 1_000_000, // 1M votes max queued
    batchSize: 100,
    retryIntervalMs: 5000,
    maxRetries: 100,
  },
  bloom: {
    capacity: 1_000_000, // 1M per edge node
    errorRate: 0.0001,
  },
};
```

### 13.6 Raspberry Pi Deployment

#### Hardware Requirements
- Raspberry Pi 4/5 (4GB+ RAM recommended)
- 32GB+ SD card or USB SSD
- Ethernet (recommended) or WiFi

#### Deployment
```bash
# On Raspberry Pi
export VEILCLOUD_MODE=edge
export CENTRAL_URL=https://central.veilcloud.io
export CENTRAL_API_KEY=edge-node-001-key
export EDGE_QUEUE_PATH=/data/queue.db
export STORAGE_TYPE=local
export STORAGE_LOCAL_PATH=/data/votes

npm start
```

### Deliverables
- [ ] Edge queue service (SQLite)
- [ ] Edge sync worker
- [ ] Edge API endpoints
- [ ] Central ingest endpoints
- [ ] Edge ↔ Central authentication
- [ ] Raspberry Pi deployment guide
- [ ] Offline operation tested (24hr disconnection)

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Test Count | 1500+ |
| Code Coverage | 90%+ |
| API Uptime | 99.99% |
| p99 Latency | <50ms |
| Security Incidents | 0 critical |
| Documentation | 100% API coverage |
| **Vote Throughput** | **100K/sec** |
| **Max Votes/Election** | **350M+** |
| **Nullifier Lookup** | **O(1)** |

---

## Timeline Summary

| Phase | Status | Priority |
|-------|--------|----------|
| Phase 1: Core Infrastructure | ✅ Complete | - |
| Phase 2: Database Layer | 🔄 In Progress | High |
| Phase 3: Auth & Authorization | Pending | High |
| Phase 4: Complete API Routes | Pending | High |
| Phase 5: VeilSuite Integration | Pending | High |
| Phase 6: Security Hardening | Pending | High |
| Phase 7: Testing (1500+) | Pending | Medium |
| Phase 8: Performance & Monitoring | Pending | Medium |
| Phase 9: SDK & Libraries | Pending | Medium |
| Phase 10: Documentation | Pending | Low |
| Phase 11: Production Readiness | Pending | High |
| Phase 12: Horizontal Scaling 🚀 | Pending | **Critical for TVS** |
| Phase 13: Edge Node (Pi) 🇺🇸 | 🔄 In Progress | **Distributed voting** |

---

*"Store secrets. Not trust."*
