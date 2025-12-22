export type LogLevel = "info"|"warn"|"error";

export interface LoggerOptions {
   indentSize?: number;
   now?: () => number; // possible to mock
   sink?: (level: LogLevel, line: string) => void;
}

export class Logger {
   private indentLevel = 0;
   private indentSize: number;
   private readonly now: () => number;
   private readonly sink: (level: LogLevel, line: string) => void;

   constructor(options: LoggerOptions = {}) {
      this.indentSize = options.indentSize ?? 2;
      this.now = options.now ?? (() => performance.now());
      this.sink = options.sink ?? ((level, line) => {
                     if (level === "warn") {
                        console.warn(line);
                     } else if (level === "error") {
                        console.error(line);
                     } else {
                        console.log(line);
                     }
                  });
   }

   setIndentSize(size: number): void {
      if (size >= 0 && Number.isFinite(size)) {
         this.indentSize = size;
      }
   }

   private getIndent(): string {
      if (this.indentSize <= 0 || this.indentLevel <= 0) {
         return "";
      }
      return " ".repeat(this.indentLevel * this.indentSize);
   }

   private write(level: LogLevel, message: string): void {
      const line = this.getIndent() + message;
      this.sink(level, line);
   }

   log(message: string): void {
      this.write("info", message);
   }

   warn(message: string): void {
      this.write("warn", message);
   }

   error(message: string): void {
      this.write("error", message);
   }

   /*
    one way to do raii-kinda logging is to run the inner block in a transaction-like way
   */
   async scope<T>(label: string, fn: () => T | Promise<T>, level: LogLevel = "info"): Promise<T> {
      const startedAt = this.now();

      this.write(level, `{ ${label}`);
      this.indentLevel++;

      const result = await fn();
      const elapsedMs = Math.round(this.now() - startedAt);

      this.indentLevel = Math.max(this.indentLevel - 1, 0);
      this.write(level, `} ${label} (${elapsedMs}ms)`);
      return result;
   }
}

// global for simplicity
export const gLog = new Logger();
