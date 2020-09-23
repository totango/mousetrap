const config = require("config");
const Sqs = require('./sqs');

let _queue;

const initialize = () => {
    if (config.has("sqs")) {
        queueUrl = config.get("sqs.url");
        pollingInterval = config.get("sqs.pollingInterval");
        visibilityTimeout = config.get("sqs.visibilityTimeout");
        region = config.get("sqs.region");

        _queue = new Sqs(queueUrl, pollingInterval, visibilityTimeout, region);
    } // else if (some other queue interface)
}

const getQueue = () => {
    return _queue;
}

module.exports = {
    initialize,
    getQueue
}