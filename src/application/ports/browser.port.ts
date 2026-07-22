export interface BrowserPort {
  start(): Promise<void>;
  extract(url: string): Promise<{ html: string }>;
  stop(): Promise<void>;
}
