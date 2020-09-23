const config = require("config");
const _get = require("lodash.get") // returns undefined if key doesnt exist
const Sns = require('./sns');

let _providers = {};

const initialize = () => {
    _providers.sns = new Sns(_get(config, "sns.topicArn"));
}

const getProvider = (provider) => {
    return _providers[provider];
}

const getProviders = () => {
    return _providers;
}

const identifyProvider = (channel) => {
    if (!channel) return null;

    if (channel.startsWith("arn:aws:sns"))
        return "sns";
}

const getMergedChannels = (channels = []) => {
    // get the default channel from all providers, then filter our ones with no default channel
    const defaultChannels = Object.values(_providers).map(p => p.getDefaultChannel()).filter(c => (c !== undefined));
    // add the user provided channels
    const allChannels = channels.concat(defaultChannels);
    // remove any duplicates where the user provided channel is also a default one
    const dedupedChannels = allChannels.filter((elem, pos) => { return allChannels.indexOf(elem) == pos });

    return dedupedChannels;
}

// notify on all configured notification channels.
// you can add additional channels, usually specified in the task request
const notifyAll = async (filePath, scanResult, viruses = [], timestamp, channels) => {
    const allChannels = getMergedChannels(channels);

    for (channel of allChannels) {
        const provider = identifyProvider(channel);

        if (provider)
            await _providers[provider].notify(filePath, scanResult, viruses, timestamp, channel);
    }
}

// notify an error on all configured notification channels.
// you can add additional channels, usually specified in the task request
const notifyErrorAll = async (filePath, code, message, timestamp, channels = []) => {
    const allChannels = getMergedChannels(channels);

    for (channel of allChannels) {
        const provider = identifyProvider(channel);

        if (provider)
            await _providers[provider].notifyError(filePath, code, message, timestamp, channel);
    }
}

module.exports = {
    initialize,
    getProvider,
    getProviders,
    identifyProvider,
    notifyAll,
    notifyErrorAll
}