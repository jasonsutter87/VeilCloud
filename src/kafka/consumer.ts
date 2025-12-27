/**
 * Kafka Consumer Service
 *
 * Handles consuming messages from Kafka topics.
 * Processes votes, audit events, and Merkle updates asynchronously.
 */

import {
  Kafka,
  Consumer,
  EachMessagePayload,
  KafkaMessage,
} from 'kafkajs';
import { getKafkaConfig, VeilCloudKafkaConfig } from './config.js';
import {
  VoteIncomingMessage,
  AuditEventMessage,
  MerkleUpdateMessage,
  DeadLetterMessage,
} from './topics.js';

export type MessageHandler<T> = (message: T, metadata: MessageMetadata) => Promise<void>;

export interface MessageMetadata {
  topic: string;
  partition: number;
  offset: string;
  timestamp: string;
  headers: Record<string, string>;
}

export interface ConsumerHandlers {
  onVote?: MessageHandler<VoteIncomingMessage>;
  onAuditEvent?: MessageHandler<AuditEventMessage>;
  onMerkleUpdate?: MessageHandler<MerkleUpdateMessage>;
  onError?: (error: Error, message: KafkaMessage, topic: string) => Promise<void>;
}

export class KafkaConsumerService {
  private kafka: Kafka;
  private consumer: Consumer;
  private config: VeilCloudKafkaConfig;
  private handlers: ConsumerHandlers = {};
  private isRunning: boolean = false;
  private deadLetterProducer: ReturnType<Kafka['producer']> | null = null;

  constructor(config?: VeilCloudKafkaConfig) {
    this.config = config || getKafkaConfig();
    this.kafka = new Kafka(this.config.kafka);
    this.consumer = this.kafka.consumer(this.config.consumer);
  }

  /**
   * Set message handlers
   */
  setHandlers(handlers: ConsumerHandlers): void {
    this.handlers = handlers;
  }

  /**
   * Connect and start consuming
   */
  async start(topics?: string[]): Promise<void> {
    if (this.isRunning) return;

    // Connect consumer
    await this.consumer.connect();
    console.log('[Kafka Consumer] Connected');

    // Connect DLQ producer
    this.deadLetterProducer = this.kafka.producer();
    await this.deadLetterProducer.connect();

    // Subscribe to topics
    const topicsToSubscribe = topics || [
      this.config.topics.votesIncoming,
      this.config.topics.auditEvents,
      this.config.topics.merkleUpdates,
    ];

    for (const topic of topicsToSubscribe) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
      console.log(`[Kafka Consumer] Subscribed to ${topic}`);
    }

    // Start consuming
    this.isRunning = true;
    await this.consumer.run({
      eachMessage: this.handleMessage.bind(this),
    });

    console.log('[Kafka Consumer] Started');
  }

  /**
   * Stop consuming
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;
    await this.consumer.stop();
    await this.consumer.disconnect();

    if (this.deadLetterProducer) {
      await this.deadLetterProducer.disconnect();
      this.deadLetterProducer = null;
    }

    console.log('[Kafka Consumer] Stopped');
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;

    const metadata: MessageMetadata = {
      topic,
      partition,
      offset: message.offset,
      timestamp: message.timestamp,
      headers: this.parseHeaders(message.headers),
    };

    try {
      const value = message.value?.toString();
      if (!value) {
        console.warn(`[Kafka Consumer] Empty message on ${topic}`);
        return;
      }

      const parsed = JSON.parse(value);

      // Route to appropriate handler
      switch (topic) {
        case this.config.topics.votesIncoming:
          if (this.handlers.onVote) {
            await this.handlers.onVote(parsed as VoteIncomingMessage, metadata);
          }
          break;

        case this.config.topics.auditEvents:
          if (this.handlers.onAuditEvent) {
            await this.handlers.onAuditEvent(parsed as AuditEventMessage, metadata);
          }
          break;

        case this.config.topics.merkleUpdates:
          if (this.handlers.onMerkleUpdate) {
            await this.handlers.onMerkleUpdate(parsed as MerkleUpdateMessage, metadata);
          }
          break;

        default:
          console.warn(`[Kafka Consumer] Unknown topic: ${topic}`);
      }
    } catch (error) {
      console.error(`[Kafka Consumer] Error processing message:`, error);

      // Send to dead letter queue
      await this.sendToDeadLetter(topic, message, error as Error);

      // Call error handler if provided
      if (this.handlers.onError) {
        await this.handlers.onError(error as Error, message, topic);
      }
    }
  }

  /**
   * Send failed message to dead letter queue
   */
  private async sendToDeadLetter(
    originalTopic: string,
    message: KafkaMessage,
    error: Error
  ): Promise<void> {
    if (!this.deadLetterProducer) return;

    const dlqMessage: DeadLetterMessage = {
      originalTopic,
      originalMessage: message.value?.toString()
        ? JSON.parse(message.value.toString())
        : null,
      error: {
        message: error.message,
        stack: error.stack,
        code: (error as NodeJS.ErrnoException).code,
      },
      retryCount: parseInt(
        this.parseHeaders(message.headers)['retryCount'] || '0'
      ),
      failedAt: Date.now(),
    };

    try {
      await this.deadLetterProducer.send({
        topic: this.config.topics.deadLetter,
        messages: [
          {
            key: message.key,
            value: JSON.stringify(dlqMessage),
            headers: {
              ...message.headers,
              originalTopic,
              errorMessage: error.message,
            },
          },
        ],
      });
      console.log(`[Kafka Consumer] Sent to DLQ: ${originalTopic}`);
    } catch (dlqError) {
      console.error('[Kafka Consumer] Failed to send to DLQ:', dlqError);
    }
  }

  /**
   * Parse message headers to string map
   */
  private parseHeaders(
    headers?: Record<string, Buffer | string | undefined>
  ): Record<string, string> {
    const result: Record<string, string> = {};
    if (!headers) return result;

    for (const [key, value] of Object.entries(headers)) {
      if (value) {
        result[key] = Buffer.isBuffer(value) ? value.toString() : value;
      }
    }
    return result;
  }

  /**
   * Get consumer lag for monitoring
   */
  async getLag(): Promise<Map<string, number>> {
    const admin = this.kafka.admin();
    await admin.connect();

    try {
      const topics = [
        this.config.topics.votesIncoming,
        this.config.topics.auditEvents,
        this.config.topics.merkleUpdates,
      ];

      const lag = new Map<string, number>();

      for (const topic of topics) {
        const offsets = await admin.fetchTopicOffsets(topic);
        const consumerOffsets = await admin.fetchOffsets({
          groupId: this.config.consumer.groupId,
          topics: [topic],
        });

        let totalLag = 0;
        for (const partition of offsets) {
          const consumerOffset = consumerOffsets
            .find((t) => t.topic === topic)
            ?.partitions.find((p) => p.partition === partition.partition);

          if (consumerOffset) {
            totalLag += parseInt(partition.offset) - parseInt(consumerOffset.offset);
          }
        }

        lag.set(topic, totalLag);
      }

      return lag;
    } finally {
      await admin.disconnect();
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    lag?: Map<string, number>;
    error?: string;
  }> {
    try {
      const lag = await this.getLag();
      const maxLag = Math.max(...lag.values());

      // Unhealthy if lag > 10000 messages
      const healthy = maxLag < 10000;

      return { healthy, lag };
    } catch (error) {
      return {
        healthy: false,
        error: (error as Error).message,
      };
    }
  }
}

// Singleton instance
let consumerInstance: KafkaConsumerService | null = null;

export function getKafkaConsumer(): KafkaConsumerService {
  if (!consumerInstance) {
    consumerInstance = new KafkaConsumerService();
  }
  return consumerInstance;
}
