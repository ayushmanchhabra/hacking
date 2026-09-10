import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import Adb from './adb.js';
import Apksigner from './apksigner.js';
import Apktool from './apktool.js';
import Keytool from './keytool.js';
import Zipalign from './zipalign.js';

/**
 * 
 * @param {string | undefined} deviceName - Device serial number, if undefined the first connected device will be used
 * @param {string} packageName - Name of target package
 * @param {{dname: {CN: string, OU: string, O: string, L: string, ST: string, C: string}}} keystoreOptions - Options for the keystore
 * @param {(packageDir) => void | undefined} callback - User specific modifications made to decoded APK before rebuilding.
 */
export default function mod(deviceName, packageName, keystoreOptions, callback) {
    /* Initialise tools */
    const adb = new Adb('adb');
    const apksigner = new Apksigner("apksigner");
    const apktool = new Apktool("apktool");
    const KeyTool = new Keytool("keytool");
    const zipalign = new Zipalign("zipalign");

    /* Get an array of connected devices. If none connected, then exit with error message. */
    const devices = adb.getConnectedDevices();
    if (false || devices.length === 0) {
        console.log('[ INFO ] No devices connected. Please check and try again.');
        return;
    }

    const deviceArch = adb.getDeviceArch(deviceName);

    /* Initialise directories */
    let homeDir = process.env.TASKFORCE_AOS_HOME_DIR;
    if (homeDir === undefined) {
        homeDir = path.resolve(os.homedir(), ".taskforce");
    }
    const packageDir = path.resolve(homeDir, packageName);
    const cachedDir = path.resolve(packageDir, 'cached');
    const decodedDir = path.resolve(packageDir, 'decoded');
    const patchedDir = path.resolve(packageDir, 'patched');
    const alignedDir = path.resolve(packageDir, 'aligned');
    const signedDir = path.resolve(packageDir, 'signed');

    /* Pull the APK or use a cached version. */
    if (fs.existsSync(cachedDir) && fs.readdirSync(cachedDir).length !== 0) {
        console.log('[ INFO ] Using APK cached at', cachedDir);
    } else {
        /* If package is not installed, then exit with error message. */
        const paths = adb.getPaths(deviceName, packageName);
        if (paths === undefined) {
            console.log('[ INFO ] APK name is incorrect or does not exist in device.');
            return;
        }
        console.log('[ INFO ] APK successfully pulled.');
        adb.pull(deviceName, paths, cachedDir);
    }

    /* Decode base.apk */
    fs.rmSync(patchedDir, { recursive: true, force: true });
    fs.mkdirSync(patchedDir, { recursive: true });
    const baseApkCached = path.resolve(cachedDir, "base.apk");
    const baseApkDecoded = path.resolve(decodedDir, "base");
    console.log('[ INFO ] Decoding base.apk and saving at', baseApkDecoded);
    apktool.decode(baseApkCached, baseApkDecoded);

    if (typeof callback === "function") {
        console.log('[ INFO ] Executing user specified script.');
        callback(packageDir);
    }

    /* Rebuild decoded and patched base.apk */
    fs.rmSync(patchedDir, { recursive: true, force: true });
    fs.mkdirSync(patchedDir, { recursive: true });
    const baseDirDecoded = path.resolve(decodedDir, "base");
    const baseApkPatched = path.resolve(patchedDir, "base.apk");
    console.log('[ INFO ] Building', baseDirDecoded, 'and saving at', baseApkPatched);
    apktool.build(baseDirDecoded, baseApkPatched);
    const archDirDecoded = path.resolve(decodedDir, `split_config.${deviceArch.replace(/-/g, "_")}`);
    const archApkPatched = path.resolve(patchedDir, `split_config.${deviceArch.replace(/-/g, "_")}.apk`);
    console.log('[ INFO ] Building', archDirDecoded, 'and saving at', archApkPatched);
    apktool.build(archDirDecoded, archApkPatched);

    /* Copy remaining split_config* APKs. */
    for (const file of fs.readdirSync(cachedDir)) {
        const inputFilePath = path.resolve(cachedDir, file);
        const outputFilePath = path.resolve(patchedDir, file);
        if (fs.existsSync(outputFilePath)) {
            console.log('[ INFO ]', outputFilePath, 'already exists, skipping.');
        } else {
            console.log('[ INFO ] Copying', inputFilePath, 'and saving at', outputFilePath);
            fs.cpSync(inputFilePath, outputFilePath, { recursive: true });
        }
    }

    /* Align rebuilt APKs */
    fs.rmSync(alignedDir, { recursive: true, force: true });
    fs.mkdirSync(alignedDir, { recursive: true });
    for (const file of fs.readdirSync(patchedDir)) {
        const inputFilePath = path.resolve(patchedDir, file);
        const outputFilePath = path.resolve(alignedDir, file);
        console.log('[ INFO ] Aligning', file, 'and saving at', outputFilePath);
        zipalign.align(inputFilePath, outputFilePath);
    }

    /* Create keyStore */
    const keyStorePath = path.resolve(homeDir, "keystore.jks");
    if (fs.existsSync(keyStorePath)) {
        console.log("[ INFO ] Using previously created KeyStore at", keyStorePath);
    } else {
        console.log("[ INFO ] Creating KeyStore");
        KeyTool.createKeyStore(keyStorePath, "keystore", "password", "password", 365, {
            CN: keystoreOptions.dname.CN,
            OU: keystoreOptions.dname.OU,
            O: keystoreOptions.dname.O,
            L: keystoreOptions.dname.L,
            ST: keystoreOptions.dname.ST,
            C: keystoreOptions.dname.C,
        });
    }

    /* Sign APK files */
    fs.rmSync(signedDir, { recursive: true, force: true });
    fs.mkdirSync(signedDir, { recursive: true });
    for (const file of fs.readdirSync(alignedDir)) {
        const inputFilePath = path.resolve(alignedDir, file);
        const outputFilePath = path.resolve(signedDir, file);
        console.log('[ INFO ] Signing', file, 'and saving at', outputFilePath);
        apksigner.sign(keyStorePath, "password", "keystore", inputFilePath, outputFilePath);
    }

    /* Install APKs files */
    const signedApkFilePaths = fs.readdirSync(signedDir)
        .filter(file => !file.endsWith(".idsig"))
        .map(file => path.join(cachedDir, file));
    console.log('[ INFO ] Uninstalling original APK into device.');
    if (adb.getPaths(deviceName, packageName) !== undefined) {
        adb.uninstall(deviceName, packageName);
    }
    console.log('[ INFO ] Reinstalling modified APK into device.');
    const result = adb.installMultiple(deviceName, signedApkFilePaths);
    console.log(result);
}
