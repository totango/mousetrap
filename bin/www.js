/*
We use this file as a wrapper for the server.
This is where we handle unix signals and system errors, not in server.js
*/
const helpers = require('../helpers');
const server = require('../server');
const http = require('http');
const logger = helpers.getLogger("www");
const config = require("config").get("general");

const port = process.env.PORT || config.port || 3001;
server.set('port', port);

function onError(error) {
    if (error.syscall !== 'listen') {
        throw error;
    }

    //	handle specific listen errors with friendly messages
    switch (error.code) {
        case 'EACCES':
            logger.error({ event: "port_requires_elevation", port });
            process.exit(1);
            break;
        case 'EADDRINUSE':
            logger.error({ event: "port_already_in_use" });
            process.exit(1);
            break;
        default:
            throw error;
    }
}

function onListening() {
    logger.info({ event: "server_listening", port });
}

const initialize = async () => {
    const instance = http.createServer(server);
    await server.start();
    instance.on('error', onError);
    instance.on('listening', onListening);
    instance.listen(port);

    process.on('SIGTERM', async () => {
        await server.gracefulShutdown();
        instance.close(function() {
            process.exit(0);
        });
    });
}

initialize();