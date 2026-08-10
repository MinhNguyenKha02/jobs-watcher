import { MongoClient } from 'mongodb';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('MongoConnector');

export class MongoConnector {
  private client: MongoClient;

  constructor(private _mongoUri: string) {
    this.client = new MongoClient(this._mongoUri);
  }
  async connect(): Promise<void> {
    await this.client.connect();
    logger.info('MongoDB connected');
  }
  get clientInstance(): MongoClient {
    return this.client;
  }
  async disconnect(): Promise<void> {
    await this.client.close();
    logger.info('MongoDB disconnected');
  }
}
