const AWS = require('aws-sdk');
const helpers = require('../../helpers');
const StorageInterface = require('./interface');
const logger = helpers.getLogger("s3");
const S3ReadableStream = require('s3-readable-stream');

class S3 extends StorageInterface {
    constructor() {
        super();
        this.s3 = new AWS.S3();
    }

    streamFile(file) {
        const _logger = logger.child({ event: 'create_file_stream', file });

        _logger.debug({ step: 'split_bucket_and_file' });
        // given: s3://mousetrap-files/some/dummy/file.csv
        const Bucket = file.replace("s3://", "").split("/")[0]; // -> mousetrap-files
        const Key = file.replace("s3://", "").split("/").slice(1).join("/"); // -> some/dummy/file.csv

        _logger.debug({ step: 'create_stream', Bucket, Key });
        const s3FileStream = new S3ReadableStream(this.s3, {
            Bucket,
            Key
        });

        return s3FileStream;
    }

    async getFileMetadata(file) {
        const _logger = logger.child({ event: 'get_file_metadata', file });
        try {
            _logger.debug({ step: 'split_bucket_and_file' });
            // given: s3://mousetrap-files/some/dummy/file.csv
            const Bucket = file.replace("s3://", "").split("/")[0]; // -> mousetrap-files
            const Key = file.replace("s3://", "").split("/").slice(1).join("/"); // -> some/dummy/file.csv

            _logger.debug({ step: 'get_file_metadata', Bucket, Key });
            const stats = await this.s3.headObject({ Bucket, Key }).promise();
            return stats;
        } catch (error) {
            return null;
        }
    }

    async addFileTags(file, result, scanTs) {
        const _logger = logger.child({ event: 'add_mousetrap_tags', file });
        _logger.debug({ step: 'split_bucket_and_file' });
        // given: s3://mousetrap-files/some/dummy/file.csv
        const Bucket = file.replace("s3://", "").split("/")[0]; // -> mousetrap-files
        const Key = file.replace("s3://", "").split("/").slice(1).join("/"); // -> some/dummy/file.csv

        _logger.debug({ step: 'get_existing_tags', Bucket, Key });
        const existingTags = await (await this.s3.getObjectTagging({ Bucket, Key }).promise()).TagSet;
        const tagsWithoutMsTags = existingTags.filter(tag => tag.Key !== "MOUSETRAP_RESULT" && tag.Key !== "MOUSETRAP_TS");

        const newTags = [...tagsWithoutMsTags,
            { Key: "MOUSETRAP_RESULT", Value: `${result}` },
            { Key: "MOUSETRAP_TS", Value: `${scanTs}` }
        ];

        _logger.debug({ step: 'write_new_tagset' });
        await this.s3.putObjectTagging({ Bucket, Key, Tagging: { TagSet: newTags } }).promise()
    }
}

module.exports = S3;