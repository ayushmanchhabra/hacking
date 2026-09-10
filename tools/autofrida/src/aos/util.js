import fs from "node:fs";

import xml2js from "xml2js";

/**
 * Finds the launcher/MainActivity from an AndroidManifest.xml file
 * @param {string} filePath Path to AndroidManifest.xml
 * @returns {Promise<string|null>} Full activity name or null if not found
 */
export async function findMainActivity(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8');
  const parser = new xml2js.Parser({ attrkey: '$', explicitArray: false });
  const manifest = await parser.parseStringPromise(xml);

  const pkg = manifest.manifest.$.package;
  const app = manifest.manifest.application;
  const activities = [].concat(
    app.activity || [],
    app['activity-alias'] || []
  );

  for (const act of activities) {
    const intentFilters = [].concat(
      act['intent-filter'] || []
    );

    for (const filter of intentFilters) {
      const actions = [].concat(filter.action || []);
      const categories = [].concat(filter.category || []);

      const hasMain = actions.some(a => a.$['android:name'] === 'android.intent.action.MAIN');
      const hasLauncher = categories.some(c => c.$['android:name'] === 'android.intent.category.LAUNCHER');

      if (hasMain && hasLauncher) {
        // pick targetActivity for alias, else activity name
        let name = act.$['android:targetActivity'] || act.$['android:name'];
        if (name.startsWith('.')) name = pkg + name;
        else if (!name.includes('.')) name = pkg + '.' + name;
        return name;
      }
    }
  }

  return null;
}

export function patchSmali(filePath) {
  let smali = fs.readFileSync(filePath, "utf8").split("\n");

  let inOnCreate = false;
  let patched = false;

  // 🔍 First check if it's already patched
  if (smali.some(line => line.includes("Frida Gadget loader"))) {
    console.log("[ INFO ] Main activity is already patched");
    return;
  }

  for (let i = 0; i < smali.length; i++) {
    let line = smali[i].trim();

    // Detect start of onCreate
    if (line.startsWith(".method protected onCreate(")) {
      inOnCreate = true;
    }

    // Ensure locals >= 1
    if (inOnCreate && line.startsWith(".locals")) {
      let parts = line.split(" ");
      let locals = parseInt(parts[1]);
      if (locals < 1) {
        smali[i] = "    .locals 1";
      }
    }

    // After invoke-super, insert gadget loader
    if (inOnCreate && line.startsWith("invoke-super") && !patched) {
      smali.splice(
        i + 1,
        0,
        '    # --- Frida Gadget loader ---',
        '    const-string v0, "gadget"',
        '    invoke-static {v0}, Ljava/lang/System;->loadLibrary(Ljava/lang/String;)V',
        '    # --- End of Frida Gadget loader ---'
      );
      patched = true;
    }

    // Exit once method ends
    if (inOnCreate && line.startsWith(".end method")) {
      inOnCreate = false;
    }
  }

  fs.writeFileSync(filePath, smali.join("\n"), "utf8");
  console.log("[ INFO ]", filePath, "is", patched ? "patched" : "not patched");
}

/**
 * Strips problematic or unknown attributes from AndroidManifest.xml
 * (for Apktool rebuild compatibility).
 *
 * @param {string} manifestPath - Absolute path to decoded AndroidManifest.xml
 */
export function cleanManifest(manifestPath, badAttrs) {
  if (!fs.existsSync(manifestPath)) {
    console.warn("[ WARN ] AndroidManifest.xml not found at", manifestPath);
    return;
  }

  let xml = fs.readFileSync(manifestPath, "utf8");

  for (const attr of badAttrs) {
    const regex = new RegExp(`\\s+${attr}="[^"]*"`, "g");
    xml = xml.replace(regex, "");
  }

  fs.writeFileSync(manifestPath, xml, "utf8");
  console.log("[ INFO ] Cleaned AndroidManifest.xml of unsupported attributes.");
}

export function setDebuggableTrue(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    console.warn("[ WARN ] AndroidManifest.xml not found at", manifestPath);
    return;
  }

  let xml = fs.readFileSync(manifestPath, "utf8");

  // If <application> tag already has android:debuggable attribute
  if (xml.match(/<application[^>]*android:debuggable="/)) {
    // Replace its value with "true"
    xml = xml.replace(/(android:debuggable\s*=\s*")[^"]*(")/, '$1true$2');
  } else {
    // Otherwise, inject android:debuggable="true" into the <application> tag
    xml = xml.replace(/<application\b([^>]*)>/, '<application$1 android:debuggable="true">');
  }

  fs.writeFileSync(manifestPath, xml, "utf8");
  console.log("[ INFO ] Set android:debuggable=\"true\" in AndroidManifest.xml");
}

