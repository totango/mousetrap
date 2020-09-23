class StorageInterface {
    constructor() {
        if (!this.streamFile || !this.getFileMetadata || !this.addFileTags) {
            throw new Error("Storage interface is missing methods!");
        }
    }
}

module.exports = StorageInterface;