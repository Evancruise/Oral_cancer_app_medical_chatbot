import json, os, random
from typing import List, Dict
from PIL import Image
from utils.func import gcs_download_to_cache, polygons_to_gt_masks
import torch
from torch.utils.data import Dataset
import torchvision.transforms as T
from transformers import AutoTokenizer
import pandas as pd

class CaseLevelOralCancerDataset(Dataset):
    """
    Case-level dataset:
    - One image per case (_00)
    - Multiple lesions per image (_01 ~ _0x)
    - raw_text / LLM text only from _00
    """

    def __init__(
        self,
        excel_path,
        image_root,
        transform=None,
        image_ext=".png"
    ):
        self.df = pd.read_excel(excel_path)
        self.image_root = image_root

        if transform == None:
            self.transform = T.Compose([
                T.Resize((224, 224)),   # 視模型需求
                T.ToTensor(),            # 🔑 關鍵
                T.Normalize(
                    mean=[0.485, 0.456, 0.406],
                    std=[0.229, 0.224, 0.225]
                )
            ])
        else:
            self.transform = transform
        
        self.image_ext = image_ext

        # --- Group rows by case_id ---
        self.cases = self._group_by_case(self.df)
        self.case_ids = sorted(self.cases.keys())

        print(f"[Dataset] Loaded {len(self.case_ids)} cases")

    # ------------------------------------------------
    # Grouping logic
    # ------------------------------------------------
    def _group_by_case(self, df):
        cases = {}

        for _, row in df.iterrows():
            record_id = str(row["record_id"])   # e.g. 000004_02
            print("record_id:", record_id, flush=True)

            if "_" not in record_id:
                break

            case_id, suffix = record_id.split("_")

            if case_id not in cases:
                cases[case_id] = {
                    "main": None,       # _00
                    "lesions": []       # _01 ~ _0x
                }

            if suffix == "00":
                cases[case_id]["main"] = row
            else:
                cases[case_id]["lesions"].append(row)

        return cases

    # ------------------------------------------------
    # Text builders
    # ------------------------------------------------
    def _build_raw_text(self, row):
        parts = []

        def add(col, prefix):
            if col in row and pd.notna(row[col]):
                parts.append(f"{prefix}: {str(row[col]).strip()}.")

        add("chief_complaint", "Chief complaint")
        add("patient_statement", "Patient statement")
        add("doctor_note", "Doctor note")
        add("observation_text", "Observation")
        add("diagnosis_text", "Diagnosis")
        add("pathology_report", "Pathology")

        return " ".join(parts)

    def _build_llm_prompt(self, row):
        patient = str(row.get("patient_statement", ""))
        doctor = str(row.get("doctor_note", ""))

        return (
            "[Patient Statement] " + patient +
            " [Doctor's Note] " + doctor +
            "\n[Generate Pathology Report]"
        )

    # ------------------------------------------------
    # PyTorch Dataset API
    # ------------------------------------------------
    def __len__(self):
        return len(self.case_ids)

    def __getitem__(self, idx):
        case_id = self.case_ids[idx]
        case = self.cases[case_id]

        # ========== Main record (_00) ==========
        main = case["main"]
        if main is None:
            raise ValueError(f"Case {case_id} has no _00 record")

        # ---- Image ----
        img_name = f"{case_id}_00{self.image_ext}"
        img_path = os.path.join(self.image_root, img_name)
        image = Image.open(img_path).convert("RGB")
        width, height = image.size

        if self.transform:
            image = self.transform(image)

        # ---- Text ----
        raw_text = self._build_raw_text(main)
        llm_prompt = self._build_llm_prompt(main)
        llm_target = str(main.get("pathology_report", ""))

        # ========== Lesions (_01 ~ _0x) ==========
        boxes = []
        labels = []

        for lesion in case["lesions"]:
            if pd.notna(lesion.get("bbox")):
                # bbox assumed stored like "[x1,y1,x2,y2]"
                box = torch.tensor(eval(lesion["bbox"]), dtype=torch.float32)
                boxes.append(box)

                label = int(lesion.get("label", 0))
                labels.append(label)

        # ---- Empty GT safe-guard ----
        if len(boxes) == 0:
            boxes = torch.zeros((0, 4), dtype=torch.float32)
            labels = torch.zeros((0,), dtype=torch.long)
        else:
            boxes = torch.stack(boxes, dim=0)
            labels = torch.tensor(labels, dtype=torch.long)

        return {
            "case_id": case_id,
            "image": image,
            "width": width,
            "height": height,
            "raw_text": raw_text,
            "llm_prompt": llm_prompt,
            "llm_target": llm_target,
            "boxes": boxes,
            "labels": labels
        }
    
class CaseLevelOralCancerJsonDataset(Dataset):
    """
    One JSON = one case
    One image per case
    Multiple lesions per image
    """

    def __init__(
        self,
        image_dir,
        json_dir,
        transform=None,
        type="bbox"
    ):
        self.image_dir = image_dir
        self.json_dir = json_dir
        self.type = type
        
        if transform == None:
            self.transform = T.Compose([
                T.Resize((384, 384)),   # 視模型需求
                T.ToTensor(),            # 🔑 關鍵
                T.Normalize(
                    mean=[0.485, 0.456, 0.406],
                    std=[0.229, 0.224, 0.225]
                )
            ])
        else:
            self.transform = transform

        self.json_files = sorted([
            f for f in os.listdir(json_dir)
            if f.endswith(".json")
        ])

        print(f"[Dataset] Loaded {len(self.json_files)} cases")

    def __len__(self):
        return len(self.json_files)

    def _build_raw_text(self, ann):
        parts = []

        if "patient_statement" in ann:
            parts.append("Patient statement: " + " ".join(ann["patient_statement"]))

        if "doctor_note" in ann:
            parts.append("Doctor note: " + " ".join(ann["doctor_note"]))

        if "pathology_report" in ann:
            parts.append("Pathology: " + " ".join(ann["pathology_report"]))

        return " ".join(parts)

    def _build_llm_prompt(self, ann):
        return (
            "[Patient Statement] " + " ".join(ann.get("patient_statement", [])) +
            " [Doctor's Note] " + " ".join(ann.get("doctor_note", [])) +
            "\n[Generate Pathology Report]"
        )

    def __getitem__(self, idx):
        json_name = self.json_files[idx]
        json_path = os.path.join(self.json_dir, json_name)

        with open(json_path, "r", encoding="utf-8") as f:
            ann = json.load(f)

        # ---- Image ----
        image_file = os.path.basename(ann["image_name"])
        image_path = os.path.join(self.image_dir, image_file)

        image = Image.open(image_path).convert("RGB")
        width, height = image.size

        if self.transform:
            image = self.transform(image)

        # ---- Text ----
        raw_text = self._build_raw_text(ann)
        llm_prompt = self._build_llm_prompt(ann)
        llm_target = " ".join(ann.get("pathology_report", []))

        # ---- Boxes / Labels ----
        if self.type == "seg":
            polygons = ann.get("masks", [])
            gt_masks = polygons_to_gt_masks(polygons, height, width)
            # polygons to tensor masks
            boxes = None
        elif self.type == "bbox":
            gt_masks = None
            boxes = torch.tensor(ann.get("boxes", []), dtype=torch.float32)
        else:
            polygons = ann.get("masks", [])
            gt_masks = polygons_to_gt_masks(polygons, height, width)
            boxes = torch.tensor(ann.get("boxes", []), dtype=torch.float32)

        labels = torch.tensor(ann.get("labels", []), dtype=torch.long)

        # ---- Empty GT safe-guard ----
        if boxes.numel() == 0:
            boxes = torch.zeros((0, 4), dtype=torch.float32)
            labels = torch.zeros((0,), dtype=torch.long)

        return {
            "image": image,
            "width": width,
            "height": height,
            "image_name": image_file,
            "raw_text": raw_text,
            "llm_prompt": llm_prompt,
            "llm_target": llm_target,
            "boxes": boxes,
            "masks": gt_masks,
            "labels": labels
        }
    
class ReferenceDataset(Dataset):
    """
    Dataset for building retrieval index (RAG knowledge base).
    主要提供 image + prompt 給 teacher encoder 生成 embedding。
    """
    def __init__(self, data_list, tokenizer_name="distilbert-base-uncased", image_size=384):
        self.data = data_list
        self.tokenizer = AutoTokenizer.from_pretrained(tokenizer_name)
        self.transform = T.Compose([
            T.Resize((image_size, image_size)),
            T.ToTensor(),
            T.Normalize([0.485, 0.456, 0.406],
                        [0.229, 0.224, 0.225])
        ])

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        item = self.data[idx]
        img = Image.open(item["image_name"]).convert("RGB")
        img = self.transform(img)

        combined_text = (
            f"Given the patient's self-report and doctor's observation, write a concise oral pathology report.\n\n"
            f"Patient statement: {item['patient_statement']}\n"
            f"Doctor note: {item['doctor_note']}\n\n"
            f"Pathology Report:"
        )
        
        result_text = f"[Generated Report] {item['pathology_report']}"

        enc = self.tokenizer(
            combined_text,
            return_tensors="pt",
            padding="max_length",
            truncation=True,
            max_length=512
        )

        return {
            "image": img,
            "input_ids": enc["input_ids"][0],
            "attn_mask": enc["attention_mask"][0],
            "prompt": combined_text,
            "output_text": result_text
        }
    
class OralDataset(Dataset):
    def __init__(self, data_list, augmentation=None, tokenizer_name="distilbert-base-uncased", image_size=384, excel_path="./utils/dataset/all/oralCa_FHIR.xlsx"):
        self.data = data_list
        self.tokenizer = AutoTokenizer.from_pretrained(tokenizer_name)
        self.augmentation = augmentation
        self.excel_path = excel_path
        self.df = pd.read_excel(self.excel_path)
        
        self.tfm = T.Compose([
            T.Resize((image_size, image_size)),
            T.ToTensor(),
            T.Normalize([0.485,0.456,0.406], [0.229,0.224,0.225]),
        ])
        
        self.augment = T.Compose([
            T.RandomResizedCrop(image_size, scale=(0.8, 1.0), ratio=(0.75, 1.33)),
            T.RandomHorizontalFlip(),
            T.ColorJitter(0.4, 0.4, 0.4, 0.1),
            T.ToTensor(),
        ])
    
    def __len__(self):
        return len(self.data)
    
    def __build_raw_text__(self, row):
        parts = []

        def add(k, prefix):
            if k in row and pd.notna(row[k]):
                parts.append(f"{prefix}: {str(row[k]).strip()}.")
        
        add("chief_complaint", "Chief complaint")
        add("patient_statement", "Patient statement")
        add("doctor_note", "Doctor note")
        add("observation_text", "Observation")
        add("diagnosis_text", "Diagnosis")
        add("pathology_report", "Pathology")

        return " ".join(parts)

    def _build_llm_prompt(self, row):
        return (
            "[Patient Statement] " + str(row.get("patient_statement", "")) + 
            " [Doctor's Note] " + str(row.get("doctor_note", "")) + 
            "\n[Generate Pathology Report]"
        )

    def __getitem__(self, idx):
        item = self.data[idx]

        img_path = item["image_name"]
        if isinstance(img_path, str) and img_path.startswith("gs://"):
            img_path = gcs_download_to_cache(img_path)

        img = Image.open(img_path).convert("RGB")
        x = self.tfm(img)

        if self.augmentation:
            x = self.augment(img)
        
        report = item["pathology_report"]
        if isinstance(report, list):  
            report = " ".join(report)  # 或 report[0] 根據實際資料格式
        elif report is None:
            report = "[EMPTY_REPORT]"

        enc = self.tokenizer(
            report,
            return_tensors="pt",
            padding="max_length",
            truncation=True,
            max_length=32
        )
        
        # Negative sample
        neg_mask = (torch.rand(enc["input_ids"].shape) < 0.2)
        gt_boxes = torch.tensor(item["boxes"], dtype=torch.float32)
        gt_labels = torch.tensor(item["labels"], dtype=torch.long)

        input_ids = enc["input_ids"][0]
        attn_mask = enc["attention_mask"][0]
        neg_mask = (torch.rand_like(input_ids, dtype=torch.float) < 0.2)

        return {
            "image": x,
            "image_name": os.path.basename(img_path),
            "input_ids": input_ids,
            "attn_mask": attn_mask,
            "neg_mask": neg_mask,
            "boxes": gt_boxes,
            "labels": gt_labels,
            "doctor_note": item["doctor_note"],
            "patient_statement": item["patient_statement"],
            "output_text": report
        }

class GroundJsonlDataset(Dataset):
    def __init__(self, jsonl_path: str, image_root: str, image_size:int=800, text_prompt:str=None):
        self.recs = []

        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                self.recs.append(json.loads(line))
        
        self.image_root = image_root
        self.image_size = image_size
        self.text_prompt = text_prompt
        self.tf = T.Compose([
            T.ToTensor(),
            T.Resize((image_size, image_size)),
            T.Normalize(mean=[0.485,0.456,0.406], std=[0.229,0.225,0.225]),
        ])

    def __len__(self):
        return len(self.recs)
    
    def __getitem__(self, i):
        rec = self.recs[i]
        img_path = os.path.join(self.image_root, rec["image"])
        img = Image.open(img_path).convert("RGB")

        W, H = img.size
        x = self.tf(img)

        # 將 xyxy (絕對) -> xyxy (相對 0~1)
        annos = rec.get("annotations", [])
        boxes = []
        phrases = []

        for a in annos:
            x1, y1, x2, y2 = a["bbox"]
            boxes.append([x1/W, y1/H, x2/W, y2/H])
            phrases.append(a["phrase"])
        
        # 文字提示: 若未指定 text_prompt，就用本圖的 phrases 合併
        if self.text_prompt:
            caption = self.text_prompt
        else:
            uniq = sorted(set([p.lower() for p in phrases]))
            caption = ", ".join(uniq) if uniq else "oral lesion"
        
        target = {
            "bboxes_xyxy": torch.tensor(boxes, dtype=torch.float32),
            "phrases": phrases,
            "caption": caption,
            "orig_size": torch.tensor([H, W], dtype=torch.int64),
            "path": rec["image"]
        }

        return x, target

# ==== Augmentation ====
class AugmentationDataset(Dataset):
    def __init__(self, base_dataset: Dataset, augmentations: List[T.Compose]):
        self.base_dataset = base_dataset
        self.augmentations = augmentations

    def __len__(self):
        return len(self.base_dataset)

    def __getitem__(self, idx):
        x, target = self.base_dataset[idx]
        aug = random.choice(self.augmentations)
        x_aug = aug(x)
        return x_aug, target