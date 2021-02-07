// singleton for communicating with clamd via sockets
// provides methods to initialize, scan stream and healthcheck the daemon

const { PassThrough, Readable } = require('stream');
const helpers = require('../helpers');
const logger = helpers.getLogger("scanner"); // generate logger for 'scanner' module
const uuid = require('uuid');
// Initialize the clamscan module
const NodeClam = require('clamscan');
const StreamSpeed = require('streamspeed');
const config = require('config'); // the name can be misleading - this is an npm package
const Prometheus = require('prom-client');

const scanRateMetric = new Prometheus.Gauge({
    name: 'mousetrap_scan_rate_bytes',
    help: 'The scan rate in bytes per second'
});

let _clamscan;

// helper - logs speed to processing data from a stream
// process speed depends on the source data is being piped from
const logSpeed = (stream, uid, logger) => {
    // 1. Create a streamspeed object
    let ss = new StreamSpeed();

    // 2. add the stream to monitor
    ss.add(stream);

    // 3. Listen for events emitted by streamspeed on the given stream.
    // The 'speed' event is fired every time data is read - that means many many times,
    // so we log speed every 5 seconds to not be too verbose
    //
    // 'speed' and 'avgSpeed' parameters are in bytes
    let lastLogTs = undefined;
    ss.on('speed', (speed, avgSpeed) => {
        // -> if we havn't logged yet, we print and update the ts
        // first speed indication is usually much higher than the rest due to the traffic shaping
        if (!lastLogTs) {
            lastLogTs = Date.now();
            logger.debug({
                msg: "first speed indications are usually inaccurate due to traffic shaping",
                step: "stream_data",
                scanId: uid,
                speed: StreamSpeed.toHuman(speed, 's')
            })

            scanRateMetric.set(avgSpeed);
        }
        // -> if 5 seconds have passed, we log and update the ts
        else if (Math.floor((Date.now() - lastLogTs) / 1000) > 5) {
            lastLogTs = Date.now();
            logger.debug({
                step: "stream_data",
                scanId: uid,
                speed: StreamSpeed.toHuman(speed, 's')
            });

            scanRateMetric.set(avgSpeed);
        }
    });
}

// initializes a client to communicate with clamd via sockets
const initialize = async () => {
    const _logger = logger.child({ event: "initialization" });

    // 1. create a client that communicates with clamd via socket
    _clamscan = await new NodeClam().init({
        debug_mode:  process.env.LOG_LEVEL === 'debug' ? true : false,
        clamdscan: {
            host: config.get('clamd.host'),
            port: config.get('clamd.port')
        },
    });
    _logger.info({ step: "creating_client", success: true })

    // 2. wait for clamd to become available
    // we check availability by running the healthcheck (EICAR test string) until it returns healthy status
    let isHealthy = false;
    for (let i = 0; i < 5; i++) { // TODO make max attempts configurable
        _logger.debug({ step: "attempting_connection", attempt: i + 1 });
        isHealthy = await isClamdHealthy();

        if (isHealthy) {
            _logger.debug({ step: "attempting_connection", attempt: i + 1, success: true });
            break;
        }

        await helpers.delay(5000)
    }

    // 3. if max attempts reached and clamd still isn't responding - throw
    if (!isHealthy) {
        _logger.error({ step: "attempting_connection", success: false, msg: "Reached max retry attempts" });
        throw new Error("ClamAV is not responding");
    }

    // 4. otherwise, return the client instance
    return _clamscan;
};

// returns the singleton client
const getClamscan = () => {
    return _clamscan;
}

// given a readable stream, pipe it to clamd and handle the result
// returns an object as a result, or null is scan failed
// {
//     is_infected: true | false,
//     viruses: [...] // only if `is_infected` is true
// }
const scanStream = async (inputStream) => {
    // steps: generate scan uuid -> stream_open -> ...stream_data -> stream_end -> stream_to_clam -> handle_result
    const uid = uuid.v4();
    const _logger = logger.child({ event: "scan_stream", scanId: uid });

    // 1. create a stream that will be passed to clamav
    const virusStream = new PassThrough();

    // 2. add verbosity events to the stream
    // -> handle open/end/error events and log appropriately 
    inputStream.on('open', () => _logger.debug({ step: 'stream_open' }));
    inputStream.on('end', () => _logger.debug({ step: "stream_end", success: true })); // 'end' is fired when all data has been flushed

    // -> if there was an error during stream we should log and handle the error
    // and also stop the stream
    inputStream.on('error', error => {
        _logger.error({ step: "stream_error", error: { message: error.message, code: error.code, stack: error.stack }, success: false });
        inputStream.destroy();
        virusStream.destroy();
    });

    // 3. we start piping data from the bucket into our local stream
    logSpeed(inputStream, uid, _logger);
    inputStream.pipe(virusStream); // data only begins to be downloaded once we pipe it to a destination

    const start = Date.now();
    try {

        // 4. we then start piping that stream into the clamav daemon
        _logger.debug({ step: "stream_to_clam" });
        const { is_infected, viruses } = await _clamscan.scan_stream(virusStream);

        _logger.debug({ step: "stream_to_clam", success: true });

        // 5. we handle the results:
        // if `is_infected` is TRUE - file is a INFECTED
        // if `is_infected` is null - something happened at clamav's side and the file could not be scanned
        // if `is_infected` is false - file is CLEAN
        if (is_infected === true) {
            _logger.debug({ step: "handle_result", is_infected, viruses, success: true, took: (Date.now() - start) })
            return { is_infected, viruses };
        } else if (is_infected === null) {
            _logger.debug({ step: "handle_result", is_infected, success: false, took: (Date.now() - start), msg: "ClamAV could not determine file result" })
            throw Error("ClamAV could not determine file result");
        } else if (is_infected === false) {
            _logger.debug({ step: "handle_result", is_infected, success: true, took: (Date.now() - start) })
            return { is_infected }
        }
    } catch (error) {
        _logger.debug({ step: "stream_to_clam", error: { message: error.message, code: error.code, stack: error.stack }, success: false, took: (Date.now() - start), msg: "ClamAV errored while scanning stream" })
        throw error
    } finally {
        inputStream.destroy()
        virusStream.destroy()

        scanRateMetric.set(0)
    }
}

// clamd healthcheck by sending the EICAR test string:
// X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*
// to the daemon, and receives result that file is infected

// we intentionally check clamd health by if it's working and not just if socket is open
// this might demand more performance but will also provide better checks
const isClamdHealthy = async () => {
    const _logger = logger.child({ event: "test_clamd" });
    try {
        const testStream = new Readable()
        testStream.push('X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')
        testStream.push(null);

        const virusStream = new PassThrough();
        testStream.pipe(virusStream);

        _logger.debug({ step: "scan_test_stream" })
        const { is_infected } = await _clamscan.scan_stream(virusStream);
        _logger.debug({ step: "scan_test_stream", is_infected, success: true })
        
        let eicarInfectedValidation;
        if (config.has('health.eicarInfectedValidation')) {
            eicarInfectedValidation = config.get('health.eicarInfectedValidation');
        } else {
            eicarInfectedValidation = true;
        } 
                
        if (!is_infected && eicarInfectedValidation) {
            return false;
        }

        return true;
    } catch (error) {
        _logger.debug({ step: "scan_test_stream", success: false, error: { message: error.message, code: error.code, stack: error.stack } })
        return false;
    }
}

module.exports = {
    initialize,
    getClamscan,
    scanStream,
    isClamdHealthy,
    SCANNING: "SCANNING",
    PENDING: "PENDING",
    FAILED: "FAILED"
}