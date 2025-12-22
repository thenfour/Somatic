export type LogLevel = "info"|"warn"|"error";

export interface LoggerOptions {
   indentSize?: number;
   now?: () => number; // possible to mock
   sink?: (level: LogLevel, line: string, ...args: any[]) => void;
}

export class Logger {
   private indentLevel = 0;
   private indentSize: number;
   private readonly now: () => number;
   private readonly sink: (level: LogLevel, line: string, ...args: any[]) => void;

   constructor(options: LoggerOptions = {}) {
      this.indentSize = options.indentSize ?? 2;
      this.now = options.now ?? (() => performance.now());
      this.sink = options.sink ?? ((level, line, ...args) => {
                     if (level === "warn") {
                        console.warn(line, ...args);
                     } else if (level === "error") {
                        console.error(line, ...args);
                     } else {
                        console.log(line, ...args);
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

   private incIndent(): void {
      this.indentLevel++;
   }

   private decIndent(): void {
      this.indentLevel = Math.max(this.indentLevel - 1, 0);
   }

   private write(level: LogLevel, message: string, ...args: any[]): void {
      const line = `[${this.getTimestamp()}] ${this.getIndent()}${message}`;
      this.sink(level, line, ...args);
   }

   private getTimestamp(): string {
      const d = new Date(this.now());
      const pad = (n: number, width: number = 2) => n.toString().padStart(width, "0");
      const h = pad(d.getHours());
      const m = pad(d.getMinutes());
      const s = pad(d.getSeconds());
      const ms = pad(d.getMilliseconds(), 3);
      return `${h}:${m}:${s}.${ms}`;
   }

   info(message: string, ...args: any[]): void {
      this.write("info", message, ...args);
   }

   warn(message: string, ...args: any[]): void {
      this.write("warn", message, ...args);
   }

   error(message: string, ...args: any[]): void {
      this.write("error", message, ...args);
   }

   // one way to do raii-kinda logging is to run the inner block in a transaction-like way
   //    log.scope("user inserted note", async () => {
   //       log.scope(
   //          "auto-save scheduled",
   //          () => {
   //             // ...
   //          });

   //       await log.scope(
   //          "auto-save flush",
   //          async () => {
   //             // commit...
   //          });

   //       log.scope("user pressed key", () => {});
   //    });
   scope<T>(name: string, fn: () => T | Promise<T>): T|Promise<T> {
      this.info(`{ ${name}`);
      this.incIndent();

      const start = performance.now();

      try {
         const r = fn();

         if (r && typeof (r as any).then === "function") {
            return (r as Promise<T>).finally(() => {
               this.decIndent();
               const ms = performance.now() - start;
               this.info(`} ${name} (${ms.toFixed(1)}ms)`);
            });
         }

         this.decIndent();
         const ms = performance.now() - start;
         this.info(`} ${name} (${ms.toFixed(1)}ms)`);
         return r;
      } catch (e) {
         this.decIndent();
         const ms = performance.now() - start;
         this.info(`} ${name} FAILED (${ms.toFixed(1)}ms)`);
         throw e;
      }
   }

   // or if you need separate begin / end routines
   // const ls = log.begin("auto-save flush");
   // try {
   //   // ...
   // } finally {
   //   ls.end();
   // }
   begin(name: string) {
      this.info(name);
      this.incIndent();
      const start = performance.now();
      let ended = false;

      return {
         end: (suffix?: string) => {
            if (ended)
               return;
            ended = true;
            this.decIndent();
            const ms = performance.now() - start;
            this.info(`} ${name}${suffix ? " " + suffix : ""} (${ms.toFixed(1)}ms)`);
         },
      };
   }
}

// global for simplicity
export const gLog = new Logger();
