import child_process from "node:child_process";

/**
 * Class representing Keytool operations.
 */
export default class Keytool {

    #filePath;
    #args = [];
    #options = { encoding: "utf-8", stdio: "pipe" };

    /**
     * Initiailise keytool class
     * @param {string} filePath - Path to keytool executable
     */
    constructor(filePath) {
        this.#filePath = filePath;
    }

    /**
 * Create Keystore
 * @param {string} keystorePath - Relative file path for the new keystore (e.g. ./keystore.jks)
 * @param {string} alias - Alias name for the key
 * @param {string} storepass - Password for the keystore
 * @param {string} keypass - Password for the key (can be same as storepass)
 * @param {number} validity - Validity in days (default: 365)
 * @param {{CN: string, OU: string, O: string, L: string, ST: string, C: string}} dname - X.500 Distinguished Name
 * @returns {void}
 */
    createKeyStore(keystorePath, alias, storepass, keypass, validity = 365, dname) {
        this.#args = [
            '-genkeypair',
            '-alias', alias,
            '-keyalg', 'RSA',
            '-keysize', '2048',
            '-validity', validity.toString(),
            '-keystore', keystorePath,
            '-storepass', storepass,
            '-keypass', keypass,
            '-dname', `CN=${dname.CN}, OU=${dname.IT}, O=${dname.O}, L=${dname.L}, ST=${dname.ST}, C=${dname.C}`
        ];

        child_process.spawnSync('keytool', this.#args, this.#options);
    }

}
