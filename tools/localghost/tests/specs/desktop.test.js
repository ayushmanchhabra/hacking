import { assert } from "node:console";
import path from "node:path";
import process from "node:process";
import { after, before, describe, it } from "node:test";

import get from "@nwutils/getter";
import chrome from "selenium-webdriver/chrome.js";

import nwOptions from "../../.github/config/opt.js";

describe("NW.js Selenium ServiceBuilder test suite", async () => {
  let driver = undefined;

  /* Setup Selenium driver. */
  before(async function () {
    /* Get NW.js  */
    await get(nwOptions);

    /* Initialise Chrome options */
    const chromeOptions = new chrome.Options();

    const seleniumArguments = ["nwapp=" + path.resolve("src", "desktop")];

    /* Run in headless mode when in CI environment. */
    if (process.env.CI) {
      seleniumArguments.push("headless=new");
    }

    chromeOptions.addArguments(seleniumArguments);

    let nwDirPath = path.resolve(
      nwOptions.cacheDir,
      `nwjs${nwOptions.flavor === "sdk" ? "-sdk" : ""}-v${nwOptions.version}-${nwOptions.platform}-${nwOptions.arch}`,
    );

    const chromeDriverPath = path.resolve(nwDirPath, "chromedriver");
    /* Pass file path of NW.js ChromeDriver to ServiceBuilder */
    const service = new chrome.ServiceBuilder(chromeDriverPath).build();

    /* Create a new session using the Chromium options and DriverService defined above. */
    driver = chrome.Driver.createSession(chromeOptions, service);
  });

  /**
   * Get text via element's ID and assert it is equal.
   */
  it("Get application title", async function () {
    const title = await driver.getTitle();
    assert(title, "Localghost");
  });

  /**
   * Quit Selenium driver.
   */
  after(async () => {
    await driver.quit();
  });
});
