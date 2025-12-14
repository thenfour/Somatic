export class AsyncMutex {
    private locked = false;
    private queue: Array<() => void> = [];

    async acquire(): Promise<() => void> {
        return new Promise((resolve) => {
            const tryAcquire = () => {
                if (!this.locked) {
                    this.locked = true;
                    resolve(this.makeRelease());
                    return;
                }
                this.queue.push(() => {
                    this.locked = true;
                    resolve(this.makeRelease());
                });
            };

            tryAcquire();
        });
    }

    private makeRelease(): () => void {
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const next = this.queue.shift();
            if (next) {
                next();
            } else {
                this.locked = false;
            }
        };
    }

    async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
        const release = await this.acquire();
        try {
            return await fn();
        } finally {
            release();
        }
    }
}
