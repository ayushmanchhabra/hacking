import child_process from "node:child_process";

/**
 * Class representing zipalign operations.
 */
export default class Zipalign {

    #filePath;
    #args = [];
    #options = { encoding: "utf-8", stdio: "pipe" };

    /**
     * Initiailise apksigner class
     * @param {string} filePath - Path to zipalign executable
     */
    constructor(filePath) {
        this.#filePath = filePath;
    }

    /**
     * Check alignment of APK
     * @param {string} apkFilePath - File path to APK
     * @returns {void}
     */
    check(apkFilePath) {
        console.log('[ INFO ] Checking alignment of APK...');
        this.#args = [
            '-c',
            '-v',
            '4',
            apkFilePath
        ];

        child_process.spawnSync(this.#filePath, this.#args, this.#options);
    }

    /**
     * Align APK
     * @param {string} inputApkPath - File path to input APK
     * @param {string} outoutApkPath - File path to output APK
     * @returns {void}
     */
    align(inputApkPath, outoutApkPath) {
        this.#args = [
            '-v',
            '4',
            inputApkPath,
            outoutApkPath,
        ];

        child_process.spawnSync(this.#filePath, this.#args, this.#options);
    }
}
