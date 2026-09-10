import Adb from "../../../src/aos/adb.js";

// Memu has its own adb.exe, hence the file path needs to be explicity passed.
const adb = new Adb("adb");

const devices = adb.getConnectedDevices();
console.log("\n\nConnected devices:", devices);

const packages = adb.getPackages(undefined);
console.log("\n\nPackages:", packages);

// Path to APK installation in Android device
const paths = adb.getPaths(undefined, "com.krafton.crci");

// Extract APK into out directory
adb.pull(undefined, paths, "./cookierun");
