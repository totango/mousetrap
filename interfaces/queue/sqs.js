const QueueInterface = require('./interface');
const AWS = require('aws-sdk');
const helpers = require('../../helpers');
const logger = helpers.getLogger("sqs");

class Sqs extends QueueInterface {
    constructor(url, pollingInterval, visibilityTimeout, region) {
        super();
        this.sqs = new AWS.SQS({ region });
        this.url = url;
        this.pollingInterval = pollingInterval;
        this.visibilityTimeout = visibilityTimeout;
        this.isListening = false
        this.stopListening = false;
    }

    async listen() {
        try {
            if (this.stopListening) {
                this.isListening = false;
                super.onPaused();
            }

            if (!this.isListening) {
                this.isListening = true;
                super.onListening();
            }

            await this.checkMessages();
        } catch (error) {
            logger.error({ msg: "If you're seeing this error, it means something went horribly wrong with the tasks queue.", error: { message: error.message, code: error.code, stack: error.stack } })
        } finally {
            return await this.listen()
        }
    }

    async checkMessages() {
        const _logger = logger.child({ event: "queue_message" })
        try {
            // 1. We poll the queue for 1 new available message
            const params = {
                MaxNumberOfMessages: 10,
                WaitTimeSeconds: this.pollingInterval,
                VisibilityTimeout: this.visibilityTimeout,
                QueueUrl: this.url
            };

            const data = await this.sqs.receiveMessage(params).promise();

            // 2. if there are messages available, we take one and transform it into a generic object.
            // since every queue had a different message structure, we simplify the message to a generic structure:
            // {
            //     filePath: "s3://mousetrap-files/some/dummy/file.csv"
            // }
            if (data.Messages && data.Messages.length > 0) {
                for (const message of data.Messages) {
                    let bodyJson;
                    // 2.1. we check if its valid json
                    try {
                        bodyJson = JSON.parse(message.Body);
                    } catch (error) {
                        // -> if it's not valid json, log it and stop processing
                        _logger.warn({ step: 'validate_message', message: message.Body, success: false, error: { message: "Message in queue could not be parsed as JSON! Skipping..." } })
                        await this.deleteMessage(message);
                        return;
                    }

                    // 2.2. we check if it contains the proper keys
                    if (!bodyJson.filePath) {
                        // -> if the message isn't valid, log it and stop processing
                        _logger.warn({ step: 'validate_message', message: message.Body, success: false, error: { message: "Message in queue is missing 'filePath' key! Skipping..." } })
                        await this.deleteMessage(message);
                        return;
                    }

                    // 2.3. we inject the original message
                    bodyJson["_rawMessage"] = message; // we inject the original message so we can later delete it

                    // 2.4. we emit a new message event
                    super.onMessage(bodyJson); // we then emit an application-event with the generic message
                }
            } else {
                // -> if there are not new messages, we emit an empty queue event
                super.onEmpty();
            }
        } catch (error) {
            // -> if we threw at any point during the message retrieval/check - we throw an error event
            this.onError(error);

            // Since there is no actual delay between sqs calls, and we just rely on the actual
            // session timeout for being the delay, erroring out means the listen() function immediately
            // calling this function again, which will error out and cause a lot of errors.
            // so we artificially add a delay only when an error is thrown, as to not DDOS aws, and not
            // cause a mountain of error log messages.
            await helpers.delay(10000);
        } finally {
            return;
        }
    }

    async deleteMessage(message) {
        const deleteParams = {
            QueueUrl: this.url,
            ReceiptHandle: message.ReceiptHandle
        };

        const del = await this.sqs.deleteMessage(deleteParams).promise()
        return del;
    }

    pause() {
        if (this.isListening) {
            super.onPaused()
            this.stopListening = true
        }
    }

    onError(error) {
        logger.error({ msg: "Encountered an error while communicating with SQS", error: { message: error.message, code: error.code, stack: error.stack }, success: false });
    }

}

module.exports = Sqs;