from google.cloud import storage
import os

BUCKET = "oral-dinov3-data"

LOCAL_DIR_JSON = "annotations_fhir_json"
GCS_PREFIX_JSON = "annotations_fhir_json"
LOCAL_DIR_IMAGE = "annotations_fhir_images"
GCS_PREFIX_IMAGE = "annotations_fhir_images"

client = storage.Client()
bucket = client.bucket(BUCKET)

for phase in ["train", "val", "test"]:
    for fname in os.listdir(f"./{phase}/{LOCAL_DIR_JSON}"):
        if not fname.endswith(".json"):
            continue
        
        local_path = os.path.join(f"./{phase}/{LOCAL_DIR_JSON}", fname)
        blob = bucket.blob(f"{phase}/{GCS_PREFIX_JSON}/{fname}")
        blob.upload_from_filename(local_path)
        print(f"Uploaded {fname}")

    for fname in os.listdir(f"./{phase}/{LOCAL_DIR_IMAGE}"):
        if not fname.endswith(".png"):
            continue

        local_path = os.path.join(f"./{phase}/{LOCAL_DIR_IMAGE}", fname)
        blob = bucket.blob(f"{phase}/{GCS_PREFIX_IMAGE}/{fname}")
        blob.upload_from_filename(local_path)
        print(f"Uploaded {fname}")
