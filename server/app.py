# app.py
from flask import Flask, request, jsonify
from PIL import Image
import torch
import json
from transformers import pipeline
# from model.architecture import GroundingDINO
# from utils.config import GroundDINOConfig
# from model.inference import grounding_inference_single
# from transformers import AutoModel, AutoProcessor
# from langchain import LLMChain, PromptTemplate
from google.cloud import storage, firestore, run_v2
from concurrent.futures import ThreadPoolExecutor
from job_main import run_inference_job
import threading, uuid
import os
from openai import OpenAI
from dotenv import load_dotenv
load_dotenv()

app = Flask(__name__)

project_id = os.environ.get("GOOGLE_CLOUD_PROJECT_ID")
region = os.environ.get("REGION", "asia-east1")
image_bucket = os.environ.get("GCS_IMAGE_BUCKET", "Oral-images")
model_bucket = os.environ.get("GCS_MODEL_BUCKET", "Oral-models")
job_name = os.environ.get("JOB_NAME", "oral-infer-job")
mode = os.environ.get("NODE_ENV", "developemnt")
client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

# model = AutoModel.from_pretrained("facebook/dinov2-base")
# processor = AutoProcessor.from_pretrained("facebook/dinov2-base")

storage_client = storage.Client()
firestore_client = firestore.Client(project=project_id)
job_client = run_v2.JobsClient(client_options={
    "api_endpoint": f"{region}-run.googleapis.com"
})

def trigger_job(task_id, image_paths, notes, patient_id):
    """
    Call Cloud Run Job -> Feed into task_id / image path / note / patient_id
    """
    job_full_name = job_client.job_path(project_id, region, job_name)
    payload = json.dumps({
        "task_id": task_id,
        "image_paths": image_paths,
        "notes": notes,
        "patient_id": patient_id
    })

    req = run_v2.RunJobRequest(
        name=job_full_name,
        overrides=run_v2.RunJobRequest.Overrides(
            container_overrides=[
                run_v2.RunJobRequest.Overrides.ContainerOverride(
                    name="job-container",
                    args=[payload],
                )
            ]
        )
    )
    job_client.run_job(request=req)

@app.route("/api/predict", methods=["POST"])
def predict():
    form = request.form
    files = request.files    
    patient_id = request.form["patient_id"]
    notes = request.form.get("notes", "")
    task_id = request.form.get("task_id", str(uuid.uuid4()))

    for key, value in request.form.items():
        print(f"{key}: {value}", flush=True)

    task_folder = f"tasks/{task_id}"
    print("------ [Flask] task_id ------", task_id, flush=True)
    images_path_list = []

    if mode == "developemnt":
        for i in range(1, 9):
            key = f"pic{i}"
            if key in files:
                f = files[key]
                save_path = os.path.join("uploads", f.filename)
                images_path_list.append(save_path)
            elif key in form:
                images_path_list.append(form[key])
            else:
                images_path_list.append(None)
    elif mode == "production":
        bucket = storage_client.bucket(image_bucket)

        for i in range(1, 9):
            key = f"pic{i}"
            if key in files:
                f = files[key]
                if f.filename == "":
                    continue
                blob_path = f"{task_folder}/{f.filename}"
                blob = bucket.blob(blob_path)
                blob.upload_from_file(f, content_type=f.mimetype)
                gcs_uri = f"gs://{image_bucket}/{blob_path}"
                images_path_list.append(gcs_uri)

        firestore_client.collection("tasks").document(task_id).set({
            "task_id": task_id,
            "patient_id": patient_id,
            "notes": notes,
            "status": "pending",
            "progress": 0,
            "stage": "Waiting for job...",
        })

    print("------ [Flask] images_path_list ------", images_path_list, flush=True)

    # 啟動 Cloud Run Job （非同步）
    # trigger_job(task_id, images_path_list, notes, patient_id)

    # 🔥 立刻回 response，不等待 model 推論
    return jsonify({
        "status": "ok",
        "task_id": task_id,
        "patient_id": patient_id
    })

@app.route("/api/status/<task_id>", methods=["GET"])
def status(task_id):
    if mode == "development":
        return jsonify({"status": "completed"})
    elif mode == "production":
        '''
        doc = firestore_client.collection("tasks").document(task_id).get()
        if not doc.exists:
            return jsonify({"status": "not_found"}), 404
        return jsonify(doc.to_dict())
        '''
        return jsonify({"status": "completed"})

@app.route("/")
def home():
    return "OK", 200

@app.route("/login")
def login():
    return "OK", 200

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="127.0.0.1", port=port)