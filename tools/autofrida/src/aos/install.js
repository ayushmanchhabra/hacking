import axios from "axios";

export default async function install(fileName, downloadPath) {
    const writeStream = fs.createWriteStream(libFridaCachedPath);

    if (fs.existsSync(fileName)) {
        console.log("[ INFO ] Using cached", fileName);
    } else {
        console.log("[ INFO ] Downloading", fileName, "from", downloadPath);
        const response = await axios({
            method: 'get',
            url: downloadPath,
            responseType: 'stream'
        });

        // TODO: Use a syncronous API
        await stream.promises.pipeline(response.data, writeStream);
    }
}
