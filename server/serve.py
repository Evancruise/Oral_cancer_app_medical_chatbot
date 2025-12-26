# serve.py
import os
import torch
import json
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
from google.cloud import storage
from PIL import Image
from io import BytesIO
from google.cloud import aiplatform

# === Import your model components ===
from model.architecture import OralDINOv3 as DINOv3, DINOv3ToLLMAdapter
from utils.config import DINOv3Cfg
from model.inference import dinov3_inference_single
from transformers import AutoTokenizer, AutoModelForCausalLM

app = FastAPI()

# -------------------------
# ===== Request Schema =====
# -------------------------
class Instance(BaseModel):
    image_gcs_uri: str
    patient_id: Optional[str] = ""
    notes: Optional[str] = ""
    view_type: Optional[str] = ""


class PredictRequest(BaseModel):
    instances: List[Instance]

# -------------------------
# ===== Load Model =====
# -------------------------

device = "cuda" if torch.cuda.is_available() else "cpu"
project_id = os.environ.get("GOOGLE_CLOUD_PROJECT_ID", "Oral-cancer-ai")

cfg = DINOv3Cfg()
model = DINOv3(cfg).to(device)

# Vertex AI will pass model to container in /app/model/
MODEL_PATH = os.getenv("CHECKPOINT_PATH", "/app/model/dinov3_best.pth")
print(f"[Init] Loading model from {MODEL_PATH}")

state = torch.load(MODEL_PATH, map_location=device)
model.load_state_dict(state)
model.eval()

# LLM for report generation
llm_tokenizer = AutoTokenizer.from_pretrained("HuggingFaceTB/SmolLM-135M-Instruct")
llm = AutoModelForCausalLM.from_pretrained(
    "HuggingFaceTB/SmolLM-135M-Instruct",
    torch_dtype=torch.float16,
).to(device)
adapter = DINOv3ToLLMAdapter(llm_hidden_dim=llm.config.hidden_size)

# Google Cloud Storage client
gcs_client = storage.Client()

# ----------------------------
# ===== Load Image from GCS ===
# ----------------------------
def read_gcs_image(gcs_uri: str) -> Image.Image:
    bucket_name, path = gcs_uri.replace("gs://", "").split("/", 1)
    bucket = gcs_client.bucket(bucket_name)
    blob = bucket.blob(path)
    content = blob.download_as_bytes()
    return Image.open(BytesIO(content)).convert("RGB")

# ----------------------------
# ===== Inference Logic =====
# ----------------------------
def run_inference(image: Image.Image, notes: str, patient_id: str):

    # Run Grounding + DINOv3 + Adapter + LLM
    result = dinov3_inference_single(
        image,
        model=model,
        llm=llm,
        llm_tokenizer=llm_tokenizer,
        adapter=adapter,
        device=device,
        notes=notes,
        patient_id=patient_id,
    )

    return result

# ----------------------------
# ===== Vertex AI Endpoint ===
# ----------------------------
@app.post("/v1/models/dinov3:predict")
def predict(request: PredictRequest):
    predictions = []

    for inst in request.instances:
        image = read_gcs_image(inst.image_gcs_uri)

        pred = run_inference(
            image=image,
            notes=inst.notes,
            patient_id=inst.patient_id,
        )

        predictions.append(pred)

    return {"predictions": predictions}

# ----------------------------
# ===== Cloud Run Function ===
# ----------------------------

def call_vertex_endpoint(endpoint_id, instance):
    aiplatform.init(project=project_id, location="asia-east1")
    endpoint = aiplatform.Endpoint(endpoint_name=endpoint_id)

    response = endpoint.predict(instances=[instance])
    return response.predictions[0]