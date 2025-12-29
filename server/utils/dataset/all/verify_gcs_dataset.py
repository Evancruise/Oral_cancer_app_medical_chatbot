from google.cloud import storage
import json
import os

# ========================
# === USER CONFIG HERE ===
# ========================
BUCKET_NAME = "oral-dinov3-data"
ANNOT_PREFIX = "annotations_fhir_json"
IMAGE_PREFIX = "annotations_fhir_images"
IMAGE_EXTS = [".png", ".jpg", ".jpeg"]
MAX_PRINT = 20

# ===================
# === GCS HELPERS ===
# ===================
def list_gcs_files(bucket, prefix):
    return [
        blob.name for blob in bucket.list_blobs(prefix=prefix)
        if not blob.name.endswith("/")
    ]

def extract_id_from_path(path):
    return os.path.splitext(os.path.basename(path))[0]

# =========================
# === MAIN VERIFY LOGIC ===
# =========================
def main():
    client = storage.Client()
    bucket = client.bucket(BUCKET_NAME)

    print("Listing annotation JSON files...")
    json_files = list_gcs_files(bucket, ANNOT_PREFIX)
    json_ids = {extract_id_from_path(p) for p in json_files if p.endswith(".json")}

    print(f"Found {len(json_ids)} JSON files")

    print("Listing image files...")
    image_files = list_gcs_files(bucket, IMAGE_PREFIX)
    image_ids = {
        extract_id_from_path(p)
        for p in image_files
        if any(p.lower().endswith(ext) for ext in IMAGE_EXTS)
    }

    print(f"Found {len(image_ids)} image files")

    # -------------------------
    json_without_image = sorted(json_ids - image_ids)
    image_without_json = sorted(image_ids - json_ids)

    # --------------------------
    # JSON content validation
    # --------------------------
    bad_image_refs = []

    for blob_path in json_files:
        if not blob_path.endswith(".json"):
            continue

        blob = bucket.blob(blob_path)
        content = blob.download_as_text()
        data = json.loads(content)

        img_path = data.get("image_name", "")
        if not img_path.startswith("gs://"):
            bad_image_refs.append((blob_path, "image_name not gs:// path"))
            continue

        # ==== Parse gs://bucket/path
        try:
            _, rest = img_path.split("gs://", 1)
            img_bucket, img_blob = rest.split("/", 1)
        except:
            bad_image_refs.append((blob_path, "invalid gs:// format"))
            continue

        if img_bucket != BUCKET_NAME:
            bad_image_refs.append((blob_path, f"wrong bucket: {img_bucket}"))
            continue

        if not bucket.blob(img_blob).exists():
            bad_image_refs.append((blob_path, f"image not found: {img_blob}"))
    
    # ==============
    # === REPORT ===
    # ==============
    print("\n========== DATASET VERIFY REPORT ==========\n")

    print(f"Total JSON files        : {len(json_ids)}")
    print(f"Total image files       : {len(image_ids)}")
    print(f"JSON without image      : {len(json_without_image)}")

    for i, k in enumerate(json_without_image[:MAX_PRINT]):
        print(f"   - {k}")
    
    if len(json_without_image) > MAX_PRINT:
        print("  ...")
    
    print(f"\nImage without JSON    : {len(image_without_json)}")

    for i, k in enumerate(image_without_json[:MAX_PRINT]):
        print(f"   - {k}")
    
    if len(image_without_json) > MAX_PRINT:
        print("  ...")
    
    print(f"\nInvalid image_name ref: {len(bad_image_refs)}")

    for i, (jp, reason) in enumerate(bad_image_refs[:MAX_PRINT]):
        print(f"   - {jp} | {reason}")
    
    if len(bad_image_refs) > MAX_PRINT:
        print("  ...")
    
    # =====================
    # === Final verdict ===
    # =====================
    if not json_without_image and not image_without_json and not bad_image_refs:
        print("\n✅ DATASET CHECK PASSED: JSON and images are fully aligned.")
    else:
        print("\n⚠️ DATASET CHECK FAILED: Please fix issues above.")

if __name__ == "__main__":
    main()



