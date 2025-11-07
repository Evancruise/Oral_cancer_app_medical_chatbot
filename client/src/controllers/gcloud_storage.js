import { Storage } from '@google-cloud/storage';
import 'dotenv/config';

const storage = new Storage();
const bucketName = process.env.BUCKET_NAME || 'oral-cancer-storage';

export async function uploadModel(localPath, modelName) {
    await storage.bucket(bucketName).upload(localPath, {
        destination: `models/${modelName}`,
        gzip: true,
    });
    console.log(`Uploaded model to gs://${bucketName}/models/${modelName}`);
}

export async function downloadModel(modelName, destPath) {
    const file = storage.bucket(butcketName).file(`models/${modelName}`);
    await file.download({ destination: destPath });
    console.log(`Download model to ${destPath}`);
}

