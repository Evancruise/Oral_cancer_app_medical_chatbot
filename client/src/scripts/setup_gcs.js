import { Storage } from "@google-cloud/storage";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const projectId = process.env.GCP_PROJECT_ID;
const bucketName = process.env.GCS_BUCKET_NAME;
const region = process.env.GCS_REGION || "asia-east1";

if (!projectId || !bucketName) {
    console.error("Missing GCP_PROJECT_ID or GCS_BUCKET_NAME in .env");
    process.exit(1);
}

const storage = new Storage({ projectId });

async function setupBucket() {
    try {
        console.log(`Creating bucket: ${bucketName} (region: ${region})`);

        // 建立 bucket
        const [ exists ] = await storage.bucket(bucketName).exists();

        if (!exists) {
            await storage.createBucket(bucketName, {
                location: region,
                storageClass: "STANDARD",
                uniformBucketLevelAccess: true,
            });

            console.log(`Bucket created: ${bucketName}`);
        } else {
            console.log(`Bucket already exists: ${bucketName}`);
        }

        // 設定公開讀取
        console.log(`Setting bucket public access...`);
        await storage.bucket(bucketName).iam.setPolicy({
            bindings: [
                {
                    role: "roles/storage.objectViewer",
                    members: ["allUsers"],
                },
            ],
        });
        console.log("Bucket is now publicly readable.");

        // 設定 CORS (允許跨域)
        const corsConfig = [
            {
                origin: ["*"],
                method: ["GET", "HEAD", "PUT", "POST", "DELETE"],
                responseHeader: ["Content-Type", "Access-Control-Allow-Origin"],
                maxAgeSeconds: 3600,
            },
        ];

        console.log("Applying CORS settings...");
        await storage.bucket(bucketName).setCorsConfiguration(corsConfig);
        console.log("CORS policy applied successfully.");

        // 建立 uploads/ 子資料夾
        const tmpFile = path.join(process.cwd(), "temp_gcs_placeholder.txt");
        fs.writeFileSync(tmpFile, "Temporary placeholder for uploads/");
        await storage.bucket(bucketName).upload(tmpFile, {
            destination: "uploads/.keep",
        });
        fs.unlinkSync(tmpFile);

        console.log("Created placeholder in uploads/ folder");
        console.log(`All donw! Bucket '${bucketName}' is ready to use.`);
        console.log(`Public URL example: https://storage.googleapis.com/${bucketName}/uploads/sample.jpg`);

    } catch (err) {
        console.error("Error settings up GCS bucket:", err.message);
        process.exit(1);
    }
}

setupBucket();
