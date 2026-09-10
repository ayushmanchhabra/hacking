import { Builder, By } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import fs from "fs";

async function crawlAllLinks(driver, currentUrl, baseDomain, visited = new Set(), graph = {}) {
    if (visited.has(currentUrl)) return graph;
    visited.add(currentUrl);

    console.log("Visiting:", currentUrl);

    try {
        await driver.get(currentUrl);
        const anchors = await driver.findElements(By.css("a"));

        const childLinks = [];

        for (const a of anchors) {
            const href = await a.getAttribute("href");
            if (!href) continue;

            if (href.startsWith(baseDomain)) {
                childLinks.push(href);
            }
        }

        graph[currentUrl] = childLinks;

        for (const nextUrl of childLinks) {
            await crawlAllLinks(driver, nextUrl, baseDomain, visited, graph);
        }
    } catch (err) {
        console.error("Error visiting:", currentUrl, err);
    }

    return graph;
}

async function main() {
    const startUrl = process.argv[2];
    const outputFile = process.argv[3];
    const baseDomain = new URL(startUrl).origin;

    // HEADLESS MODE ENABLED HERE
    const options = new chrome.Options();
    options.addArguments(
        "pageLoadStrategy=none",
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage"
    );

    const driver = await new Builder()
        .forBrowser("chrome")
        .setChromeOptions(options)
        .build();

    const graph = await crawlAllLinks(driver, startUrl, baseDomain);

    await driver.quit();

    fs.writeFileSync(outputFile, JSON.stringify(graph, null, 2));
    console.log("Saved to", outputFile);
}

main();
