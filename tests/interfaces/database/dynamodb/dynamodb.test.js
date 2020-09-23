const AWSMock = require('aws-sdk-mock');
const importFresh = require("import-fresh");
const samples = require('./samples');

describe('dynamodb interface', () => {
    beforeAll((done) => {
        process.env.NODE_CONFIG_DIR = __dirname;
        done();
    });

    it("should be an instance of the 'Dynamodb' class", () => {
        expect.assertions(1);
        const db = importFresh('../../../../interfaces/database/db');
        const Dynamodb = importFresh('../../../../interfaces/database/dynamodb.js');

        db.initialize();
        const instOf = db.getDb() instanceof Dynamodb;

        expect(instOf).toStrictEqual(true);
    });

    it("should be return tasks sorted by ascending creation date", async () => {
        AWSMock.mock('DynamoDB.DocumentClient', 'scan', (_, callback) => {
            callback(null, { Items: samples.filter(s => s.scanState === "PENDING") });
        });

        expect.assertions(1);

        const db = importFresh('../../../../interfaces/database/db.js');
        db.initialize();

        const tasks = await db.getDb().getTasks("PENDING");

        expect(["bucket/example1.1.csv",
            "bucket/example1.0.csv",
            "bucket/example1.2.csv"
        ]).toEqual(tasks.map(t => t.filePath));
        AWSMock.restore('DynamoDB.DocumentClient');
    });

    it("should get a task by file path", async () => {
        const sampleTask = {
            filePath: "bucket/getFile.csv",
            scanState: "PENDING",
            createdTs: 1585575781434,
            scanStartTs: -1,
            scanEndTs: -1,
            scanResult: 'PENDING',
            viruses: [],
            scanAttempts: 0,
            sizeMb: 100,
            fileHash: "1234567890"
        }

        AWSMock.mock('DynamoDB.DocumentClient', 'get', (_, callback) => {
            callback(null, { Item: sampleTask });
        });

        expect.assertions(1);

        const db = importFresh('../../../../interfaces/database/db.js');
        db.initialize();

        const task = await db.getDb().getTaskByFile("bucket/getFile.csv");
        expect(task).toEqual(sampleTask);
        AWSMock.restore('DynamoDB.DocumentClient');
    });
});