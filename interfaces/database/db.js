const config = require("config");
const Dynamodb = require('./dynamodb');

let _db;

const initialize = () => {
    if (config.has("dynamodb"))
        _db = new Dynamodb(config.get("dynamodb.tableName"), config.get('dynamodb.region'));
    // else if (some other db interface)
}

const getDb = () => {
    return _db;
}

module.exports = {
    initialize,
    getDb
}