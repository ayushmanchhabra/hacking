import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Class representing subfinder operations.
 */
export default class Subfinder {

    #filePath;
    #args = [];
    #options = { encoding: "utf-8", stdio: "pipe" };

    /**
     * Initiailise subfinder class
     * @param {string} filePath - Path to subfinder executable
     */
    constructor(filePath) {
        this.#filePath = filePath;
    }

    /**
     * Find subdomains for a given domain
     * @param {string[]} domains - List of domains to find subdomains for
     * @returns {child_process.SpawnSyncReturns<Buffer<ArrayBufferLike>>}
     */
    find(domains) {
        console.log('[ INFO ] Enumerating subdomains...');
        this.#args = ["-domain", ...domains];
        const result = child_process.spawnSync(this.#filePath, this.#args, this.#options);
        const subdomains = result.stdout.toString().trim().split('\n');
        return subdomains;
    }
}
