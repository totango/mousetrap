const DbInterface = require('./interface');
const AWS = require('aws-sdk');
const helpers = require('../../helpers');
const logger = helpers.getLogger("dynamodb");

class Dynamodb extends DbInterface {
    constructor(tableName, region) {
        super();
        this.dynamo = new AWS.DynamoDB.DocumentClient({ region });
        this.tableName = tableName;
    }

    onError(error) {
        logger.error({ msg: "Encountered an error while communicating with DynamoDB", error: { message: error.message, code: error.code, stack: error.stack }, success: false });
    }

    async getTaskByFile(file) {
        const task = await this.dynamo.get({
            TableName: this.tableName,
            Key: {
                filePath: file
            }
        }).promise();

        if (task)
            return task.Item;

        return undefined
    }

    async getTasks(...statuses) {
        let allTasks = [];

        for (const status of statuses) {
            const params = {
                TableName: this.tableName,
                Key: { scanState: status },
                FilterExpression: "scanState = :scanState",
                ExpressionAttributeValues: {
                    ":scanState": status
                }
            };

            let tasks = [];
            let items;
            do { // paginate if there are more results than can be retrieved in one request
                items = await this.dynamo.scan(params).promise();
                items.Items.forEach(item => tasks.push(item)); // dynamo returns all items inside an 'Items' object key, so we extract them all
                params.ExclusiveStartKey = items.LastEvaluatedKey;
            } while (typeof items.LastEvaluatedKey != "undefined");
            allTasks = allTasks.concat(tasks);
        }

        allTasks.sort((a, b) => a.createdTs - b.createdTs)
        return allTasks;
    }

    async createTask(file, state, sizeMb, ETag, notifyChannels = []) {
        const params = {
            TableName: this.tableName,
            Item: {
                filePath: file,
                scanState: state,
                createdTs: Date.now(),
                scanStartTs: -1,
                scanEndTs: -1,
                scanResult: 'PENDING',
                viruses: [],
                scanAttempts: 0,
                sizeMb: sizeMb,
                fileHash: ETag.slice(1, -1), // removes double quote from beginning and end
                notifyChannels: notifyChannels
            },
            ReturnValues: "ALL_OLD"
        };

        return await this.dynamo.put(params).promise()
    }

    async setPending(file, incrementScanAttempts) {
        const params = {
            TableName: this.tableName,
            Key: {
                "filePath": file
            },
            UpdateExpression: "SET scanState=:scanState, scanAttempts=scanAttempts + :incrementBy",
            ExpressionAttributeValues: {
                ":incrementBy": incrementScanAttempts ? 1 : 0,
                ":scanState": "PENDING"
            },
            ReturnValues: "ALL_NEW"
        };

        const response = await this.dynamo.update(params).promise();
        return response.Attributes;
    }

    async setScanning(file) {
        try {
            const params = {
                TableName: this.tableName,
                Key: {
                    "filePath": file
                },
                UpdateExpression: "SET scanState=:scanState, scanStartTs=:scanStartTs",
                ConditionExpression: "scanState=:pending", // only update if state is `PENDING`
                ExpressionAttributeValues: {
                    ":scanState": "SCANNING",
                    ":scanStartTs": Date.now(),
                    ":pending": "PENDING"
                },
                ReturnValues: "ALL_NEW"
            };

            const response = await this.dynamo.update(params).promise();
            return response.Attributes;
        } catch (error) {
            // if state is different than `PENDING` by the time we try to update, it means
            // some other worker is already scanning the current task, and we should try a different one
            if (error.code === "ConditionalCheckFailedException") {
                const raceError = new Error("Attempted to scan an item that is being scanned");
                raceError.code = "ItemAlreadyBeingScanned"

                throw raceError;
            }

            throw error;
        }
    }

    async setFinished(file, result, viruses, ts) {
        const params = {
            TableName: this.tableName,
            Key: {
                "filePath": file
            },
            UpdateExpression: "SET scanState=:scanState, scanAttempts=scanAttempts + :incrementBy, scanResult=:result, viruses=:viruses, scanEndTs=:scanEndTs",
            ExpressionAttributeValues: {
                ":scanState": "FINISHED",
                ":incrementBy": 1,
                ":scanEndTs": ts,
                ":result": result,
                ":viruses": viruses ? viruses : []
            },
            ReturnValues: "ALL_NEW"
        };

        const response = await this.dynamo.update(params).promise();
        return response.Attributes;
    }

    async setFailed(file, incrementScanAttempts = true) {
        const params = {
            TableName: this.tableName,
            Key: {
                "filePath": file
            },
            UpdateExpression: "SET scanState=:scanState, scanAttempts=scanAttempts + :incrementBy",
            ExpressionAttributeValues: {
                ":scanState": "FAILED",
                ":incrementBy": incrementScanAttempts ? 1 : 0
            },
            ReturnValues: "ALL_NEW"
        };

        const response = await this.dynamo.update(params).promise();
        return response.Attributes;
    }
}

module.exports = Dynamodb;