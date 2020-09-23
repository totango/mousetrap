const helpers = require('../../helpers');
const logger = helpers.getLogger("tasks-controller"); // generate logger for 'tasks-controller' module
const AWS = require('aws-sdk');
const eventEmitter = require('../../interfaces/eventEmitter');
const config = require('config');
const Prometheus = require('prom-client');
const Timeout = require('await-timeout');

const storage = require('../../interfaces/storage/storage');
const db = require('../../interfaces/database/db');
const queue = require('../../interfaces/queue/queue');
const notifier = require('../../interfaces/notifier/notifier');
const scanner = require('../../scanner');

const dbPollsMetric = new Prometheus.Counter({
    name: 'mousetrap_db_poll_count',
    help: 'The number of db polls executed'
});

const scanCountMetric = new Prometheus.Counter({
    name: 'mousetrap_scan_count',
    help: 'The number of scans attempted - both successful and failed',
    labelNames: ['status', 'result']
});

const scanRetriesMetric = new Prometheus.Counter({
    name: 'mousetrap_scan_retries',
    help: 'The number of retried scan attempts',
    labelNames: ['status']
});

const pendingTasksMetric = new Prometheus.Gauge({
    name: 'mousetrap_pending_tasks_count',
    help: 'The number of pending tasks'
});

const pendingTasksSizeMetric = new Prometheus.Gauge({
    name: 'mousetrap_pending_tasks_size_mb',
    help: 'The size sum of all pending tasks in Megabytes'
});

const tasksSizeHistogram = new Prometheus.Histogram({
    name: 'mousetrap_tasks_size_mb',
    help: 'A histogram of file sizes',
    buckets: [1, 10, 100, 1000, 5000, 10000]
});

const scanDurationHistogram = new Prometheus.Histogram({
    name: 'mousetrap_scan_duration_seconds',
    help: 'A histogram of scan durations',
    buckets: [1, 5, 10, 30, 60, 120, 180, 300, 600, 900, 1800, 3600]
});

/*
Responsibilities:
1. inserting scan tasks from pending-tasks queue to db in state `PENDING`
2. querying db for tasks in `PENDING` state, choosing 1 task and scanning it's file
3. finding tasks that are still scanning but passed timeout and re-entering them to be scanned again
*/
let currentTask = undefined;

const pollingInterval = config.get('general.pollingInterval') * 1000;
const markStaleAfter = config.get('general.markStaleAfter') * 1000;
const scanTimeout = config.get('general.scanTimeout') * 1000;
const maxScanAttempts = config.get('general.maxScanAttempts'); // TODO implement max scans


let stopCheck = false;
const pollingTimer = new Timeout();

const initialize = async () => {
    eventEmitter.on('queue-message', onQueueMessage);

    const _logger = logger.child({ event: "initialization" });
    storage.initialize();
    _logger.info({ step: "creating_storage_agent", success: true });

    db.initialize();
    _logger.info({ step: "creating_db_agent", success: true });

    queue.initialize();
    if (!queue.getQueue()) {
        _logger.info({ step: "creating_queue_agent", success: false, msg: "Consider using a queue for better resiliency." });
    } else {
        _logger.info({ step: "creating_queue_agent", success: true });
        queue.getQueue().listen();
    }

    notifier.initialize();
    _logger.info({ step: "creating_notifier_agent", success: true });

    checkDb();
}

// graceful shutdown sets whichever task is currently being scanned to pending state for later scanning
const shutdown = async () => {
    logger.warn({ msg: "Received shutdown request." })
    if (currentTask) {
        logger.info({ msg: "There is a task in progress - setting it's status back to pending.", file: currentTask.filePath });
        await db.getDb().setPending(currentTask.filePath)
        logger.info({ msg: "Task successfuly set back to pending status", file: currentTask.filePath });
    }

    stopCheck = true;
    pollingTimer.clear();
}

const getCurrentTask = () => {
    return currentTask;
}


/*
When a new message is received from the queue, it is immeditately inserted
in to the db in `PENDING` state, it is then up to the db polling job to see there
are pending tasks in the db, and throttle the polling, scan the file and then
immediately query the db for the next pending item - it continues to do so until there 
are no more pending items in the db, and waits for new tasks.
*/

// this function is fired when a message from the queue has been validated
// 'message' is an already parsed json object
const onQueueMessage = async (message) => {
    const _logger = logger.child({ event: 'new_task_in_queue', file: message.filePath });
    try {
        // 1. we check if the file exists in the bucket
        const stats = await storage.getStorage().getFileMetadata(message.filePath);

        // -> if object stats returned null, file doesn't exist - log it and stop processing
        if (stats === null) {
            const taskCompleteTs = Date.now();
            await notifier.notifyErrorAll(message.filePath, helpers.errors.FILE_NOT_EXIST.code, helpers.errors.FILE_NOT_EXIST.message, taskCompleteTs, message.notifyChannels);
            await queue.getQueue().deleteMessage(message._rawMessage);
            _logger.error({ step: 'validate_file', success: false, error: { message: "File does not exist in specified location! Skipping..." } });
            return;
        }
        _logger.debug({ step: 'validate_file', success: true })

        // 2. if file exists, we insert it into the db in `PENDING` state
        await db.getDb().createTask(message.filePath, scanner.PENDING, stats.ContentLength / 1024 / 1024, stats.ETag, message.notifyChannels);
        _logger.info({ step: 'set_pending_in_db', success: true });

        // 3. if the insert succeeded, we can now safely delete the message from the queue
        try {
            await queue.getQueue().deleteMessage(message._rawMessage);
            _logger.info({ step: 'delete_task_from_queue', success: true, file: message.filePath })
        } catch (error) {
            _logger.error({ step: 'delete_task_from_queue', success: false, msg: "Encountered an error while attempting to delete message from queue.", message: message, error: { message: error.message, code: error.code, stack: error.stack } })
        }
    } catch (error) {
        _logger.error({ message: message, success: false, msg: "Encountered an error while creating task in db.", error: { message: error.message, code: error.code, stack: error.stack } })
    }
}


// poll the database perioudically - return all PENDING & SCANNING tasks
const checkDb = async () => {
    const _logger = logger.child({ event: "db_check" });
    let timeoutSeconds = pollingInterval;

    try {
        if (stopCheck)
            return;

        dbPollsMetric.inc();
        const tasks = await db.getDb().getTasks("PENDING", "SCANNING");
        const pendingTasks = tasks.filter(t => t.scanState === "PENDING");

        if (currentTask) {
            timeoutSeconds = pollingInterval * 5;
            _logger.debug({ step: 'throttle_poll_rate', msg: 'Scan currently ongoing, increasing poll interval.', nextCheckIn: `${timeoutSeconds}ms` });
        } else {
            checkForNextTask(pendingTasks);
        }

        houseKeep(tasks);


    } catch (error) {
        if (error.code === "ResourceNotFoundException") {
            _logger.error({ msg: "Database specified in configuration does not exist" });
            process.exit(1);
        }

        _logger.error({ msg: "If you're seeing this error, it means something went horribly wrong with the tasks db", error: { message: error.message, code: error.code, stack: error.stack } });
    } finally {
        await pollingTimer.set(timeoutSeconds);
        return await checkDb();
    }
}


const houseKeep = async (tasks) => {
    const _logger = logger.child({ event: 'house_keep_tasks' });
    const pendingTasks = tasks.filter(t => t.scanState === "PENDING");

    try {
        pendingTasksMetric.set(pendingTasks.length);
        updatePendingTasksSizeMetric(pendingTasks);
        await checkForStaleTasks(tasks);
    } catch (error) {
        _logger.error({ success: false, error: { message: error.message, code: error.code, stack: error.stack } });
    }
}


// When a task is stale, it means it's worker died unexpectedly and the task
// is stuck in SCANNING status in the db. This function checks which tasks are stale
// (ones that have been in SCANNING status for a certain duration) and sets them back
// to PENDING status
const checkForStaleTasks = async (tasks) => {
    const _logger = logger.child({ event: 'check_stale_tasks' });
    const scanningTasks = tasks.filter(t => t.scanState === "SCANNING");

    try {
        for (task of scanningTasks) {
            if (Date.now() > task.scanStartTs + markStaleAfter) {
                await db.getDb().setPending(task.filePath, false);
                _logger.info({ step: 'mark_pending', msg: `Task '${task.filePath}' is stale, returning it to pending state.`, file: task.filePath, success: true })
            }
        }
    } catch (error) {
        _logger.error({ step: 'mark_stale', success: false, error: { message: error.message, code: error.code, stack: error.stack } });
    }
}

const updatePendingTasksSizeMetric = (tasks) => {
    const pendingSize = tasks.reduce((sum, task) => sum += task.sizeMb, 0);
    pendingTasksSizeMetric.set(pendingSize || 0);
}


const checkForNextTask = async (pendingTasks) => {
    const _logger = logger.child({ event: 'check_next_task' });

    try {
        // 1. if there are no pending tasks, return
        if (pendingTasks.length === 0) return;

        // 2. pending tasks are already sorted by ascending creation date, so first item is oldest task
        const selectedTask = pendingTasks[0];
        const file = selectedTask.filePath

        // 3. check if everything is ok with the task before starting scan
        // checks things like if the file exists in the bucket / if it's not already being
        // scanned by another worker
        const updatedTask = await prepareFileForScanning(selectedTask);
        if (!updatedTask) {
            _logger.info({ msg: "File was not ready to be scanned, aborting...", file });
            return;
        }
        currentTask = updatedTask;

        // 4. update the pending tasks metrics
        pendingTasksMetric.set(pendingTasks.slice(1).length); // remove the current task since its no longer pending
        updatePendingTasksSizeMetric(pendingTasks.slice(1));

        // 5. finally, we scan the file and handle the result
        const scanResults = await scanFile(file);
        await handleScanSuccess(currentTask, scanResults);
    } catch (error) {
        _logger.error({ success: false, error: { message: error.message, code: error.code, stack: error.stack } });
        await handleScanFailure(currentTask);
    } finally {
        currentTask = undefined;
    }
}


const prepareFileForScanning = async (task) => {
    const file = task.filePath;
    const _logger = logger.child({ event: 'prepare_file_for_scanning', file: task.filePath });

    try {
        // 1. check if the file exists in the bucket
        const stats = await storage.getStorage().getFileMetadata(file);
        // -> if object stats returned null, file doesn't exist - log it and stop processing
        if (stats === null) {
            const taskCompleteTs = Date.now();
            await notifier.notifyErrorAll(file, helpers.errors.FILE_NOT_EXIST.code, helpers.errors.FILE_NOT_EXIST.message, taskCompleteTs, task.notifyChannels);
            _logger.error({ step: 'validate_file', success: false, error: { message: "File does not exist in specified location! Skipping..." } })
            return false;
        }

        // 2. set the task state to scanning in db
        const task = await db.getDb().setScanning(file);
        _logger.debug({ step: 'set_scanning_in_db', success: true });

        return task;
    } catch (error) {
        if (error.code === "ItemAlreadyBeingScanned") {
            _logger.warn({ step: 'set_scanning_in_db', msg: "Encountered race condition. Attempted to scan an item already being scanned!" });
            return null;
        }

        _logger.error({ success: false, msg: "Encountered an error while preparing file for scanning.", error: { message: error.message, code: error.code, stack: error.stack } });
        return null;
    }
}


const scanFile = async (file) => {
    const _logger = logger.child({ event: 'scan_file', file });

    try {
        _logger.info({ step: "scan_start" });
        const scanResults = await helpers.runWithTimeout(scanTimeout,
            scanner.scanStream(storage.getStorage().streamFile(file)),
            `Reached timeout while scanning`
        );

        if (scanResults === null)
            throw new Error("File could not be scanned");

        _logger.info({ step: "scan_end" });
        scanCountMetric.labels('successful', scanResults.is_infected ? 'infected' : 'clean').inc();

        return scanResults;
    } catch (error) {
        scanCountMetric.labels('failed', 'failed').inc();
        throw error;
    }
}


const handleScanSuccess = async (task, scanResults) => {
    const _logger = logger.child({ event: 'task_scan_success', file: task.filePath });
    const _task = task;
    const taskCompleteTs = Date.now();
    const taskResult = scanResults.is_infected ? "INFECTED" : "CLEAN";

    try {
        // 1. set task state to finished in db
        await db.getDb().setFinished(_task.filePath, taskResult, scanResults.viruses, taskCompleteTs);

        // 2. add result tags to the file in bucket
        await storage.getStorage().addFileTags(_task.filePath, taskResult, taskCompleteTs);

        // 3. optionally send a notification
        await notifier.notifyAll(_task.filePath, taskResult, scanResults.viruses, taskCompleteTs, _task.notifyChannels);
        logger.info({ step: 'notify', success: true });

        tasksSizeHistogram.observe(_task.sizeMb);
        scanDurationHistogram.observe((taskCompleteTs - _task.scanStartTs) / 1000);
        _logger.debug({ step: 'mark_completed', success: true });
    } catch (error) {
        _logger.error({ step: 'mark_completed', success: false, msg: "Encountered an error while attempting to mark task as completed.", error: { message: error.message, code: error.code, stack: error.stack } });
    }
}


const handleScanFailure = async (task) => {
    const _logger = logger.child({ event: 'task_scan_failure', file: task.filePath });
    const _task = task;
    const taskCompleteTs = Date.now();
    const taskResult = "FAILED";

    try {
        // 1. set task state to finished in db
        await db.getDb().setFailed(_task.filePath);

        // 2. add result tags to the file in bucket
        await storage.getStorage().addFileTags(_task.filePath, taskResult, taskCompleteTs);

        // 3. optionally send a notification
        await notifier.notifyAll(_task.filePath, taskResult, null, taskCompleteTs, _task.notifyChannels);
        logger.info({ step: 'notify', success: true });

        _logger.debug({ step: 'mark_failed', success: true, file: _task.filePath });
    } catch (error) {
        _logger.error({ step: 'mark_failed', success: false, msg: "Encountered an error while attempting to mark task as failed.", error: { message: error.message, code: error.code, stack: error.stack } });
    }
}

module.exports = {
    initialize,
    shutdown,
    getCurrentTask
}