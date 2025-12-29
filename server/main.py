import os
import json
import torch
import argparse
from torch.utils.data import DataLoader
# from google.cloud import storage
from pathlib import Path

# ===== project imports =====
from model.architecture import GroundingDINO as DINOv3, OralDINOv3 as DINOv3ToLLMAdapter, OralDINOv3BBox as DINOv3_Bbox
from utils.config import GroundDINOConfig, DINOv3Cfg
from utils.dataset import OralDataset, collate_fn, ReferenceDataset, CaseLevelOralCancerJsonDataset
from utils.func import build_retriever_index, save_retriever_index_gcs, load_retriever_index_gcs
from utils.fhir.fhir_export import results_to_fhir_bundle

from model.train import grounddino_train_val, dinov3_train_val, dinov3_train_val_llm
from model.inference import grounddino_inference, dinov3_inference, dinov3_inference_llm

from transformers import AutoTokenizer, AutoModelForCausalLM, AutoModel

IMAGE_EXTS = [".png", ".jpg", ".jpeg"]

# ================================
# === Utility: GCS file loader ===
# ================================
def load_json_from_path(path):
    """Supports both local path & GCS path."""
    if path.startswith("gs://"):
        client = storage.Client()
        bucket_name, blob_path = path.replace("gs://", "").split("/", 1)
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        content = blob.download_as_text()
        return json.loads(content)
    else:
        with open(path, "r") as f:
            return json.load(f)

def load_dataset_from_dir(root):
    """
    Load dataset from a phase root directory.

    Expected structure:
      root/
        ├── annotations_fhir_json/
        └── annotations_fhir_images/

    Args:
        root:
          - local: ./dataset/train
          - gcs:   gs://oral-dinov3-data/train

    Returns:
        List[dict]
    """
    data_list = []

    # =========================
    # GCS mode
    # =========================
    if root.startswith("gs://"):
        client = storage.Client()
        bucket_name, phase = root.replace("gs://", "").split("/", 1)
        bucket = client.bucket(bucket_name)

        json_prefix = f"{phase}/annotations_fhir_json/"
        image_prefix = f"{phase}/annotations_fhir_images/"

        blobs = bucket.list_blobs(prefix=json_prefix)

        for blob in blobs:
            if not blob.name.endswith(".json"):
                continue

            # ---- load JSON ----
            content = blob.download_as_text()
            item = json.loads(content)

            json_name = Path(blob.name).name
            stem = Path(json_name).stem

            # ---- find image (png / jpg / jpeg) ----
            image_uri = None
            for ext in IMAGE_EXTS:
                candidate = (
                    f"gs://{bucket_name}/"
                    f"{image_prefix}{stem}{ext}"
                )
                # existence check (cheap metadata call)
                if bucket.blob(f"{image_prefix}{stem}{ext}").exists():
                    image_uri = candidate
                    break

            if image_uri is None:
                print(f"⚠️  Image not found for {json_name}")
                continue

            # ---- normalize fields ----
            item["image_name"] = image_uri
            item["image_uri"] = image_uri
            item["phase"] = phase

            data_list.append(item)

    # =========================
    # Local mode
    # =========================
    else:
        root = Path(root)
        json_dir = root / "annotations_fhir_json"
        image_dir = root / "annotations_fhir_images"

        for json_path in sorted(json_dir.glob("*.json")):
            with open(json_path, "r", encoding="utf-8") as f:
                item = json.load(f)

            stem = json_path.stem

            image_path = None
            for ext in IMAGE_EXTS:
                candidate = image_dir / f"{stem}{ext}"
                if candidate.exists():
                    image_path = candidate
                    break

            if image_path is None:
                print(f"⚠️  Image not found for {json_path.name}")
                continue

            item["image_name"] = str(image_path)
            item["image_uri"] = str(image_path)
            item["phase"] = root.name

            data_list.append(item)

    return data_list

# =====================
# === MAIN FUNCTION ===
# =====================
def main(args):
    # Detect device
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Using device: {device}")

    # Path for saving checkpoints (Vertex AI mounts AIP_MODEL_DIR)
    MODEL_DIR = args.checkpoint_path # os.environ.get("AIP_MODEL_DIR", "/app/checkpoints")
    # os.makedirs(MODEL_DIR, exist_ok=True)
    # print(f"Model output dir = {MODEL_DIR}")

    # ----------------------------
    # Load annotation JSON (local or GCS)
    # ----------------------------
    # train_data_list = load_json_from_path(args.train_annotations)
    # val_data_list = load_json_from_path(args.val_annotations)
    #train_data_list = load_dataset_from_dir(args.train_annotations)
    #val_data_list = load_dataset_from_dir(args.val_annotations)

    # ----------------------------
    # Dataset & DataLoader
    # ----------------------------
    # train_dataset = OralDataset(train_data_list, augmentation=True)
    # val_dataset = OralDataset(val_data_list, augmentation=False)

    train_dataset = CaseLevelOralCancerJsonDataset(image_dir=args.train_annotations + "/annotations_fhir_images", json_dir=args.train_annotations + "/annotations_fhir_json")
    val_dataset = CaseLevelOralCancerJsonDataset(image_dir=args.val_annotations + "/annotations_fhir_images", json_dir=args.val_annotations + "/annotations_fhir_json")

    """
    # ----------------------------
    # Model Selection
    # ----------------------------
    if args.model == "GroundingDINO":
        cfg = GroundDINOConfig()
        model = GroundingDINO(cfg).to(device)

        optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)

        if args.phase == "train":
            grounddino_train_val(model, train_loader, val_loader, optimizer,
                                 args.num_epochs, device, MODEL_DIR)

        elif args.phase == "inference":
            test_loader = DataLoader(val_dataset, batch_size=args.batch_size, shuffle=False)
            grounddino_inference(model, test_loader, args.checkpoint_path, device)
    """

    # ----------------------------
    # === DINOv3 Multimodal Model ===
    # ----------------------------

    if args.llm_included == True:

        train_loader = DataLoader(
            train_dataset, batch_size=args.batch_size, shuffle=True,
            num_workers=args.num_workers, collate_fn=collate_fn_llm
        )
        val_loader = DataLoader(
            val_dataset, batch_size=args.batch_size, shuffle=False,
            num_workers=args.num_workers, collate_fn=collate_fn_llm
        )

        if args.model == "DINOv3":
            cfg = DINOv3Cfg()
            model = DINOv3(cfg).to(device)

            # ===== Optimizer =====
            optimizer = torch.optim.AdamW(
                list(model.parameters()) +
                list(adapter.parameters()) +
                list(student_ctx_proj.parameters()) +
                list(student_llm.parameters()),
                lr=args.lr,
                weight_decay=args.weight_decay
            )

            # ---- Sentence-Transformer (Retriever Encoder) ---- 
            enc_tokenizer = AutoTokenizer.from_pretrained("sentence-transformers/all-MiniLM-L6-v2") 
            enc_model = AutoModel.from_pretrained("sentence-transformers/all-MiniLM-L6-v2").to(device)

            # ===== Teacher LLM =====
            teacher_tokenizer = AutoTokenizer.from_pretrained("sshleifer/tiny-gpt2")
            teacher_llm = AutoModelForCausalLM.from_pretrained(
                "sshleifer/tiny-gpt2",
                torch_dtype=torch.float16,
            ).to(device)
            teacher_llm.eval()
            for p in teacher_llm.parameters():
                p.requires_grad = False
            if teacher_tokenizer.pad_token is None:
                teacher_tokenizer.pad_token = teacher_tokenizer.eos_token

            # ===== Student LLM =====
            student_llm = AutoModelForCausalLM.from_pretrained(
                "sshleifer/tiny-gpt2",
                torch_dtype=torch.float16,
            ).to(device)

            # ===== Adapter & Proj =====
            CTX_DIM = 512
            adapter = DINOv3ToLLMAdapter(llm_hidden_dim=CTX_DIM).to(device)
            teacher_ctx_proj = torch.nn.Linear(CTX_DIM, teacher_llm.config.hidden_size).to(device)
            student_ctx_proj = torch.nn.Linear(CTX_DIM, student_llm.config.hidden_size).to(device)

            # ===== Retriever =====
            retriever_gcs_path = args.retriever_index_path
            try:
                teacher_index, teacher_meta = load_retriever_index_gcs(retriever_gcs_path, device)
            except:
                ref_dataset = ReferenceDataset(train_data_list, cfg.text_model_name, cfg.img_size)
                teacher_index, teacher_meta = build_retriever_index(enc_model, enc_tokenizer, ref_dataset, device)
                save_retriever_index_gcs(teacher_index, teacher_meta, retriever_gcs_path)
            
            if args.phase == "train":
                dinov3_train_val_llm(
                    model,
                    train_loader,
                    val_loader,
                    optimizer,
                    args.num_epochs,
                    device,
                    output_dir,
                    teacher_llm,
                    student_llm,
                    teacher_tokenizer,
                    adapter,
                    teacher_ctx_proj,
                    student_ctx_proj,
                    teacher_index,
                    teacher_meta
                )
            
            if args.phase == "inference":
                test_loader = DataLoader(
                    val_dataset,
                    batch_size=1,
                    shuffle=False,
                    collate_fn=collate_fn
                )

                results = dinov3_inference_llm(
                    model=model,
                    student_llm=student_llm,
                    tokenizer=teacher_tokenizer,   # 同 training
                    adapter=adapter,
                    student_ctx_proj=student_ctx_proj,
                    data_loader=test_loader,
                    device=device,
                    retriever_index=teacher_index,   # 可選
                    retriever_meta=teacher_meta
                )

                fhir_bundle = results_to_fhir_bundle(results)

                with open("oral_ai_fhir_bundle.json", "w", encoding="utf-8") as f:
                    json.dump(fhir_bundle, f, indent=2, ensure_ascii=False)
    
    else:

        train_loader = DataLoader(
            train_dataset, batch_size=args.batch_size, shuffle=True,
            num_workers=args.num_workers, collate_fn=collate_fn
        )
        val_loader = DataLoader(
            val_dataset, batch_size=args.batch_size, shuffle=False,
            num_workers=args.num_workers, collate_fn=collate_fn
        )

        if args.model == "DINOv3":
            cfg = DINOv3Cfg()
            model = DINOv3_Bbox(cfg).to(device)

            # ===== Optimizer =====
            optimizer = torch.optim.AdamW(
                list(model.parameters()),
                lr=args.lr,
                weight_decay=args.weight_decay
            )

            if args.phase == "train":
                dinov3_train_val(
                    model,
                    train_loader,
                    val_loader,
                    optimizer,
                    args.num_epochs,
                    device,
                    output_dir="checkpoints"
                )
            
            if args.phase == "inference":
                test_loader = DataLoader(
                    val_dataset,
                    batch_size=1,
                    shuffle=False,
                    collate_fn=collate_fn
                )

                dinov3_inference(
                    model,
                    test_loader,
                    device
                )

# ==================
# Argument Parser
# ==================
'''
Usage
    local: python main.py --train_annotations utils/dataset/train --val_annotations utils/dataset/val --test_annotations utils/dataset/test --checkpoint_path checkpoints/

'''
if __name__ == "__main__":
    parser = argparse.ArgumentParser()

    # === Generic settings ===
    parser.add_argument("--phase", type=str, default="train", help="train or inference")
    parser.add_argument("--model", type=str, default="DINOv3", help="Model type")

    # === Dataset paths (support GCS) ===
    parser.add_argument("--train_annotations", type=str,
                        default="gs://oral-dinov3-data/train")
    parser.add_argument("--val_annotations", type=str,
                        default="gs://oral-dinov3-data/val")
    parser.add_argument("--test_annotations", type=str,
                        default="gs://oral-dinov3-data/test")
    
    # === Retriever index path ===
    parser.add_argument("--retriever_index_path", type=str,
                        default="gs://oral-dinov3-data/retriever")

    # === Training settings ===
    parser.add_argument("--num_epochs", type=int, default=5)
    parser.add_argument("--batch_size", type=int, default=2)
    parser.add_argument("--num_workers", type=int, default=2)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--weight_decay", type=float, default=1e-4)

    parser.add_argument("--checkpoint_path", type=str, default="gs://oral-dinov3-data/checkpoints")
    parser.add_argument("--excel_path", type=str, default="gs://oral-dinov3-data/oralCa_FHIR.xlsx")
    parser.add_argument("--llm_included", type=bool, default=False)

    args = parser.parse_args()
    main(args)
