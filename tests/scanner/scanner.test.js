const mockCrypto = require('crypto');

// The standard 68-byte EICAR test file and its well-known MD5
const mockEicarMd5 = '44d88612fea8a8f36de82e1278abb02f';

// Capture the bytes the healthcheck sends to clamd
let mockSent;
jest.mock('clamscan', () => jest.fn().mockImplementation(() => ({
    init: async () => ({
        scan_stream: (stream) => new Promise((resolve, reject) => {
            const chunks = [];
            stream.on('data', (c) => chunks.push(Buffer.from(c)));
            stream.on('error', reject);
            stream.on('end', () => {
                mockSent = Buffer.concat(chunks);
                const md5 = mockCrypto.createHash('md5').update(mockSent).digest('hex');
                resolve({ is_infected: md5 === mockEicarMd5, viruses: [] });
            });
        }),
    }),
})));

describe('scanner healthcheck', () => {
    beforeAll(() => {
        process.env.NODE_CONFIG = JSON.stringify({ clamd: { host: 'localhost', port: 3310 } });
        process.env.SUPPRESS_NO_CONFIG_WARNING = 'y';
    });

    it('sends the exact 68-byte EICAR test file to clamd', async () => {
        const scanner = require('../../scanner');
        await scanner.initialize();

        expect(mockSent.length).toBe(68);
        expect(mockCrypto.createHash('md5').update(mockSent).digest('hex')).toBe(mockEicarMd5);
        await expect(scanner.isClamdHealthy()).resolves.toBe(true);
    });
});
