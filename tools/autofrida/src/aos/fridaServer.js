import console from "node:console";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import stream from "node:stream";

import axios from "axios";

import Adb from './adb.js';
import Frida from './frida.js';
import SevenZip from "./7z.js";

/**
 * 
 * @param {string | undefined} deviceName - Device serial number, if undefined the first connected device will be used
 * @param {string} packageName - Name of target package
 * @param {{dname: {CN: string, OU: string, O: string, L: string, ST: string, C: string}}} keystoreOptions - Options for the keystore
 */
export default async function server(deviceName, packageName, mitmCert, fridaScript) {
    /* Initialise tools */
    const adb = new Adb('adb');
    const frida = new Frida('frida');
    const sevenZip = new SevenZip('7z');

    /* Get an array of connected devices. If none connected, then exit with error message. */
    const devices = adb.getConnectedDevices();
    if (false || devices.length === 0) {
        console.log('[ INFO ] No devices connected. Please check and try again.');
        return;
    }

    const deviceArch = adb.getDeviceArch(deviceName);
    const fridaVersion = frida.version();

    /* Initialise directories */
    let homeDir = process.env.TASKFORCE_AOS_HOME_DIR;
    if (homeDir === undefined) {
        homeDir = path.resolve(os.homedir(), ".taskforce");
    }
    const packageDir = path.resolve(homeDir, packageName);
    const cachedDir = path.resolve(packageDir, 'cached');

    /* Check if mitmCert exists. */
    if (fs.existsSync(mitmCert) === false) {
        throw new Error('Missing MITM certificate.');
    }

    // /* Pull the APK or use a cached version. */
    // if (fs.existsSync(cachedDir) && fs.readdirSync(cachedDir).length !== 0) {
    //     console.log('[ INFO ] Using APK cached at', cachedDir);
    // } else {
    //     /* If package is not installed, then exit with error message. */
    //     const paths = adb.getPaths(deviceName, packageName);
    //     if (paths === undefined) {
    //         console.log('[ INFO ] APK name is incorrect or does not exist in device.');
    //         return;
    //     }
    //     console.log('[ INFO ] APK successfully pulled.');
    //     adb.pull(deviceName, paths, cachedDir);
    // }

    console.log('[ INFO ] Pushed MITM cert to Android device.');
    adb.push(deviceName, mitmCert, '/sdcard/Download/burp.crt');
    adb.push(deviceName,mitmCert,'/system/etc/security/cacerts/mitm.0');
    adb.shell(deviceName, 'chmod 644 /system/etc/security/cacerts/mitm.0');
    adb.push(deviceName, mitmCert, '/data/local/tmp/cert-der.crt');
    // adb.reboot(deviceName);

    const fridaServerXz = path.resolve(homeDir, 'frida-server.xz')
    const fridaServer = path.resolve('.', 'frida-server')
    const writeStream = fs.createWriteStream(fridaServerXz);

    /** @type {'arm' | 'arm64' | 'x86' | 'x86_64'} */
    let arch = '';
    if (deviceArch.includes("arm")) {
        if (deviceArch.includes("64")) {
            arch = 'arm64';
        } else {
            arch = 'arm';
        }
    } else {
        arch = deviceArch;
    }

    let response;
    if (fs.existsSync(fridaServerXz) !== true) {
        console.log('[ INFO ] Download frida-server.');
        response = await axios({
            method: 'get',
            url: `https://github.com/frida/frida/releases/download/${fridaVersion}/frida-server-${fridaVersion}-android-${arch}.xz`,
            responseType: 'stream',
        });
        await stream.promises.pipeline(response.data, writeStream);
    } else {
        console.log('[ INFO ] Using cached Frida Server.');
    }

    console.log('[ INFO ] Decompressing Frida Server XZ file.');
    /* Outputs to process.cwd() or present working directory of the node process. */
    sevenZip.x(fridaServerXz);

    console.log('[ INFO ] Push frida-server to Android device');
    adb.push(deviceName, fridaServer, '/data/local/tmp/');
    adb.shell(deviceName, 'chmod 755 /data/local/tmp/frida-server');

    console.log('[ INFO ] Kill the existing frida-server');
    const stdout = adb.shell(deviceName, 'ps').stdout;
    const fridaPid = stdout
        .split('\n')
        .map(line => line.trim())
        .find(line => line.endsWith('frida-server'))
        ?.split(/\s+/)[1];
    adb.shell(deviceName, `kill ${fridaPid}`);
    console.log('[ INFO ] Restart the frida-server');
    adb.shell(deviceName, '/data/local/tmp/frida-server >/dev/null 2>&1 &');

    console.log('[ INFO ] Run Frida script');
    const result = frida.loadFile(packageName, fridaScript);
    console.log(`[ INFO ] Frida script output: `);
    console.log(result.stdout);
}
