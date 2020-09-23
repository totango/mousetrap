const helpers = require('../helpers');
const logger = helpers.getLogger("rest-healthchecks"); // generate logger for 'rest-healthchecks' module
const scanner = require('../scanner');

const express = require('express')
const router = express.Router()

// route: GET /health
// desc: Checks connection to the clamav daemon
router.get('/', async (req, res) => {
    const isHealthy = await scanner.isClamdHealthy();

    if (isHealthy) return res.sendStatus(200)

    logger.warn("Healthcheck failed - clamav daemon not responding");

    return res.sendStatus(500);
});

module.exports = router;