-- Migration: 001_citus_setup.sql
-- Purpose: Set up Citus distributed tables for horizontal scaling
-- Target: 350M+ votes across multiple shards

-- ============================================================
-- STEP 1: Enable Citus extension
-- ============================================================

CREATE EXTENSION IF NOT EXISTS citus;

-- ============================================================
-- STEP 2: Create base tables (if not exists)
-- ============================================================

-- Elections table (will be reference table - replicated to all nodes)
CREATE TABLE IF NOT EXISTS elections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    public_key TEXT NOT NULL,
    threshold INT NOT NULL DEFAULT 3,
    trustees INT NOT NULL DEFAULT 5,
    status VARCHAR(50) NOT NULL DEFAULT 'created',
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trustees table (will be reference table)
CREATE TABLE IF NOT EXISTS trustees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    share_index INT NOT NULL,
    public_commitment TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(election_id, share_index)
);

-- Candidates table (will be reference table)
CREATE TABLE IF NOT EXISTS candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    position INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(election_id, position)
);

-- Votes table (will be distributed by election_id)
CREATE TABLE IF NOT EXISTS votes (
    id UUID DEFAULT gen_random_uuid(),
    election_id UUID NOT NULL,
    encrypted_vote JSONB NOT NULL,
    commitment VARCHAR(64) NOT NULL,
    nullifier VARCHAR(64) NOT NULL,
    zk_proof JSONB NOT NULL,
    merkle_position BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (election_id, id)
);

-- Nullifiers table (will be distributed by election_id)
-- Separate table for fast duplicate checking
CREATE TABLE IF NOT EXISTS nullifiers (
    election_id UUID NOT NULL,
    nullifier VARCHAR(64) NOT NULL,
    vote_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (election_id, nullifier)
);

-- Merkle nodes table (will be distributed by election_id)
CREATE TABLE IF NOT EXISTS merkle_nodes (
    election_id UUID NOT NULL,
    level INT NOT NULL,
    position BIGINT NOT NULL,
    hash VARCHAR(64) NOT NULL,
    left_child VARCHAR(64),
    right_child VARCHAR(64),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (election_id, level, position)
);

-- ============================================================
-- STEP 3: Create reference tables (replicated to all nodes)
-- ============================================================

-- Reference tables are small, read-heavy, and needed for JOINs
SELECT create_reference_table('elections');
SELECT create_reference_table('trustees');
SELECT create_reference_table('candidates');

-- ============================================================
-- STEP 4: Create distributed tables (sharded by election_id)
-- ============================================================

-- Distribute votes by election_id
-- All votes for the same election are co-located on the same shard
SELECT create_distributed_table('votes', 'election_id');

-- Co-locate nullifiers with votes for efficient JOIN
SELECT create_distributed_table('nullifiers', 'election_id', colocate_with => 'votes');

-- Co-locate merkle_nodes with votes
SELECT create_distributed_table('merkle_nodes', 'election_id', colocate_with => 'votes');

-- ============================================================
-- STEP 5: Create indexes on distributed tables
-- ============================================================

-- Votes indexes
CREATE INDEX IF NOT EXISTS idx_votes_election_merkle
    ON votes(election_id, merkle_position);
CREATE INDEX IF NOT EXISTS idx_votes_created
    ON votes(election_id, created_at);

-- Nullifiers index (primary lookup pattern)
CREATE INDEX IF NOT EXISTS idx_nullifiers_lookup
    ON nullifiers(election_id, nullifier);

-- Merkle nodes index
CREATE INDEX IF NOT EXISTS idx_merkle_level
    ON merkle_nodes(election_id, level);

-- ============================================================
-- STEP 6: Create helper functions
-- ============================================================

-- Function to check nullifier exists (runs on correct shard)
CREATE OR REPLACE FUNCTION check_nullifier_exists(
    p_election_id UUID,
    p_nullifier VARCHAR(64)
) RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM nullifiers
        WHERE election_id = p_election_id
        AND nullifier = p_nullifier
    );
END;
$$ LANGUAGE plpgsql;

-- Function to insert vote with nullifier check (atomic)
CREATE OR REPLACE FUNCTION insert_vote(
    p_election_id UUID,
    p_encrypted_vote JSONB,
    p_commitment VARCHAR(64),
    p_nullifier VARCHAR(64),
    p_zk_proof JSONB,
    p_merkle_position BIGINT
) RETURNS UUID AS $$
DECLARE
    v_vote_id UUID;
BEGIN
    -- Check nullifier doesn't exist
    IF check_nullifier_exists(p_election_id, p_nullifier) THEN
        RAISE EXCEPTION 'Nullifier already used';
    END IF;

    -- Generate vote ID
    v_vote_id := gen_random_uuid();

    -- Insert vote
    INSERT INTO votes (id, election_id, encrypted_vote, commitment, nullifier, zk_proof, merkle_position)
    VALUES (v_vote_id, p_election_id, p_encrypted_vote, p_commitment, p_nullifier, p_zk_proof, p_merkle_position);

    -- Insert nullifier
    INSERT INTO nullifiers (election_id, nullifier, vote_id)
    VALUES (p_election_id, p_nullifier, v_vote_id);

    RETURN v_vote_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- STEP 7: Shard rebalancing (run periodically or on-demand)
-- ============================================================

-- To rebalance shards after adding workers:
-- SELECT citus_rebalance_start();

-- To check shard distribution:
-- SELECT * FROM citus_shards;

-- To add a worker node:
-- SELECT citus_add_node('worker-hostname', 5432);
