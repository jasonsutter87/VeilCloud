/**
 * Kafka Configuration
 *
 * Configuration for Kafka message queue integration.
 * Enables async vote ingestion at 100K+ votes/sec.
 */

import { KafkaConfig, ProducerConfig, ConsumerConfig } from 'kafkajs';

export interface VeilCloudKafkaConfig {
  kafka: KafkaConfig;
  producer: ProducerConfig;
  consumer: ConsumerConfig & { groupId: string };
  topics: {
    votesIncoming: string;
    auditEvents: string;
    merkleUpdates: string;
    deadLetter: string;
  };
}

/**
 * Get Kafka configuration from environment
 */
export function getKafkaConfig(): VeilCloudKafkaConfig {
  const brokers = process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'];

  return {
    kafka: {
      clientId: process.env.KAFKA_CLIENT_ID || 'veilcloud',
      brokers,
      ssl: process.env.KAFKA_SSL === 'true',
      sasl:
        process.env.KAFKA_SASL_USERNAME && process.env.KAFKA_SASL_PASSWORD
          ? {
              mechanism: 'plain',
              username: process.env.KAFKA_SASL_USERNAME,
              password: process.env.KAFKA_SASL_PASSWORD,
            }
          : undefined,
      connectionTimeout: parseInt(process.env.KAFKA_CONNECTION_TIMEOUT || '10000'),
      requestTimeout: parseInt(process.env.KAFKA_REQUEST_TIMEOUT || '30000'),
      retry: {
        initialRetryTime: 100,
        retries: 8,
        maxRetryTime: 30000,
        factor: 2,
      },
    },

    producer: {
      allowAutoTopicCreation: false,
      idempotent: true,
      maxInFlightRequests: 5,
      transactionTimeout: 60000,
    },

    consumer: {
      groupId: process.env.KAFKA_CONSUMER_GROUP || 'veilcloud-workers',
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxBytesPerPartition: 1048576, // 1MB
      minBytes: 1,
      maxBytes: 10485760, // 10MB
      maxWaitTimeInMs: 5000,
    },

    topics: {
      votesIncoming: process.env.KAFKA_TOPIC_VOTES || 'veilcloud.votes.incoming',
      auditEvents: process.env.KAFKA_TOPIC_AUDIT || 'veilcloud.audit.events',
      merkleUpdates: process.env.KAFKA_TOPIC_MERKLE || 'veilcloud.merkle.updates',
      deadLetter: process.env.KAFKA_TOPIC_DLQ || 'veilcloud.dead-letter',
    },
  };
}

/**
 * Default configuration for development
 */
export const defaultKafkaConfig = getKafkaConfig();
