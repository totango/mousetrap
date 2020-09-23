const AWS = require('aws-sdk');
const eventEmitter = require('../eventEmitter');

class QueueInterface {
    constructor() {
        // if (!this.handleMessage) {
        //     throw new Error("Queue interface is missing methods!");
        // }
    }

    onListening() {
        eventEmitter.emit('queue-listening');
    }

    onEmpty() {
        eventEmitter.emit('queue-empty');
    }

    // fired on a new *valid* message
    onMessage(message) {
        eventEmitter.emit('queue-message', message);
    }

    onPaused() {
        eventEmitter.emit('queue-paused');
    }
}

module.exports = QueueInterface;