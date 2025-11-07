# app.py
from flask import Flask, request, jsonify
from PIL import Image
import torch
from model.architecture import GroundingDINO
from model.inference import grounding_inference_single
from transformers import AutoModel, AutoProcessor
from langchain import LLMChain, PromptTemplate
from google.cloud import storage
import threading, time, uuid
import os

app = Flask(__name__)

model = AutoModel.from_pretrained("facebook/dinov2-base")
processor = AutoProcessor.from_pretrained("facebook/dinov2-base")
tasks_list = {}

def upload_to_gcs(local_path, remote_path):
    client = storage.Client()
    bucket = client.bucket(os.getenv("BUCKET_NAME"))
    blob = bucket.blob(remote_path)
    blob.upload_from_filename(local_path)
    print(f"Uploaded: gs://{bucket.name}/{remote_path}")

def download_from_gcs(remote_path, local_path):
    client = storage.Client()
    bucket = client.bucket(os.getenv("BUCKET_NAME"))
    blob = bucket.blob(remote_path)
    blob.download_to_filename(local_path)
    print(f"Downloaded: {remote_path}")

def run_inference(task_id, patient_id, images_path_list, notes):

    print("Running inference...", flush=True)

    '''
    inputs = processor(images=image, return_tensors="pt")
    features = model(**inputs).last_hidden_state.mean(dim=1)

    prompt = PromptTemplate.from_template(
        "Describe possible oral lesion findings from this embedding vector."
    )
    llm_chain = LLMChain(llm=..., prompt=prompt)
    report = llm_chain.run(features.tolist())

    return jsonify({
        "risk_level": "moderate",
        "report": report
    })
    '''

    stages = [
        ("Loading model weights...", 10),
        ("Extracting DINOv2 features...", 40),
        ("Analyzing lesion patterns...", 60),
        ("Generating LangChain report...", 100)
    ]

    tasks_list[task_id] = {"patient_id": patient_id, "status": "running", "progress": 0, "stage": "Starting..."}

    try:
        for stage, progress in stages:
            tasks_list[task_id]["stage"] = stage
            tasks_list[task_id]["progress"] = progress
            print(f"[Task {task_id}] {stage}", flush=True)

            model = GroundingDINO(img_dim=768, txt_dim=768, num_queries=100, decoder_depth=6, nhead=8)

            if stage == "Loading model weights...":
                model.load_state_dict(torch.load("checkpoints/best_model_epoch10.pth", map_location="cpu"))
                model.to("cuda" if torch.cuda.is_available() else "cpu")
            
            elif stage == "Extracting DINOv2 features...":
                for img_path in images_path_list:
                    if img_path is not None:
                        grounding_inference_single(
                            model=model,
                            image_path=img_path,
                            prompt= f"find oral lesion, patient notes: {notes}",
                            checkpoint_path="checkpoints/best_model_epoch10.pth",
                            device="cuda" if torch.cuda.is_available() else "cpu",
                            box_thresh=0.3,
                            text_thresh=0.25
                        )

        tasks_list[task_id]["progress"] = 100
        tasks_list[task_id]["stage"] = "Completed"
        tasks_list[task_id]["status"] = "completed"
        tasks_list[task_id]["result"] = {
            "risk_level": "moderate",
            "report": "Lesion detected on right buccal mucosa." # Get from grounded LLM
        }

    except Exception as e:
        tasks_list[task_id]["status"] = "failed"
        tasks_list[task_id]["error"] = str(e)

@app.route("/api/predict", methods=["POST"])
def predict():
    form = request.form

    print("------ [Flask] Headers ------")
    print(dict(request.headers), flush=True)
    
    print("------ [Flask] Form Keys ------")
    print(list(request.form.keys()), flush=True)
    
    print("------ [Flask] File Keys ------")
    print(list(request.files.keys()), flush=True)

    print("------ [Flask] Form Data ------", form, flush=True)
    for key, value in request.form.items():
        print(f"{key}: {value}", flush=True)

    patient_id = request.form["patient_id"]
    notes = request.form.get("notes", "")
    images_path_list = []

    for i in range(1, 9):
        if f"pic{i}" in request.files:
            f = request.files[f"pic{i}"]
            save_path = os.path.join("uploads", f.filename)
            images_path_list.append(save_path)
        elif f"pic{i}" in request.form:
            images_path_list.append(request.form[f"pic{i}"])
        else:
            images_path_list.append(None)
    
    print("------ [Flask] images_path_list ------", images_path_list, flush=True)

    task_id = str(uuid.uuid4())

    print("------ [Flask] task_id ------", task_id, flush=True)

    threading.Thread(target=run_inference, args=(task_id, patient_id, images_path_list, notes)).start()
    # run_inference(task_id, images_path_list)
    return jsonify({ "status": "ok", "task_id": task_id, "patient_id": patient_id })

@app.route("/api/status/<task_id>", methods=["GET"])
def status(task_id):
    task = tasks_list.get(task_id, {"status": "not_found"})
    return jsonify(task)

if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True, port=5001)