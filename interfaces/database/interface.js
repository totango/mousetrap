class DbInterface {
    constructor() {
        if (!this.getTaskByFile || !this.getTasks || !this.createTask) {
            throw new Error("Db interface is missing methods!");
        }
    }
}

module.exports = DbInterface;