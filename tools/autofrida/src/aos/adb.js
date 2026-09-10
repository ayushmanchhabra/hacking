import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Class representing ADB (Android Debug Bridge) operations.
 */
export default class Adb {

    #filePath;
    #args = [];
    #options = { encoding: "utf-8", stdio: "pipe" };

    /**
     * Initiailise adb class
     * @param {string} filePath - Path to adb executable
     */
    constructor(filePath) {
        this.#filePath = filePath;
    }

    /**
     * Start adb server
     * @returns {child_process.SpawnSyncReturns<Buffer<ArrayBufferLike>>}
     */
    startServer() {
        console.log('[ INFO ] Starting ADB server...');
        this.#args = ["start-server"];
        /* Timeout after 5 seconds to prevent spawnSync from blocking Node.js' event loop. */
        this.#options = { ...this.#options, timeout: 5000 };
        const result = child_process.spawnSync(this.#filePath, this.#args, this.#options);
        return result;
    }

    /**
     * Kill adb server
     * @returns {child_process.SpawnSyncReturns<Buffer<ArrayBufferLike>>}
     */
    killServer() {
        console.log('[ INFO ] Killing ADB server...');
        this.#args = ["kill-server"];
        const result = child_process.spawnSync(this.#filePath, this.#args, this.#options);
        return result;
    }

    /**
     * Get connected devices
     * @returns {Array<{name: string, device: string}>} - Array of connected devices
     */
    getConnectedDevices() {
        console.log('[ INFO ] Finding connected devices...');
        this.#args = ["devices"]
        const result = child_process.spawnSync(this.#filePath, this.#args, this.#options);
        const devicesInfo = result.stdout.trim().split(/\r?\n/).slice(1);

        const devices = [];
        for (const device of devicesInfo) {
            const [name, status] = device.split("\t");
            devices.push({ name, status });
        }
        return devices;
    }

    /**
     * Get device architecture
     * @param {string} serial - Serial number of Android device 
     * @returns {"arm64-v8a" | "armeabi-v7a" | "x86" | "x86_64"} - Device architecture
     */
    getDeviceArch(serial) {
        this.#args = serial
            ? ["-s", serial, "shell", "getprop", "ro.product.cpu.abi"]
            : ["shell", "getprop", "ro.product.cpu.abi"];
        const result = child_process.execFileSync(this.#filePath, this.#args, this.#options);
        return result.trim();
    }

    /**
     * Get all package names
     * @param {*} serial - Serial number of Android device 
     * @returns {Array<string>} - Array of all package names
     */
    getPackages(serial) {
        this.#args = serial
            ? ["-s", serial, "shell", "pm", "list", "packages"]
            : ["shell", "pm", "list", "packages"];
        const result = child_process.execFileSync(this.#filePath, this.#args, this.#options);
        const packages = result
            .split("\n")
            .filter(line => line.trim() !== "")
            .map(line => line.replace(/^package:/, "").trim());
        return packages;
    }

    /**
     * Get the installation paths of a package.
     * @param {string} serial - Serial number of Android device
     * @param {string} packageName - Name of the package
     * @returns {Array<string> | undefined} - Array of installation paths
     */
    getPaths(serial, packageName) {
        this.#args = serial
            ? ["-s", serial, "shell", "pm", "path", packageName]
            : ["shell", "pm", "path", packageName];
        const result = child_process.spawnSync(this.#filePath, this.#args, this.#options);
        if (result.status === 1) {
            console.log('[ ERROR ] The package is not installed. Check for typos or use `getPackages` to list all packages.');
            return undefined;
        }
        const paths = result.stdout
            .split("\n")
            .filter(line => line.trim() !== "")
            .map(line => line.replace(/^package:/, "").trim());
        return paths;
    }

    /**
     * Pull files from Android device using adb pull command
     * @param {string} serial - Serial number of Android device
     * @param {Array<string>} paths - Array of all package name paths
     * @param {string} outDir - Output directory
     * @returns {void}
     */
    pull(serial, paths, outDir) {

        const resolvedOutDir = path.resolve(outDir);

        if (fs.existsSync(resolvedOutDir)) {
            throw new Error("Directory exists at", resolvedOutDir);
        } else {
            fs.mkdirSync(resolvedOutDir, { recursive: true });
        }

        for (const path of paths) {
            this.#args = serial
                ? ["-s", serial, "pull", path, resolvedOutDir]
                : ["pull", path, resolvedOutDir];
            child_process.spawnSync(this.#filePath, this.#args, this.#options);
        }
    }

    /**
     * Push a file to Android device
     * @param {string} serial - Serial number of Android device
     * @param {string} localFile - Local file path
     * @param {string} remotePath - Remote file path on Android device
     * @returns {void}
     */
    push(serial, localFile, remotePath) {
        this.#args = serial
            ? ["-s", serial, "push", localFile, remotePath]
            : ["push", localFile, remotePath];
        child_process.spawnSync(this.#filePath, this.#args, this.#options);
    }

    /**
     * Install multiple APKs such as base and split_config APKs in one go
     * @param {string} serial - Serial number of Android device
     * @param {string} apkPaths - List of APKs
     * @returns {void}
     */
    installMultiple(serial, apkPaths) {
        const args = serial
            ? ["-s", serial, "install-multiple", "-r", ...apkPaths]
            : ["install-multiple", "-r", ...apkPaths];
        const result = child_process.execFileSync(this.#filePath, args, this.#options);
        return result.trim();
    }

    /**
     * Uninstall APK
     * @param {string} serial - Serial number of Android device
     * @param {string} packageName - Name of package
     * @returns {void}
     */
    uninstall(serial, packageName) {
        const args = serial
            ? ["-s", serial, "uninstall", packageName]
            : ["uninstall", packageName];
        const result = child_process.execFileSync(this.#filePath, args, this.#options);
        return result.trim();
    }

    /**
     * Execute Linux command in Android device
     * @param {string} serial - Serial number of Android device
     * @param {string} command - Command to be executed
     * @returns {child_process.SpawnSyncReturns<Buffer<ArrayBufferLike>>}
     */
    shell(serial, command) {
        this.#args = serial
            ? ["-s", serial, "shell", command]
            : ["shell", command];
        const result = child_process.spawnSync(this.#filePath, this.#args, this.#options);
        return result;
    }

    /**
     * Reboot ADB in Android device
     * @param {string} serial - Serial number of Android device
     * @returns {child_process.SpawnSyncReturns<Buffer<ArrayBufferLike>>}
     */
    reboot(serial) {
        this.#args = serial
            ? ["-s", serial, "reboot"]
            : ["reboot", ];
        const result = child_process.spawnSync(this.#filePath, this.#args, this.#options);
        return result;
    }
}
