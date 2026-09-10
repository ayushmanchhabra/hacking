import child_process from "node:child_process";

/**
 * Class representing 7Zip operations.
 */
export default class SevenZip {

    #filePath;
    #args = [];
    #options = { encoding: "utf-8", stdio: "pipe" };

    /**
     * Initiailise xz class
     * @param {string} filePath - Path to xz executable
     */
    constructor(filePath) {
        this.#filePath = filePath;
    }

    /**
     * Decompress .xz files
     * @param {string} input - Compressed XZ file
     * @returns {child_process.SpawnSyncReturns<Buffer<ArrayBufferLike>>}
     */
    x(input) {
        this.#args = ["x", input];
        const result = child_process.spawnSync(this.#filePath, this.#args, this.#options);
        return result;
    }
}
