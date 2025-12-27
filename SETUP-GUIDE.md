# VeilCloud Setup Guide (Personal Reference)

> This is your personal guide for running VeilCloud locally and in production.

---

## Table of Contents

1. [Quick Start (Local Dev)](#quick-start-local-dev)
2. [Prerequisites](#prerequisites)
3. [Environment Variables](#environment-variables)
4. [API Keys & Credentials Needed](#api-keys--credentials-needed)
5. [Running Locally](#running-locally)
6. [Running in Production](#running-in-production)
7. [Cost Estimates](#cost-estimates)
8. [Monitoring & Debugging](#monitoring--debugging)
9. [Troubleshooting](#troubleshooting)

---

## Quick Start (Local Dev)

### Option A: Local Filesystem (Simplest - No Docker for storage)

```bash
# 1. Set environment to use local storage
export STORAGE_TYPE=local
export STORAGE_LOCAL_PATH=/Volumes/YourDrive/veilcloud-data  # Your 4TB drive

# 2. Start only the services you need
docker-compose up -d postgres redis  # Just DB and cache

# 3. Run the API directly
npm install
npm run build
npm start

# Data stored at: /Volumes/YourDrive/veilcloud-data/projects/...
```

### Option B: Full Docker Stack

```bash
# 1. Clone and enter directory
cd /Users/jasonsutter/Documents/Companies/VeilSuite/VeilCloud

# 2. Start everything with Docker
docker-compose up -d

# 3. Check services are running
docker-compose ps

# 4. View logs
docker-compose logs -f api

# 5. Access services
# API:          http://localhost:3000
# MinIO Console: http://localhost:9001 (minioadmin/minioadmin)
# Kafka UI:     http://localhost:8080
# RedisInsight: http://localhost:8001
```

**That's it for local dev.** No API keys needed - everything runs locally.

---

## Prerequisites

### Local Development
- Docker Desktop (4GB+ RAM allocated)
- Node.js 20+ (for running without Docker)
- ~10GB disk space for Docker images/volumes

### Production
- Kubernetes cluster (GKE, EKS, or AKS)
- Cloud provider account (AWS, GCP, or Azure)
- Domain name (optional but recommended)

---

## Environment Variables

### Required for Production

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:pass@host:5432/db` |
| `REDIS_URL` | Redis connection string | `redis://host:6379` |
| `KAFKA_BROKERS` | Kafka broker addresses | `broker1:9092,broker2:9092` |
| `S3_ENDPOINT` | S3/MinIO endpoint | `https://s3.amazonaws.com` |
| `S3_ACCESS_KEY_ID` | S3 access key | `AKIA...` |
| `S3_SECRET_ACCESS_KEY` | S3 secret key | `wJal...` |
| `S3_BUCKET` | S3 bucket name | `veilcloud-prod` |
| `S3_REGION` | S3 region | `us-east-1` |

### Storage Selection (Choose One)

| Variable | Value | Description |
|----------|-------|-------------|
| `STORAGE_TYPE` | `local` | Use local filesystem (testing) |
| `STORAGE_TYPE` | `s3` | Use S3/MinIO (default, production) |
| `STORAGE_LOCAL_PATH` | `/path/to/data` | Local storage directory (when type=local) |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | API server port |
| `NODE_ENV` | `development` | Environment mode |
| `LOG_LEVEL` | `info` | Logging level (debug/info/warn/error) |
| `BLOOM_CAPACITY` | `400000000` | Max nullifiers (400M) |
| `BLOOM_ERROR_RATE` | `0.0001` | False positive rate (0.01%) |
| `RATE_LIMIT_MAX` | `1000` | Max requests per minute |
| `VEILKEY_URL` | - | VeilKey service URL |
| `VEILCHAIN_URL` | - | VeilChain service URL |
| `VEILSIGN_URL` | - | VeilSign service URL |

---

## API Keys & Credentials Needed

### Local Development: NONE REQUIRED

Everything runs in Docker with default credentials:
- PostgreSQL: `veilcloud:veilcloud`
- MinIO: `minioadmin:minioadmin`
- Redis: No auth
- Kafka: No auth

### Production: What You Need

| Service | Credential Type | How to Get |
|---------|----------------|------------|
| **AWS S3** | Access Key + Secret | AWS Console → IAM → Create User |
| **AWS RDS** | Username + Password | You create during RDS setup |
| **Redis Cloud** | Connection URL | Redis Cloud dashboard |
| **Confluent Kafka** | API Key + Secret | Confluent Cloud dashboard |
| **GCP Cloud Storage** | Service Account JSON | GCP Console → IAM |
| **Azure Blob** | Connection String | Azure Portal → Storage Account |

---

## Running Locally

### Option 1: Docker Compose (Recommended)

```bash
# Start all services
docker-compose up -d

# View status
docker-compose ps

# View logs
docker-compose logs -f

# Stop all
docker-compose down

# Stop and remove volumes (fresh start)
docker-compose down -v
```

### Option 2: Manual (for debugging)

```bash
# Terminal 1: Start dependencies
docker-compose up -d postgres redis kafka minio zookeeper

# Terminal 2: Run API
npm install
npm run build
npm run start

# Terminal 3: Run workers (optional)
node dist/worker.js
```

### Accessing Local Services

| Service | URL | Credentials |
|---------|-----|-------------|
| VeilCloud API | http://localhost:3000 | - |
| API Health | http://localhost:3000/health | - |
| MinIO Console | http://localhost:9001 | minioadmin / minioadmin |
| MinIO API | http://localhost:9000 | minioadmin / minioadmin |
| Kafka UI | http://localhost:8080 | - |
| RedisInsight | http://localhost:8001 | - |
| PostgreSQL | localhost:5432 | veilcloud / veilcloud |

---

## Running in Production

### Option 1: Managed Services (Easiest, Recommended)

Use cloud-managed services instead of self-hosting:

```
┌─────────────────────────────────────────────────────────────────┐
│                     RECOMMENDED STACK                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Compute:     AWS EKS / GCP GKE / Azure AKS                     │
│  Database:    AWS RDS PostgreSQL + Citus extension              │
│  Cache:       AWS ElastiCache Redis / Redis Cloud               │
│  Queue:       Confluent Cloud Kafka / AWS MSK                   │
│  Storage:     AWS S3 / GCP Cloud Storage / Azure Blob           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Option 2: Kubernetes (Self-Managed)

```bash
# Apply development config
kubectl apply -k k8s/overlays/development

# Apply production config
kubectl apply -k k8s/overlays/production

# Check status
kubectl get pods -n veilcloud

# View logs
kubectl logs -f deployment/veilcloud-api -n veilcloud
```

---

## Cost Estimates

### Local Development: $0/month
Everything runs on your machine.

### Production Costs by Scale

#### Small Scale (10K voters, testing)

| Service | Provider | Spec | Monthly Cost |
|---------|----------|------|--------------|
| Kubernetes | GKE Autopilot | 3 nodes | ~$75 |
| PostgreSQL | Cloud SQL | db-f1-micro | ~$10 |
| Redis | Redis Cloud | Free tier | $0 |
| Kafka | Confluent | Basic | ~$25 |
| Storage | GCS | 10GB | ~$0.25 |
| **Total** | | | **~$110/month** |

#### Medium Scale (100K voters)

| Service | Provider | Spec | Monthly Cost |
|---------|----------|------|--------------|
| Kubernetes | GKE | 5x n2-standard-4 | ~$400 |
| PostgreSQL | Cloud SQL | db-n1-standard-2 | ~$100 |
| Redis | Redis Cloud | 1GB | ~$30 |
| Kafka | Confluent | Standard | ~$150 |
| Storage | GCS | 100GB | ~$2.50 |
| **Total** | | | **~$680/month** |

#### Large Scale (1M+ voters)

| Service | Provider | Spec | Monthly Cost |
|---------|----------|------|--------------|
| Kubernetes | GKE | 20x n2-standard-8 | ~$3,000 |
| PostgreSQL | Citus Cloud | 4 workers | ~$800 |
| Redis | Redis Cloud | 10GB cluster | ~$300 |
| Kafka | Confluent | Dedicated | ~$1,000 |
| Storage | S3 | 1TB | ~$23 |
| **Total** | | | **~$5,100/month** |

#### National Scale (350M voters)

| Service | Provider | Spec | Monthly Cost |
|---------|----------|------|--------------|
| Kubernetes | GKE | 100+ nodes | ~$15,000 |
| PostgreSQL | Citus Cloud | 32 workers | ~$5,000 |
| Redis | Redis Cloud | 100GB cluster | ~$2,000 |
| Kafka | Confluent | Enterprise | ~$5,000 |
| Storage | S3 | 10TB | ~$230 |
| Bandwidth | - | High | ~$2,000 |
| **Total** | | | **~$30,000/month** |

### Storage Costs (Per GB)

| Provider | Storage | Requests (per 1M) |
|----------|---------|-------------------|
| AWS S3 Standard | $0.023/GB | $0.40 PUT, $0.04 GET |
| GCP Cloud Storage | $0.020/GB | $0.05 PUT, $0.004 GET |
| Azure Blob | $0.018/GB | $0.05 PUT, $0.004 GET |
| MinIO (self-hosted) | Disk cost only | N/A |
| Cloudflare R2 | $0.015/GB | FREE (no egress!) |

**Recommendation:** Use **Cloudflare R2** for storage - no egress fees!

### Vote Storage Size Estimates

| Votes | Encrypted Size | With Proofs | With Merkle |
|-------|---------------|-------------|-------------|
| 10K | ~5 MB | ~50 MB | ~60 MB |
| 100K | ~50 MB | ~500 MB | ~600 MB |
| 1M | ~500 MB | ~5 GB | ~6 GB |
| 10M | ~5 GB | ~50 GB | ~60 GB |
| 350M | ~175 GB | ~1.7 TB | ~2 TB |

---

## Monitoring & Debugging

### Health Checks

```bash
# API health
curl http://localhost:3000/health

# Readiness (all dependencies)
curl http://localhost:3000/health/ready
```

### Logs

```bash
# Docker Compose
docker-compose logs -f api
docker-compose logs -f worker
docker-compose logs -f kafka

# Kubernetes
kubectl logs -f deployment/veilcloud-api -n veilcloud
kubectl logs -f deployment/veilcloud-worker -n veilcloud
```

### Kafka Topics

Access Kafka UI at http://localhost:8080 to see:
- `veilcloud.votes.incoming` - Vote submissions
- `veilcloud.audit.events` - Audit trail
- `veilcloud.merkle.updates` - Merkle batches
- `veilcloud.dead-letter` - Failed messages

### Redis (Bloom Filters)

```bash
# Connect to Redis
docker-compose exec redis redis-cli

# Check Bloom filter
BF.INFO election:abc123:nullifiers

# Check cache stats
INFO stats
```

### PostgreSQL (Citus)

```bash
# Connect to Postgres
docker-compose exec postgres psql -U veilcloud

# Check shards
SELECT * FROM citus_shards;

# Check workers
SELECT * FROM citus_get_active_worker_nodes();

# Vote count
SELECT COUNT(*) FROM votes WHERE election_id = 'xxx';
```

---

## Troubleshooting

### Docker Issues

```bash
# Reset everything
docker-compose down -v
docker system prune -a
docker-compose up -d
```

### Kafka Not Starting

```bash
# Check Zookeeper first
docker-compose logs zookeeper

# Restart Kafka
docker-compose restart kafka
```

### PostgreSQL Connection Refused

```bash
# Check if running
docker-compose ps postgres

# Check logs
docker-compose logs postgres

# Restart
docker-compose restart postgres
```

### Redis Bloom Commands Unknown

Redis Stack image is required (not regular Redis):
```yaml
# docker-compose.yml should have:
redis:
  image: redis/redis-stack:latest  # NOT redis:latest
```

### Out of Memory

Increase Docker Desktop memory allocation:
- Docker Desktop → Settings → Resources → Memory → 8GB+

---

## Quick Reference

### Local URLs
- API: http://localhost:3000
- MinIO: http://localhost:9001
- Kafka UI: http://localhost:8080
- Redis: http://localhost:8001

### Default Credentials (Local Only!)
- PostgreSQL: `veilcloud` / `veilcloud`
- MinIO: `minioadmin` / `minioadmin`

### Common Commands
```bash
# Start
docker-compose up -d

# Stop
docker-compose down

# Logs
docker-compose logs -f

# Fresh start
docker-compose down -v && docker-compose up -d

# Build after code changes
docker-compose build && docker-compose up -d
```

---

*Last updated: December 2025*
