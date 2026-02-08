/**
 * Configuration with Zod validation
 * All environment variables and paths are centralized here
 */

import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

/**
 * Safely get project root in ESM
 */
function getProjectRoot(): string {
  if (process.env.NODE_ENV === 'test') {
    return process.cwd();
  }
  try {
    // eslint-disable-next-line no-eval
    const importMeta = eval('import.meta');
    const filePath = fileURLToPath(importMeta.url);
    return path.resolve(path.dirname(filePath), '..');
  } catch {
    return process.cwd();
  }
}

/**
 * Configuration schema with validation
 */
const ConfigSchema = z.object({
  // Environment
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  isDev: z.boolean(),
  isTest: z.boolean(),
  isProd: z.boolean(),

  // Paths
  projectRoot: z.string(),
  resourcesPath: z.string(),
  templatesPath: z.string(),
  generatedPath: z.string(),
  logsPath: z.string(),

  // Gmail
  gmail: z.object({
    clientId: z.string().min(1, 'GMAIL_CLIENT_ID required'),
    clientSecret: z.string().min(1, 'GMAIL_CLIENT_SECRET required'),
    redirectUri: z.string().url(),
    labelName: z.string().default('Job Alerts'),
    topicName: z.string(),
  }),

  // Webhook
  webhook: z.object({
    port: z.number().int().min(1000).max(65535),
    path: z.string().startsWith('/'),
  }),

  // Feature flags
  features: z.object({
    notifications: z.boolean().default(true),
    tui: z.boolean().default(true),
    logging: z.boolean().default(true),
  }),

  // Operational mode
  mode: z.enum(['data-testing', 'data-listening']).default('data-listening'),
  
  // Input source (for data-testing mode)
  dataSource: z.object({
    type: z.enum(['db', 'webhook']).default('webhook'),
    dbPath: z.string().optional(),
    batchSize: z.number().int().min(1).default(10),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Load and validate configuration
 * @throws {Error} If validation fails
 */
export function loadConfig(): Config {
  const nodeEnv = (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test';
  const projectRoot = getProjectRoot();

  const rawConfig = {
    nodeEnv,
    isDev: nodeEnv === 'development',
    isTest: nodeEnv === 'test',
    isProd: nodeEnv === 'production',

    projectRoot,
    resourcesPath: path.join(projectRoot, process.env.RESOURCES_PATH || 'resources'),
    templatesPath: path.join(projectRoot, process.env.TEMPLATES_PATH || 'templates'),
    generatedPath: path.join(projectRoot, process.env.GENERATED_PATH || 'generated'),
    logsPath: path.join(projectRoot, process.env.LOGS_PATH || 'logs'),

    gmail: {
      clientId: process.env.GMAIL_CLIENT_ID || '',
      clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
      redirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/oauth2callback',
      labelName: process.env.GMAIL_LABEL_NAME || 'Job Alerts',
      topicName: process.env.GMAIL_TOPIC_NAME || '',
    },

    webhook: {
      port: parseInt(process.env.WEBHOOK_PORT || '3000', 10),
      path: process.env.WEBHOOK_PATH || '/webhook/gmail',
    },

    features: {
      notifications: process.env.FEATURE_NOTIFICATIONS !== 'false',
      tui: process.env.FEATURE_TUI !== 'false',
      logging: process.env.FEATURE_LOGGING !== 'false',
    },

    mode: (process.env.OPERATIONAL_MODE as 'data-testing' | 'data-listening') || 'data-listening',
    
    dataSource: {
      type: (process.env.DATA_SOURCE_TYPE as 'db' | 'webhook') || 'webhook',
      dbPath: process.env.DATA_SOURCE_DB_PATH || path.join(projectRoot, 'src', 'db', 'emails'),
      batchSize: parseInt(process.env.DATA_SOURCE_BATCH_SIZE || '10', 10),
    },
  };

  try {
    return ConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Configuration validation failed:');
      error.errors.forEach((err) => {
        console.error(`  ${err.path.join('.')}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
}

// Export singleton instance
export const config = loadConfig();
