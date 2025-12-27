/**
 * Kafka Producer Service
 *
 * Handles publishing messages to Kafka topics.
 * Used by the API to enqueue votes for async processing.
 */

import { Kafka, Producer, ProducerRecord, RecordMetadata } from 'kafkajs';
import { v4 as uuidv4 } from 'uuid';
import { getKafkaConfig, VeilCloudKafkaConfig } from './config.js';
import {
  VoteIncomingMessage,
  AuditEventMessage,
  MerkleUpdateMessage,
} from './topics.js';

export class KafkaProducerService {
  private kafka: Kafka;
  private producer: Producer;
  private config: VeilCloudKafkaConfig;
  private isConnected: boolean = false;

  constructor(config?: VeilCloudKafkaConfig) {
    this.config = config || getKafkaConfig();
    this.kafka = new Kafka(this.config.kafka);
    this.producer = this.kafka.producer(this.config.producer);
  }

  /**
   * Connect to Kafka
   */
  async connect(): Promise<void> {
    if (this.isConnected) return;

    await this.producer.connect();
    this.isConnected = true;
    console.log('[Kafka Producer] Connected');
  }

  /**
   * Disconnect from Kafka
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) return;

    await this.producer.disconnect();
    this.isConnected = false;
    console.log('[Kafka Producer] Disconnected');
  }

  /**
   * Publish a vote submission for async processing
   */
  async publishVote(vote: Omit<VoteIncomingMessage, 'messageId' | 'timestamp'>): Promise<string> {
    const messageId = uuidv4();
    const message: VoteIncomingMessage = {
      ...vote,
      messageId,
      timestamp: Date.now(),
    };

    await this.send({
      topic: this.config.topics.votesIncoming,
      messages: [
        {
          key: vote.electionId, // Partition by election for ordering
          value: JSON.stringify(message),
          headers: {
            messageId,
            electionId: vote.electionId,
            nullifier: vote.nullifier,
          },
        },
      ],
    });

    return messageId;
  }

  /**
   * Publish a batch of votes for high-throughput scenarios
   */
  async publishVoteBatch(
    votes: Omit<VoteIncomingMessage, 'messageId' | 'timestamp'>[]
  ): Promise<string[]> {
    const messageIds: string[] = [];
    const messages = votes.map((vote) => {
      const messageId = uuidv4();
      messageIds.push(messageId);

      const message: VoteIncomingMessage = {
        ...vote,
        messageId,
        timestamp: Date.now(),
      };

      return {
        key: vote.electionId,
        value: JSON.stringify(message),
        headers: {
          messageId,
          electionId: vote.electionId,
          nullifier: vote.nullifier,
        },
      };
    });

    await this.send({
      topic: this.config.topics.votesIncoming,
      messages,
    });

    return messageIds;
  }

  /**
   * Publish an audit event
   */
  async publishAuditEvent(
    event: Omit<AuditEventMessage, 'eventId' | 'timestamp' | 'dataHash'>
  ): Promise<string> {
    const eventId = uuidv4();
    const dataHash = this.hashData(event.data);

    const message: AuditEventMessage = {
      ...event,
      eventId,
      timestamp: Date.now(),
      dataHash,
    };

    await this.send({
      topic: this.config.topics.auditEvents,
      messages: [
        {
          key: `${event.entityType}:${event.entityId}`,
          value: JSON.stringify(message),
          headers: {
            eventId,
            action: event.action,
            entityType: event.entityType,
            entityId: event.entityId,
          },
        },
      ],
    });

    return eventId;
  }

  /**
   * Publish a Merkle tree update batch
   */
  async publishMerkleUpdate(
    update: Omit<MerkleUpdateMessage, 'batchId' | 'timestamp'>
  ): Promise<string> {
    const batchId = uuidv4();

    const message: MerkleUpdateMessage = {
      ...update,
      batchId,
      timestamp: Date.now(),
    };

    await this.send({
      topic: this.config.topics.merkleUpdates,
      messages: [
        {
          key: update.electionId,
          value: JSON.stringify(message),
          headers: {
            batchId,
            electionId: update.electionId,
            batchNumber: String(update.batchNumber),
          },
        },
      ],
    });

    return batchId;
  }

  /**
   * Send messages to Kafka with retry logic
   */
  private async send(record: ProducerRecord): Promise<RecordMetadata[]> {
    if (!this.isConnected) {
      await this.connect();
    }

    return this.producer.send(record);
  }

  /**
   * Simple hash for data integrity
   */
  private hashData(data: Record<string, unknown>): string {
    const str = JSON.stringify(data, Object.keys(data).sort());
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number }> {
    const start = Date.now();
    try {
      const admin = this.kafka.admin();
      await admin.connect();
      await admin.listTopics();
      await admin.disconnect();
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { healthy: false };
    }
  }
}

// Singleton instance
let producerInstance: KafkaProducerService | null = null;

export function getKafkaProducer(): KafkaProducerService {
  if (!producerInstance) {
    producerInstance = new KafkaProducerService();
  }
  return producerInstance;
}
