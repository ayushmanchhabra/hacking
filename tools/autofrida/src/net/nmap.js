import child_process from "node:child_process";

import { parseStringPromise } from "xml2js";

/**
 * Class representing nmap functionality
 */
export default class Nmap {

    #filePath;
    #args = [];
    #options = { encoding: "utf-8" };

    /**
     * Initiailise adb class
     * @param {string} filePath - Path to adb executable
     */
    constructor(filePath) {
        this.#filePath = filePath;
    }

    /**
     * Ping scan
     * @param {"ARP"} type - Type of ping scan.
     * @returns {Promise<Array<{state: string, ip: string}>>} - Array of host objects with state and ip address.
     */
    async ping(type, target) {
        if (type === "ARP") {
            this.#args = ["-sn", "-PR", "-oX", "-", target];
            const xmlData = child_process.spawnSync("nmap", this.#args, this.#options);
            const result = await parseStringPromise(xmlData.stdout);
            const hosts = result.nmaprun.host || [];
            const hostArray = hosts.map(host => {
                const state = host.status[0].$.state;
                const addr = host.address[0].$.addr;
                return { state, addr };
            });

            return hostArray;
        }
    }
}
