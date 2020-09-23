const pino = require('pino')({ base: null, useLevelLabels: true, prettyPrint: (process.env.NODE_ENV === "development") ? { translateTime: true, colorize: true } : null });

module.exports = {
    isDevelopment: () => process.env.NODE_ENV === "development",
    getLogger: (module) => pino.child({
        level: process.env.LOG_LEVEL || 'info',
        module
    }),
    delay: ms => new Promise(res => setTimeout(res, ms)),
    runWithTimeout: (timeoutMs, promise, failureMessage) => {
        let timeoutId;
        const timeoutPromise = new Promise((resolve, reject) => {
            const timeoutError = new Error(failureMessage);
            timeoutError.code = "TimeoutError"
            timeoutId = setTimeout(() => reject(timeoutError), timeoutMs);
        });

        return Promise
            .race([promise, timeoutPromise])
            .then(result => {
                clearTimeout(timeoutId);
                return result;
            });
    },
    errors: {
        FILE_NOT_EXIST: {
            code: "FILE_NOT_EXIST",
            message: "file does not exist in specified location"
        }
    }
};