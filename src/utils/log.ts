import type { LogSink } from "../contracts";

export class Logger implements LogSink {
  info(message: string): void {
    console.log(`[info] ${message}`);
  }

  warn(message: string): void {
    console.warn(`[warn] ${message}`);
  }

  error(message: string): void {
    console.error(`[error] ${message}`);
  }
}
