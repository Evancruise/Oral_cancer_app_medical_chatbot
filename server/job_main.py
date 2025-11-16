import torch
from model.architecture import GroundingDINO
from utils.config import GroundDINOConfig
from model.inference import grounding_inference_single
from google.cloud import storage, firestore, run_v2
import json
import os
import sys
from openai import OpenAI

tasks_list = {}

storage_client = storage.Client()
firestore_client = firestore.Client()

from dotenv import load_dotenv
load_dotenv()

project_id = os.environ.get("GOOGLE_CLOUD_PROJECT_ID")
region = os.environ.get("REGION", "asia-east1")
image_bucket = os.environ.get("GCS_IMAGE_BUCKET", "Oral-images")
model_bucket = os.environ.get("GCS_MODEL_BUCKET", "Oral-models")
job_name = os.environ.get("JOB_NAME", "oral-infer-job")
mode = os.environ.get("NODE_ENV", "developemnt")
client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

def generate_llm_report(notes, detections):
    prompt = f"""
    You are an oral-healthcare assistant.
    Patient notes: {notes}
    Detection results: {detections}
    Write a medical report summarizing possible lesions.
    """

    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are an oral-healthcare LLM."},
            {"role": "user", "content": prompt}
        ],
        max_tokens=300,
    )

    return resp.choices[0].message["content"]

def download_model(model_bucket):
    bucket = storage_client.bucket(model_bucket)
    blob = bucket.blob("groundingdino/best_model_epoch10.pth")
    local_path = "/tmp/best_model_epoch10.pth"
    blob.download_to_filename(local_path)
    print(f"[Job] Model download to {local_path}", flush=True)
    return local_path

def download_images(image_paths, task_id):
    """
    把 GCS 的圖片放到 /tmp/task_id/xxx.jpg
    再行回傳 image_paths: ['gs://oral-images/tasks/<task_id>/a.jpg', ...]
    """
    local_paths = []
    base_dir = f"/tmp/{task_id}"
    os.makedirs(base_dir, exist_ok=True)

    for uri in image_paths:
        if not uri:
            continue

        assert uri.startswith("gs://")
        _, rest = uri.split("gs://", 1)
        bucket_name, blob_path = rest.split("/", 1)
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(blob_path)

        filename = os.path.basename(blob_path)
        local_path = os.path.join(base_dir, filename)
        blob.download_to_filename(local_path)
        local_paths.append(local_path)
        print(f"[Job] Downloaded image {uri} -> {local_path}", flush=True)
    
    return local_paths

def update_task(task_id, **fields):
    firestore_client.collection("tasks").document(task_id).set(
        fields, merge=True
    )

def run_inference_job(payload):
    task_id = payload["task_id"]
    image_paths = payload.get("image_paths", [])
    notes = payload.get("notes", "")
    patient_id = payload.get("patient_id", "unknown")

    print(f"[Job] Start task {task_id}", flush=True)
    update_task(task_id, status="running", stage="Downloading model...", progress=10)

    # Download images
    local_images = download_images(image_paths, task_id)

    update_task(task_id, stage="Running inference...", progress=70)

    # Inference phase
    inference(task_id, local_images, notes)
    return

def inference(task_id, gcs_image_paths, notes):
    """
    Cloud Run Job inference pipeline:
    1. Download model
    2. Load GroundingDINO (CPU)
    3. Download images
    4. Run detection
    5. Send notes + detection to LLM API (VertexAI or OpenAI)
    6. Save result to Firestore
    """

    device = "cuda" if torch.cuda.is_available() else "cpu"

    update_task(task_id, stage="Setting up environment...", progress=10)

    # ---------------------------
    # 1. Load GroundingDINO model
    # ---------------------------
    cfg = GroundDINOConfig()
    model = GroundingDINO(cfg).to(device)

    update_task(task_id, stage="Downloading model...", progress=20)
    ckpt_path = download_model(model_bucket)  # /tmp/model.pth

    state_dict = torch.load(ckpt_path, map_location=device)
    model.load_state_dict(state_dict)
    model.eval()

    # ---------------------------
    # 2. Download images
    # ---------------------------
    update_task(task_id, stage="Downloading images...", progress=30)
    local_images = download_images(gcs_image_paths, task_id)  # return local paths

    # ---------------------------
    # 3. Detection loop
    # ---------------------------
    detections = []

    update_task(task_id, stage="Analyzing images...", progress=40)

    for i, img_path in enumerate(local_images):
        update_task(
            task_id,
            stage=f"Analyzing lesion pattern ({i+1}/{len(local_images)})",
            progress=int(40 + (40/len(local_images))*(i+1))
        )

        result = grounding_inference_single(
            model=model,
            image_path=img_path,
            prompt=f"find oral lesion, patient notes: {notes}",
            checkpoint_path=ckpt_path,
            device=device,
            box_thresh=0.3,
            text_thresh=0.25
        )
        detections.append(result)

    # ---------------------------
    # 4. LLM (API-based) Report
    # ---------------------------
    update_task(task_id, stage="Generating medical report...", progress=85)

    llm_report = generate_llm_report(notes, detections)

    # ---------------------------
    # 5. Final result
    # ---------------------------
    result = {
        "status": "ok",
        "detections": detections,
        "llm_report": llm_report,
        "notes": notes,
    }

    update_task(task_id, stage="Inference complete", progress=100, result=result)

    return result

'''
def inference(task_id, images_path_list, notes):

    print("Running inference...", flush=True)

    cfg = GroundDINOConfig()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = GroundingDINO(cfg).to(device)

    update_task(task_id, stage="Downloading images...", progress=30)
    # download_from_gcs("groundingdino/best_model_epoch10.pth", "/tmp/model.pth")
    ckpt_path = download_model()
    state_dict = torch.load(ckpt_path)
    model.load_state_dict(state_dict)

    update_task(task_id, stage="Inferencing...", progress=60)

    for i, img_path in enumerate(images_path_list):

        update_task(task_id, stage=f"Analyzing lesion patterns for {i+1}-th image...", progress = int(60 + (i+1) * (30/len(images_path_list))))

        if img_path:
            grounding_inference_single(
                model=model,
                image_path=img_path,
                prompt= f"find oral lesion, patient notes: {notes}",
                checkpoint_path="/tmp/model.pth",
                device="cuda" if torch.cuda.is_available() else "cpu",
                box_thresh=0.3,
                text_thresh=0.25
            )
    
    update_task(task_id, stage="Generating LangChain report...", progress=90)

    pipe = pipeline(
        "text-generation",
        model="meta-llama/Llama-3.2-3B-Instruct",
        torch_dtype=torch.float16,
        device_map="auto",
    )

    messages = [
        {"role": "system", "content": "You are an AI assistant trained on oral-healthcare knowledge retrieved \
                from multiple verified dental and medical resources. \
                Use retrieval results to answer accurately and concisely. \
                When unsure, clarify limitations and refer to professional dental consultation."},
        {"role": "user", "content": notes},
    ]

    outputs = pipe(
        messages,
        max_new_tokens=256,
    )

    result = {"reply": outputs[0]["generated_text"][-1], "status": "ok"}
    update_task(task_id, stage="Inference complete", result=result, progress=100)

    return result
'''

def main():
    # Cloud Run Job 我們剛剛設計是用「一個 JSON 字串當 args[0]」
    if len(sys.argv) < 2:
        print("Usage: job_main.py '<JSON_PAYLOAD>'", flush=True)
        sys.exit(1)

    payload_str = sys.argv[1]
    payload = json.loads(payload_str)

    run_inference_job(payload)

if __name__ == "__main__":
    main()