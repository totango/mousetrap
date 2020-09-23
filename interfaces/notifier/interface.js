class NotifierInterface {
    constructor() {
        if (!this.notify, !this.getDefaultChannel) {
            throw new Error("Notifier interface is missing methods!");
        }
    }
}

module.exports = NotifierInterface;