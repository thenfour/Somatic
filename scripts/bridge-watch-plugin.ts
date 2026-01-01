// Webpack plugin that watches bridge/ directory and rebuilds bridge.tic when bridge.lua changes.

import path from "path";
import buildBridge, {buildBridge as buildBridgeNamed} from "./build-bridge";

type BridgeWatchOptions = {
   bridgeDir?: string;
   debounceMs?: number;
};

export class BridgeWatchPlugin {
   private bridgeDir: string;
   private lastBuildTime: number;
   private debounceMs: number;

   constructor(options: BridgeWatchOptions = {}) {
      this.bridgeDir = options.bridgeDir || path.resolve(__dirname, "../bridge");
      this.lastBuildTime = 0;
      this.debounceMs = options.debounceMs || 300;
   }

   apply(compiler: any) {
      const pluginName = "BridgeWatchPlugin";

      // Build once at startup
      compiler.hooks.beforeRun.tapAsync(pluginName, (_compiler: any, callback: () => void) => {
         this.rebuild("initial build");
         callback();
      });

      // Also build at startup in watch mode
      compiler.hooks.watchRun.tapAsync(pluginName, (comp: any, callback: () => void) => {
         const changedFiles = comp.modifiedFiles || new Set();
         const removedFiles = comp.removedFiles || new Set();
         const allChanges = new Set([...changedFiles, ...removedFiles]);

         const bridgeChanged =
            [...allChanges].some((f: unknown) => typeof f === "string" && f.startsWith(this.bridgeDir));

         if (bridgeChanged || this.lastBuildTime === 0) {
            this.rebuild(bridgeChanged ? "bridge.lua changed" : "initial watch build");
         }

         callback();
      });

      // Add bridge directory to watched paths
      compiler.hooks.afterCompile.tap(pluginName, (compilation: any) => {
         compilation.contextDependencies.add(this.bridgeDir);
      });
   }

   rebuild(reason: string) {
      const now = Date.now();
      if (now - this.lastBuildTime < this.debounceMs) {
         return; // Debounce rapid changes
      }
      this.lastBuildTime = now;

      console.log(`\n[BridgeWatchPlugin] Rebuilding bridge.tic (${reason})...`);
      try {
         // buildBridge default export and named export kept for flexibility
         (buildBridgeNamed || buildBridge)();
         console.log("[BridgeWatchPlugin] bridge.tic rebuilt successfully\n");
      } catch (err: any) {
         console.error("[BridgeWatchPlugin] Failed to build bridge.tic:", err?.message || err);
      }
   }
}

export default BridgeWatchPlugin;
