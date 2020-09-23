const helpers = require('../helpers');
const logger = helpers.getLogger("benchmark"); // generate logger for 'benchmark' module
const argv = require('yargs').argv
const { Readable } = require('stream');
const scanner = require('../scanner');
const AWS = require('aws-sdk');
const S3ReadableStream = require('s3-readable-stream');
const fs = require('fs');

// helper - resolves a promise after a set time - use this to add delay to async tasks
const delay = ms => new Promise(res => setTimeout(res, ms));

const results = {}

const loadLocal = async (sizeInMb) => {
    const _logger = logger.child({ type: "LocalFile", sizeInMb });
    _logger.info({ msg: `Going to benchmark 10 cycles of ${sizeInMb}mb local file` });
    const testId = `LocalFile#${sizeInMb}mb`;

    const cycleResults = [];
    for (let i = 0; i < 10; i++) {
        const cycle = i;
        const start = Date.now();
        const read = fs.createReadStream(`./dummy.${sizeInMb}.csv`);

        const { is_infected } = await scanner.scanStream(read);
        if (is_infected != false) {
            _logger.info({ msg: `scan returned a non-false result, is the daemon ok?`, success: false })
            process.exit(1);
        }
        const end = Date.now()

        cycleResults.push(end - start);
        _logger.info({ cycle: cycle + 1, took: (end - start) })
        await delay(1000);
    }

    results[testId] = {}
    results[testId]["cyclesInMilli"] = cycleResults;
}

const loadS3 = async (sizeInMb) => {
    const _logger = logger.child({ type: "S3File", sizeInMb });
    _logger.info({ msg: `Going to benchmark 10 cycles of ${sizeInMb}mb S3 file` });
    const testId = `S3File#${sizeInMb}mb`;

    const cycleResults = [];
    for (let i = 0; i < 10; i++) {
        const cycle = i;
        const start = Date.now();

        const { is_infected } = await scanner.scanS3Stream(argv.bucket, `dummy.${sizeInMb}.csv`);
        if (is_infected != false) {
            _logger.info({ msg: `scan returned a non-false result, is the daemon ok?`, success: false })
            process.exit(1);
        }
        const end = Date.now()

        cycleResults.push(end - start);
        _logger.info({ cycle: cycle + 1, took: (end - start) })
        await delay(1000);
    }

    results[testId] = {}
    results[testId]["cyclesInMilli"] = cycleResults;
}

const formatResults = () => {
    Object.keys(results).map(test => {
        const max = Math.max.apply(Math, results[test]["cyclesInMilli"]);
        const min = Math.min.apply(Math, results[test]["cyclesInMilli"]);
        const avg = results[test]["cyclesInMilli"].reduce((a, b) => a + b, 0) / results[test]["cyclesInMilli"].length

        logger.info({ test, min, max, avg });
    });
}

const benchmark = async () => {
    await scanner.initialize();

    if (argv.local) {
        await loadLocal(10);
        await loadLocal(100);
        await loadLocal(1000);
    }

    if (argv.s3) {
        if (!argv.bucket) {
            logger.error("Please provide a bucket with --bucket");
            process.exit(1);
        }
        await loadS3(10);
        await loadS3(100);
        await loadS3(1000);
    }

    formatResults();
}

benchmark();