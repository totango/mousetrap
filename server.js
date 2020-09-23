const helpers = require('./helpers');
const scanner = require('./scanner');
const tasksController = require('./controllers/tasks');
const logger = helpers.getLogger("server"); // generate logger for 'server' module
const morgan = require('morgan');
const jsend = require('jsend');
const addReqId = require('express-request-id')();
const _ = require('lodash');
const Prometheus = require('prom-client')

const express = require('express');
const listEndpoints = require('express-list-endpoints');
const app = express();

const AWS = require('aws-sdk');

const uncaughtErrors = new Prometheus.Counter({
    name: 'mousetrap_uncaught_errors',
    help: 'The number of uncaught errors'
});


const start = async () => {
    const _logger = logger.child({ event: "initialization" });

    if (process.env.LOG_LEVEL === "trace")
        AWS.config.logger = console;

    // create a connection with a running clamav daemon
    try {
        await scanner.initialize();
        _logger.info({ step: "init_clamd", success: true })
    } catch (error) {
        _logger.error({ step: "init_clamd", success: false, error: { message: error.message, code: error.code, stack: error.stack }, msg: "Could not initialize connection to ClamAV, aborting startup." })
        process.exit(1);
    }

    // initialize controller
    try {
        await tasksController.initialize();
        _logger.info({ step: "init_controllers", success: true })
    } catch (error) {
        _logger.error({ step: "init_controllers", success: false, error: { message: error.message, code: error.code, stack: error.stack }, msg: "Could not initialize all controllers, aborting startup." })
        process.exit(1);
    }

    Prometheus.collectDefaultMetrics()

    // add a request id to every request
    app.use(addReqId);

    // remove the information about what type of framework is the site running on
    app.disable('x-powered-by');

    // morgan logs
    morgan.token('id', (req) => req.id); // add the request id to every express log
    app.use(morgan(':id :method :url :status :response-time'));

    // parse all request as json objects, and not regular text
    app.use(express.json());

    /////////////////////////////////////////////////////

    // list all routes
    app.get('/favicon.ico', (req, res) => res.sendStatus(404));
    app.get('/', (_, res) => res.json(listEndpoints(app)));
    app.get('/metrics', (req, res) => {
        res.set('Content-Type', Prometheus.register.contentType)
        res.end(Prometheus.register.metrics())
    });
    app.use('/health', require('./routes/healthchecks'));
    app.use('/api/tasks', require('./routes/tasks'));

    /////////////////////////////////////////////////////
    app.use(noRoute);
    app.use(onError);
    /////////////////////////////////////////////////////

    /****
     * HELPERS
     ****/
    function noRoute(req, res, next) {
        const error = new Error("Not Found");
        error.status = 404;

        next(error);
    }

    function onError(err, req, res, next) {
        // 1. set the status of the response
        res.status(err.status || 500);

        // 2. create the error object
        const errObj = jsend.error({
            code: res.statusCode,
            message: err.message,
            data: {
                requestId: req.id,
                error: helpers.isDevelopment() ? err.stack : undefined, // undefined elements arnt copied
                path: req.path
            }
        });

        // 3. merge additional data embedded in the error into the error object
        if (err.extension)
            errObj.data = _.merge(errObj.data, err.extension)

        // 4. log the error stack
        if (res.statusCode !== 404)
            logger.error(req.path, err.stack);

        res.json(errObj);
    }
}

const gracefulShutdown = async () => {
    logger.warn({ msg: "Received shutdown request." })
    await tasksController.shutdown();

    logger.info({ msg: "Graceful shutdown success." })
}

process.on('uncaughtException', (err) => {
    console.log((new Date).toUTCString() + ' uncaughtException:');
    console.log(err);
    uncaughtErrors.inc();
});

process.on('unhandledRejection', (err) => {
    console.log((new Date).toUTCString() + ' unhandledRejection');
    console.log(err);
    uncaughtErrors.inc();
});

app.gracefulShutdown = gracefulShutdown;
app.start = start;

module.exports = app;