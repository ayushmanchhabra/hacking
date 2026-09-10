import child_process from "node:child_process";

/**
 * Class representing apksigner operations.
 */
export default class Apksigner {

    #filePath;
    #args = [];
    #options = { encoding: "utf-8", stdio: "pipe" };

    /**
     * Initiailise apksigner class
     * @param {string} filePath - Path to apksigner executable
     */
    constructor(filePath) {
        this.#filePath = filePath;
    }

    /**
     * Sign APK directly using JKS keystore
     * @param {string} keystorePath - Path to JKS keystore
     * @param {string} keystorePass - Keystore password
     * @param {string} keyAlias - Key alias in keystore
     * @param {string} inputApk - APK to sign
     * @param {string} outputApk - Signed APK output path
     * @param {Array<string>} signerOptions - Optional extra signer options
     * @returns {void}
     */
    sign(keystorePath, keystorePass, keyAlias, inputApk, outputApk, signerOptions = []) {
        this.#args = [
            'sign',
            '--ks', keystorePath,
            '--ks-pass', `pass:${keystorePass}`,
            '--ks-key-alias', keyAlias,
            '--out', outputApk,
            ...signerOptions,
            inputApk
        ];

        child_process.spawnSync(this.#filePath, this.#args, this.#options);
    }
}
