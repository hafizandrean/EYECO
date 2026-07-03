"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InferenceQueue = void 0;
const InferenceService_1 = require("./InferenceService");
class InferenceQueue {
    static queue = [];
    static maxQueueSize = 50;
    static minWorkers = 2;
    static maxWorkers = 8;
    static activeWorkers = 0;
    static workerIdSeq = 0;
    static accepting = true;
    // Observability metrics
    static droppedFramesCount = 0;
    static totalProcessedCount = 0;
    static busyWorkers = 0;
    static waitingTimes = [];
    static processedTimestamps = [];
    // Default priority to numeric weight mapping
    static priorityWeightsRecord = {
        CRITICAL: 100,
        HIGH: 80,
        NORMAL: 50,
        LOW: 20
    };
    /**
     * Initializes the minimum worker pool.
     */
    static startWorkers() {
        this.accepting = true;
        const workersToStart = Math.max(this.minWorkers - this.activeWorkers, 0);
        for (let i = 0; i < workersToStart; i++) {
            this.spawnWorker();
        }
    }
    /**
     * Enqueues a captured frame with a given priority/weight.
     * Leverages backpressure to drop the oldest frame of the lowest priority if overloaded.
     */
    static enqueue(frame, priority = 'NORMAL', customWeight) {
        if (!this.accepting) {
            return Promise.reject(new Error('SHUTTING_DOWN: Queue is not accepting new frames.'));
        }
        return new Promise((resolve, reject) => {
            const weight = customWeight !== undefined ? customWeight : (this.priorityWeightsRecord[priority] || 50);
            // Push item into the queue first so we can evaluate the entire set of items (including incoming)
            this.queue.push({
                frame,
                priority,
                priorityWeight: weight,
                resolve,
                reject,
                queuedAt: Date.now()
            });
            // Backpressure: if queue exceeds capacity, drop the oldest item of the lowest priority
            if (this.queue.length > this.maxQueueSize) {
                let dropIndex = -1;
                let minPriorityWeight = Infinity;
                let oldestQueuedAt = Infinity;
                for (let i = 0; i < this.queue.length; i++) {
                    const item = this.queue[i];
                    const itemWeight = item.priorityWeight;
                    if (itemWeight < minPriorityWeight) {
                        minPriorityWeight = itemWeight;
                        oldestQueuedAt = item.queuedAt;
                        dropIndex = i;
                    }
                    else if (itemWeight === minPriorityWeight) {
                        if (item.queuedAt < oldestQueuedAt) {
                            oldestQueuedAt = item.queuedAt;
                            dropIndex = i;
                        }
                    }
                }
                if (dropIndex !== -1) {
                    const [dropped] = this.queue.splice(dropIndex, 1);
                    if (dropped) {
                        this.droppedFramesCount++;
                        dropped.reject(new Error('QUEUE_OVERLOAD: Frame dropped due to backpressure.'));
                        console.warn(`[InferenceQueue] Backpressure triggered. Dropped frame from Camera #${dropped.frame.cameraId} (Priority: ${dropped.priority}, Weight: ${dropped.priorityWeight}, QueuedAt: ${new Date(dropped.queuedAt).toISOString()})`);
                    }
                }
            }
            // Sort queue so highest priority is at the end (for fast pop())
            // If priority weight matches, older frames processed first (FIFO: put older frames at the end)
            this.queue.sort((a, b) => {
                const weightDiff = a.priorityWeight - b.priorityWeight;
                if (weightDiff !== 0)
                    return weightDiff;
                return b.queuedAt - a.queuedAt;
            });
            // Dynamic scaling: spawn more workers if queue is piling up
            if (this.queue.length > 5 && this.activeWorkers < this.maxWorkers) {
                console.log(`[InferenceQueue] Queue size is ${this.queue.length}. Scaling up: spawning worker #${this.activeWorkers + 1}`);
                this.spawnWorker();
            }
        });
    }
    /**
     * Spawns a new worker thread/loop.
     */
    static spawnWorker() {
        this.workerIdSeq++;
        const workerId = this.workerIdSeq;
        this.activeWorkers++;
        (async () => {
            console.log(`[InferenceQueue] Worker #${workerId} spawned and listening.`);
            while (this.accepting || this.queue.length > 0) {
                if (this.queue.length === 0) {
                    // Dynamic scale-down: if idle and active workers exceed minWorkers, terminate this worker
                    if (this.activeWorkers > this.minWorkers) {
                        this.activeWorkers--;
                        console.log(`[InferenceQueue] Worker #${workerId} terminated due to idle queue (scaling down). Current active workers: ${this.activeWorkers}`);
                        return;
                    }
                    // Idle sleep
                    await new Promise(res => setTimeout(res, 200));
                    continue;
                }
                const item = this.queue.pop();
                if (!item)
                    continue;
                // Metric tracking: calculate wait time
                const waitingTime = Date.now() - item.queuedAt;
                this.waitingTimes.push(waitingTime);
                if (this.waitingTimes.length > 100)
                    this.waitingTimes.shift();
                try {
                    this.busyWorkers++;
                    const result = await InferenceService_1.InferenceService.executeInference(item.frame);
                    this.processedTimestamps.push(Date.now());
                    this.totalProcessedCount++;
                    item.resolve(result);
                }
                catch (err) {
                    item.reject(err);
                }
                finally {
                    this.busyWorkers--;
                }
            }
            this.activeWorkers--;
            console.log(`[InferenceQueue] Worker #${workerId} terminated gracefully.`);
        })();
    }
    /**
     * Gracefully shuts down the queue by stopping new frame intake and processing remains.
     */
    static async shutdown() {
        console.log('[InferenceQueue] Shutting down AI queue gracefully...');
        this.accepting = false;
        // Wait until queue is completely empty
        while (this.queue.length > 0 || this.activeWorkers > 0) {
            console.log(`[InferenceQueue] Waiting for queue to clear. Remaining items: ${this.queue.length}, Active workers: ${this.activeWorkers}`);
            await new Promise(res => setTimeout(res, 500));
        }
        console.log('[InferenceQueue] AI Queue completely cleared. Graceful shutdown finished.');
    }
    // Getter methods for metrics and observability
    static getQueueLength() {
        return this.queue.length;
    }
    static getActiveWorkers() {
        return this.activeWorkers;
    }
    static getBusyWorkers() {
        return this.busyWorkers;
    }
    static getFpsThroughput() {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        this.processedTimestamps = this.processedTimestamps.filter(t => t >= oneMinuteAgo);
        return parseFloat((this.processedTimestamps.length / 60).toFixed(2));
    }
    static getAverageWaitingTimeMs() {
        if (this.waitingTimes.length === 0)
            return 0;
        const sum = this.waitingTimes.reduce((a, b) => a + b, 0);
        return Math.round(sum / this.waitingTimes.length);
    }
    static getWorkerUtilization() {
        if (this.activeWorkers === 0)
            return 0;
        return parseFloat((this.busyWorkers / this.activeWorkers).toFixed(2));
    }
}
exports.InferenceQueue = InferenceQueue;
