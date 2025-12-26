# VeilCloud

**Zero-knowledge cloud storage platform**

*"Store secrets. Not trust."*

---

## Overview

VeilCloud is a general-purpose encrypted storage backend that integrates with the VeilSuite ecosystem:

- **ZK Storage** — Server never sees plaintext. Client-side encryption only.
- **VeilKey** — Threshold keys for team access (t-of-n required to decrypt)
- **VeilChain** — Immutable audit trail with Merkle proofs
- **VeilSign** — Privacy-preserving credentials for access control

VeilCloud is designed as a generic platform. [EnvSync](https://github.com/jasonsutter87/EnvSync) is one client, but any app can use it.

---

## Quick Start

### Installation

```bash
npm install @veilcloud/sdk
```

### Usage

```typescript
import { VeilCloudClient } from '@veilcloud/sdk';

const client = new VeilCloudClient({
  baseUrl: 'https://api.veilcloud.io',
  credential: myCredential,
  signature: mySignature,
});

// Store encrypted blob (you encrypt client-side first!)
const encrypted = await encrypt(mySecrets, myKey);
await client.storage.put('my-project', 'production', {
  data: btoa(encrypted), // base64
});

// Retrieve and decrypt
const blob = await client.storage.get('my-project', 'production');
const decrypted = await decrypt(atob(blob.data), myKey);
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VEILCLOUD                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      REST API (Fastify)                          │    │
│  │  /v1/storage/*   /v1/projects/*   /v1/teams/*   /v1/audit/*     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                   │                                      │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                     Service Layer                                │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │    │
│  │  │ Storage  │  │  Team    │  │  Audit   │  │  Access  │        │    │
│  │  │ Service  │  │ Service  │  │ Service  │  │ Service  │        │    │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │    │
│  └───────│─────────────│─────────────│─────────────│───────────────┘    │
│          │             │             │             │                     │
│  ┌───────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐             │
│  │ Encrypted   │ │  VeilKey  │ │ VeilChain │ │ VeilSign  │             │
│  │ Blob Store  │ │   SDK     │ │   SDK     │ │   SDK     │             │
│  │ (S3/MinIO)  │ │           │ │           │ │           │             │
│  └─────────────┘ └───────────┘ └───────────┘ └───────────┘             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### Storage (ZK Blobs)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `PUT` | `/v1/storage/:projectId/:envName` | Store encrypted blob |
| `GET` | `/v1/storage/:projectId/:envName` | Retrieve encrypted blob |
| `DELETE` | `/v1/storage/:projectId/:envName` | Delete blob |
| `GET` | `/v1/storage/:projectId` | List all blobs for project |
| `HEAD` | `/v1/storage/:projectId/:envName` | Check existence & metadata |

### Teams (VeilKey)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/teams` | Create team with threshold key |
| `GET` | `/v1/teams/:id` | Get team info |
| `POST` | `/v1/teams/:id/members` | Add member (distribute share) |
| `DELETE` | `/v1/teams/:id/members/:userId` | Remove member |
| `POST` | `/v1/teams/:id/decrypt` | Request partial decryption |

### Audit (VeilChain)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/audit/:projectId` | Get audit trail |
| `GET` | `/v1/audit/:projectId/proof/:entryId` | Get Merkle proof |
| `POST` | `/v1/audit/verify` | Verify proof (offline capable) |

### Access (VeilSign)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/access/issue` | Issue credential |
| `POST` | `/v1/access/verify` | Verify credential |
| `POST` | `/v1/access/revoke` | Revoke credential |

---

## VeilSuite Integration

### VeilKey — Team Threshold Keys

```typescript
// Create 2-of-3 team key
const team = await client.teams.create('Frontend', 2, ['alice@', 'bob@', 'carol@']);

// Any 2 members can decrypt team secrets
// No single point of failure
```

### VeilChain — Audit Trail

```typescript
// Every access is logged immutably
const trail = await client.audit.getTrail('my-project');

// Get cryptographic proof for any entry
const proof = await client.audit.getProof('my-project', 'entry-123');

// Verify offline (no API needed)
const valid = verifyProofOffline(proof);
```

### VeilSign — Credentials

```typescript
// Issue credential with permissions
const cred = await veilsign.issueCredential({
  userId: 'alice',
  projectId: 'my-project',
  permissions: ['project:read', 'project:write'],
  expiresInSeconds: 86400,
});

// Verify credential (privacy-preserving blind signature)
const valid = await veilsign.verifyCredential({
  credential: cred.credential,
  signature: cred.signature,
});
```

---

## Development

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- MinIO (or S3-compatible storage)
- Redis (optional, for caching)

### Setup

```bash
# Clone
git clone https://github.com/jasonsutter87/VeilCloud.git
cd VeilCloud

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your settings

# Run
npm run dev:server
```

### Environment Variables

```bash
# Server
PORT=3000
HOST=0.0.0.0

# Database
DATABASE_URL=postgres://user:pass@localhost:5432/veilcloud

# Storage (S3/MinIO)
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=veilcloud
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true

# VeilSuite (optional)
VEILKEY_URL=http://localhost:3002
VEILCHAIN_URL=http://localhost:3003
VEILSIGN_URL=http://localhost:3001

# Redis (optional)
REDIS_URL=redis://localhost:6379
```

---

## Security Model

| Property | How |
|----------|-----|
| **Server never sees plaintext** | Client-side encryption before upload |
| **Team access without single key** | VeilKey threshold cryptography |
| **Tamper-proof audit trail** | VeilChain Merkle proofs |
| **Privacy-preserving auth** | VeilSign blind signatures |

---

## License

MIT

---

*Part of the VeilSuite ecosystem*
