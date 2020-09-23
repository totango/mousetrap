const { EventEmitter } = require('events');

/* singleton for application-wide event-emitter */

const ee = new EventEmitter();

module.exports = ee