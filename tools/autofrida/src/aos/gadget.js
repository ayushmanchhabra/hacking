import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import stream from "node:stream";

import axios from "axios";

import Adb from './adb.js';
import Apksigner from './apksigner.js';
import Apktool from './apktool.js';
import Frida from './frida.js';
import Keytool from './keytool.js';
import { cleanManifest, findMainActivity, patchSmali } from "./util.js";
import Zipalign from './zipalign.js';

/**
 * 
 * @param {string | undefined} deviceName - Device serial number, if undefined the first connected device will be used
 * @param {string} packageName - Name of target package
 * @param {string} fridaScript - Path to the Frida script to be injected
 * @param {object} keystoreOptions - Options for the keystore
 * @param {string} homeDir - Path to cached APKs
 */
export default async function gadget(deviceName, packageName, fridaScript, keystoreOptions, homeDir) {
    /* Initialise tools */
    const adb = new Adb('adb');
    const apksigner = new Apksigner("apksigner");
    const apktool = new Apktool("apktool");
    const frida = new Frida("frida");
    const KeyTool = new Keytool("keytool");
    const zipalign = new Zipalign("zipalign");

    /* Get an array of connected devices. If none connected, then exit with error message. */
    const devices = adb.getConnectedDevices();
    if (false || devices.length === 0) {
        console.log('[ INFO ] No devices connected. Please check and try again.');
        return;
    }

    /* Make calls before connection to device breaks. */
    const deviceArch = adb.getDeviceArch(deviceName);

    /* Initialise directories */
    if (homeDir === undefined) {
        homeDir = path.resolve(os.homedir(), ".taskforce");
    }
    const packageDir = path.resolve(homeDir, packageName);
    const cachedDir = path.resolve(packageDir, 'cached');
    const decodedDir = path.resolve(packageDir, 'decoded');
    const patchedDir = path.resolve(packageDir, 'patched');
    const alignedDir = path.resolve(packageDir, 'aligned');
    const signedDir = path.resolve(packageDir, 'signed');
    const libFridaGadgetCachedPath = path.resolve(homeDir, 'libgadget.so');
    const libFridaGadgetDecodedPath = path.resolve(decodedDir, `split_config.${deviceArch.replace(/-/g, "_")}`, "lib", deviceArch, 'libgadget.so');
    const libFridaGadgetConfigCachedPath = path.resolve("src", "aos", 'libgadget.config.so');
    const libFridaGadgetConfigDecodedPath = path.resolve(decodedDir, `split_config.${deviceArch.replace(/-/g, "_")}`, "lib", deviceArch, 'libgadget.config.so');


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

    /* Decode all APKs. */
    for (const file of fs.readdirSync(cachedDir)) {
        const inputFilePath = path.resolve(cachedDir, file);
        const outputFilePath = path.resolve(decodedDir, file.replace(/\.apk$/i, ''));
        if (fs.existsSync(outputFilePath)) {
            console.log('[ INFO ]', file, 'is already cached at', outputFilePath, ', skipping decoding.');
        } else {
            console.log('[ INFO ] Decoding', file, 'and saving at', outputFilePath);
            apktool.decode(inputFilePath, outputFilePath);
        }
    }

    /* Get Frida version */
    const fridaVersion = frida.version();
    console.log("[ INFO ] Frida version is", fridaVersion);

    /* Download Frida Gadget shared library. */
    const libFridaCachedPath = path.resolve(homeDir, "libgadget.so");
    const writeStream = fs.createWriteStream(libFridaCachedPath);

    if (fs.existsSync(libFridaCachedPath)) {
        console.log("[ INFO ] Using cached Frida Gadget shared library at", libFridaCachedPath);
    } else {
        console.log("[ INFO ] Downloading Frida Gadget shared library to", libFridaCachedPath);
        let DEVICE_ARCH = "";
        if (deviceArch.includes("arm64")) {
            DEVICE_ARCH = "arm64";
        }
        const FRIDA_GADGET_URL = `https://github.com/frida/frida/releases/download/${fridaVersion}/frida-gadget-${fridaVersion}-android-${DEVICE_ARCH}.so.xz`.trim();
        // TODO: Use a syncronous API
        const response = await axios({
            method: 'get',
            url: FRIDA_GADGET_URL,
            responseType: 'stream'
        });

        // TODO: Use a syncronous API
        await stream.promises.pipeline(response.data, writeStream);
    }

    /* Copy Frida Gadget shared library inside decoded APK */
    if (fs.existsSync(libFridaGadgetDecodedPath)) {
        console.log('[ INFO ] Frida Gadget shared library is already cached.');
    } else {
        console.log('[ INFO ] Copying', libFridaCachedPath, 'to', libFridaGadgetDecodedPath);
        fs.cpSync(libFridaGadgetCachedPath, libFridaGadgetDecodedPath);
    }

    /* Copy Frida Gadget config file inside decoded APK */
    if (fs.existsSync(libFridaGadgetConfigDecodedPath)) {
        console.log('[ INFO ] Frida Gadget config file is already cached.');
    } else {
        console.log('[ INFO ] Copying', libFridaGadgetConfigCachedPath, 'to', libFridaGadgetConfigDecodedPath);
        fs.cpSync(libFridaGadgetConfigCachedPath, libFridaGadgetConfigDecodedPath);
    }

    /* Find MainActivity name */
    const baseApkFilePath = path.resolve(decodedDir, "base");
    const mainActivity = await findMainActivity(path.resolve(baseApkFilePath, "AndroidManifest.xml"));
    console.log('[ INFO ] Main Activity found at', mainActivity);

    /* Search for main activity */
    const mainActivityPath = mainActivity.replace(/\./g, "/") + ".smali";
    const dirs = fs.readdirSync(baseApkFilePath).filter(s => s.startsWith("smali"));
    let absoluteMainActivityPath = "";
    for (const dir of dirs) {
        const activityPath = path.join(baseApkFilePath, dir, mainActivityPath);
        if (fs.existsSync(activityPath)) {
            absoluteMainActivityPath = activityPath;
        }
    }

    /* Patch smali code */
    console.log("[ INFO ] Main activity path is at", absoluteMainActivityPath);
    patchSmali(absoluteMainActivityPath);

    /* Clean manifest file */
    const manifestPath = path.join(baseApkFilePath, "AndroidManifest.xml");
    const badAttrs = [
        "android:pageSizeCompat",
        "android:compileSdkVersionCodename",
        "android:compileSdkVersion",
        "android:isSplitRequired",
        "android:isFeatureSplit",
        "android:allowCrossUidActivitySwitchFromBelow"
    ];
    cleanManifest(manifestPath, badAttrs);

    /* Rebuild decoded and patched APKs */
    for (const dir of fs.readdirSync(decodedDir)) {
        const inputFilePath = path.resolve(decodedDir, dir);
        const outputFilePath = path.resolve(patchedDir, `${dir}.apk`);
        if (fs.existsSync(outputFilePath)) {
            console.log('[ INFO ]', dir, 'is already cached at', outputFilePath, ', skipping decoding.');
        } else {
            console.log('[ INFO ] Building', dir, 'and saving at', outputFilePath);
            apktool.build(inputFilePath, outputFilePath);
        }
    }

    /* Align rebuilt APKs */
    fs.mkdirSync(alignedDir, { recursive: true });
    for (const file of fs.readdirSync(patchedDir)) {
        const inputFilePath = path.resolve(patchedDir, file);
        const outputFilePath = path.resolve(alignedDir, file);
        if (fs.existsSync(outputFilePath)) {
            console.log('[ INFO ]', file, 'is already aligned at', outputFilePath, ', skipping aligning.');
        } else {
            console.log('[ INFO ] Aligning', file, 'and saving at', outputFilePath);
            zipalign.align(inputFilePath, outputFilePath);
        }
    }

    /* Create keyStore */
    const keyStorePath = path.resolve(homeDir, "keystore.jks");
    if (fs.existsSync(keyStorePath)) {
        console.log("[ INFO ] Using previously created KeyStore at", keyStorePath);
    } else {
        console.log("[ INFO ] Creating KeyStore");
        KeyTool.createKeyStore(keyStorePath, "keystore", "password", "password", 365);
    }

    /* Sign APK files */
    fs.mkdirSync(signedDir, { recursive: true });
    for (const file of fs.readdirSync(alignedDir)) {
        const inputFilePath = path.resolve(alignedDir, file);
        const outputFilePath = path.resolve(signedDir, file);
        if (fs.existsSync(outputFilePath)) {
            console.log('[ INFO ]', file, 'is already signed at', outputFilePath, ', skipping signing.');
        } else {
            console.log('[ INFO ] Signing', file, 'and saving at', outputFilePath);
            apksigner.sign(keyStorePath, "password", "keystore", inputFilePath, outputFilePath);
        }
    }

    /* Install APKs files */
    const signedApkFilePaths = fs.readdirSync(signedDir)
        .filter(file => !file.endsWith(".idsig"))
        .map(file => path.join(cachedDir, file));
    // console.log('[ INFO ] Uninstalling original APK into device...');
    // adb.uninstall(deviceName, packageName);
    console.log('[ INFO ] Reinstalling modified APK into device.');
    const res = adb.installMultiple(deviceName, signedApkFilePaths);
    console.log(res);

    /* Push Frida Gadget config file to device */
    // TODO: figure out Frida strategy later. We can apply inversion of control and let the user do this.
    console.log('[ INFO ] Pushing fridaScript into device.');
    adb.push(deviceName, fridaScript, "/data/local/tmp/frida.js");
}