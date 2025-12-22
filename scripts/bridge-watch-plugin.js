// Webpack plugin that watches bridge/ directory and rebuilds bridge.tic when bridge.lua changes.

const path = require('path');
const { buildBridge } = require('./build-bridge.js');

class BridgeWatchPlugin {
    constructor(options = {}) {
        this.bridgeDir = options.bridgeDir || path.resolve(__dirname, '../bridge');
        this.lastBuildTime = 0;
        this.debounceMs = options.debounceMs || 300;
    }

    apply(compiler) {
        const pluginName = 'BridgeWatchPlugin';

        // Build once at startup
        compiler.hooks.beforeRun.tapAsync(pluginName, (compiler, callback) => {
            this.rebuild('initial build');
            callback();
        });

        // Also build at startup in watch mode
        compiler.hooks.watchRun.tapAsync(pluginName, (compiler, callback) => {
            const changedFiles = compiler.modifiedFiles || new Set();
            const removedFiles = compiler.removedFiles || new Set();
            const allChanges = new Set([...changedFiles, ...removedFiles]);
            
            const bridgeChanged = [...allChanges].some(f => f.startsWith(this.bridgeDir));
            
            if (bridgeChanged || this.lastBuildTime === 0) {
                this.rebuild(bridgeChanged ? 'bridge.lua changed' : 'initial watch build');
            }
            
            callback();
        });

        // Add bridge directory to watched paths
        compiler.hooks.afterCompile.tap(pluginName, (compilation) => {
            compilation.contextDependencies.add(this.bridgeDir);
        });
    }

    rebuild(reason) {
        const now = Date.now();
        if (now - this.lastBuildTime < this.debounceMs) {
            return; // Debounce rapid changes
        }
        this.lastBuildTime = now;

        console.log(`\n[BridgeWatchPlugin] Rebuilding bridge.tic (${reason})...`);
        try {
            buildBridge();
            console.log('[BridgeWatchPlugin] bridge.tic rebuilt successfully\n');
        } catch (err) {
            console.error('[BridgeWatchPlugin] Failed to build bridge.tic:', err.message);
        }
    }
}

module.exports = { BridgeWatchPlugin };
