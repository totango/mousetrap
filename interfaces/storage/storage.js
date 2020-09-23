const config = require("config");
const S3 = require('./s3');

let _storage;

const initialize = () => {
    if (config.get("storage") === "s3")
        _storage = new S3();
    // else if (some other storage bucket interface)
}

const getStorage = () => {
    return _storage;
}

module.exports = {
    initialize,
    getStorage
}