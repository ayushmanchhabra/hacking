import path from "node:path";

import Adb from "../../../src/aos/adb.js";

function extractApk(relativeOutDir) {
    const adb = new Adb("adb");

    const devices = adb.getConnectedDevices();
    console.log("\n\nConnected devices:", devices);

    const packages = adb.getPackages(undefined);
    console.log("\n\nPackages:", packages);

    // Path to APK installation in Android device
    const paths = adb.getPaths(undefined, "com.krafton.crci");

    // Extract APK into out directory
    adb.getAdb(undefined, paths, relativeOutDir);

    return path.resolve(relativeOutDir)
}

const absoluteOutDir = extractApk("com.krafton.crci");
