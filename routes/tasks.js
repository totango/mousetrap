const helpers = require('../helpers');
const logger = helpers.getLogger("rest-tasks"); // generate logger for 'rest-tasks' module
const tasksController = require('../controllers/tasks')
const jsend = require('jsend');
const db = require('../interfaces/database/db');
const storage = require('../interfaces/storage/storage');

const express = require('express')
const router = express.Router()

// route: GET /api/tasks
// desc: Returns the current task
// return the file being currently scanned if there is a scan happening
// or null if there is no scan
router.get('/', async (req, res) => {
    const tasks = await db.getDb().getTasks("PENDING", "SCANNING");

    let currentTask = null;
    if (tasksController.getCurrentTask())
        currentTask = tasks.filter(t => t.filePath === tasksController.getCurrentTask().filePath);

    const scanning = tasks.filter(t => t.scanState === "SCANNING");
    const pending = tasks.filter(t => t.scanState === "PENDING");

    return res.json(jsend.success({
        currentTask,
        scanning,
        pending
    }));
});


// route: GET /api/tasks/<filePath>
// desc: returns the status of the specific task
router.get('/:filePath*', async (req, res) => {
    const { filePath } = req.params;
    const fullPath = filePath + req.params[0]

    const task = await db.getDb().getTaskByFile(fullPath);

    if (!task)
        return res.sendStatus(404);

    return res.status(200).json(jsend.success({
        task
    }));
});

// route: POST /api/tasks
// desc: create a new task in db
router.post('/', async (req, res) => {
    const { filePath, notifyChannels } = req.body;
    if (!filePath)
        return res.status(400).json(jsend.fail({ message: "no 'filePath' in body", requestId: req.id }))

    const _logger = logger.child({ event: 'new_task_api', file: filePath });
    try {
        // 1. we check if the file exists in the bucket
        const stats = await storage.getStorage().getFileMetadata(filePath);
        // -> if object stats returned null, file doesn't exist - log it and stop processing
        if (stats === null) {
            _logger.error({ step: 'validate_file', success: false, error: { message: "File does not exist in specified location!" } })
            return res.status(422).json(jsend.fail({ message: helpers.errors.FILE_NOT_EXIST.message, code: helpers.errors.FILE_NOT_EXIST.code, requestId: req.id }))
        }
        _logger.debug({ step: 'validate_file', success: true })

        // 2. if file exists, we insert it into the db in `PENDING` state
        await db.getDb().createTask(filePath, "PENDING", stats.ContentLength / 1024 / 1024, stats.ETag, notifyChannels);
        _logger.info({ step: 'set_pending_in_db', success: true });

        return res.sendStatus(200);
    } catch (error) {
        _logger.info({ requestId: req.id, error: { message: error.message, code: error.code, stack: error.stack } })
        return res.sendStatus(500);
    }
});

module.exports = router