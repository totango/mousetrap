const AWS = require('aws-sdk');
const helpers = require('../../helpers');
const NotifierInterface = require('./interface');
const logger = helpers.getLogger("sns");

class Sns extends NotifierInterface {
    constructor(topicArn) {
        super();
        this.defaultTopicArn = topicArn;
    }

    getRegionFromArn(ARN) {
        return ARN.split(":")[3];
    }

    getDefaultChannel() {
        return this.defaultTopicArn;
    }

    async notify(filePath, scanResult, viruses = [], timestamp, arn) {
        const sns = new AWS.SNS({ region: this.getRegionFromArn(arn) });

        const params = {
            Message: JSON.stringify({ filePath, scanResult, viruses, timestamp }),
            TopicArn: arn
        };

        await sns.publish(params).promise();
    }

    async notifyError(filePath, code, message, timestamp, arn) {
        const sns = new AWS.SNS({ region: this.getRegionFromArn(arn) });

        const params = {
            Message: JSON.stringify({ filePath, error: { code, message }, timestamp }),
            TopicArn: arn
        };

        await sns.publish(params).promise();
    }
}

module.exports = Sns;