import math
import cv2
import torch
import json
import os
import torch.nn as nn
import torchvision.transforms as T
import torch.nn.functional as F
import numpy as np
import pandas as pd
import tempfile
import zipfile
import hashlib
from PIL import Image
from torchvision.ops import nms
import matplotlib.pyplot as plt
from scipy.optimize import linear_sum_assignment
from typing import List, Tuple, Dict, Optional, Any
from types import SimpleNamespace
from sklearn.metrics import roc_curve, auc, precision_recall_curve, average_precision_score

from google.cloud import storage

from utils.config import DINOv3Cfg, MouthDetConfig, UnifiedDetection
from model.architecture import InferenceBundle

def collate_fn(batch):
    images = torch.stack([b["image"] for b in batch])
    image_names = [b["image_name"] for b in batch]
    boxes = [b["boxes"] for b in batch]
    labels = [b["labels"] for b in batch]
    widths = [b["width"] for b in batch]
    heights = [b["height"] for b in batch]
    # neg_mask = torch.stack([b["neg_mask"] for b in batch])
    return {"image": images, "boxes": boxes, "labels": labels, "image_name": image_names, "width": widths, "height": heights}

def collate_fn_llm(batch):
    images = torch.stack([b["image"] for b in batch])
    input_ids = torch.stack([b["input_ids"] for b in batch])
    attn_mask = torch.stack([b["attn_mask"] for b in batch])
    neg_mask = torch.stack([b["neg_mask"] for b in batch])
    boxes = [b["boxes"] for b in batch]
    labels = [b["labels"] for b in batch]
    report = [b["output_text"] for b in batch]
    patient_statement = [b["patient_statement"] for b in batch]
    doctor_note = [b["doctor_note"] for b in batch]
    return {"image": images, "input_ids": input_ids, "attn_mask": attn_mask,
            "neg_mask": neg_mask, "boxes": boxes, "labels": labels, "output_text": report, "doctor_note": doctor_note, "patient_statement": patient_statement}

def collect_det_results_one_image(
    pred_boxes, pred_scores, pred_labels,
    gt_boxes, gt_labels,
    matcher,
    iou_threshold=0.5
):
    """
    pred_boxes: [N,4] xyxy (original image coords)
    pred_scores: [N]
    pred_labels: [N]
    gt_boxes: [M,4] xyxy
    gt_labels: [M]

    return: list of dict
      [{
        "score": float,
        "is_tp": bool,
        "class_id": int
      }, ...]
    """
    results = []

    # no GT: all predictions are FP
    if gt_boxes.numel() == 0:
        for i in range(pred_boxes.size(0)):
            results.append({
                "score": float(pred_scores[i].item()),
                "is_tp": False,
                "class_id": int(pred_labels[i].item())
            })
        return results

    # no predictions: all GT are FN
    if pred_boxes.numel() == 0:
        return results

    # Hungarian matching
    idx_pred, idx_gt = matcher(
        pred_labels,
        pred_boxes,
        gt_labels,
        gt_boxes
    )

    matched_pred = set(idx_pred.tolist())
    matched_gt = set(idx_gt.tolist())

    # matched pairs
    pb = pred_boxes[idx_pred]
    gb = gt_boxes[idx_gt]
    ious = box_iou_xyxy(pb, gb).diag()

    for k in range(len(idx_pred)):
        i = idx_pred[k]
        is_tp = ious[k] >= iou_threshold
        results.append({
            "score": float(pred_scores[i].item()),
            "is_tp": bool(is_tp),
            "class_id": int(pred_labels[i].item())
        })
    
    # unmatched predictions -> FP
    for i in range(pred_boxes.size(0)):
        if i not in matched_pred:
            results.append({
                "score": float(pred_scores[i].item()),
                "is_tp": False,
                "class_id": int(pred_labels[i].item())
            })
    
    return results

def collect_det_results_one_image_multi_iou(
    pred_boxes, pred_scores, pred_labels,
    gt_boxes, gt_labels,
    matcher, 
    iou_thresholds      
):
    """
    Returns:
        dict[iou] -> list of {"score": float, "is_tp": bool, "class_id": int}
    """
    records = {t: [] for t in iou_thresholds}

    # no GT -> all FP for all thresholds
    if gt_boxes.numel() == 0:
        for t in iou_thresholds:
            for i in range(pred_boxes.size(0)):
                records[t].append({
                    "score": float(pred_scores[i].item()),
                    "is_tp": False,
                    "class_id": int(pred_labels[i].item())
                })
        return records
    
    # no predictions
    if pred_boxes.numel() == 0:
        return records
    
    idx_p, idx_g = matcher(
        pred_labels,
        pred_boxes,
        gt_labels,
        gt_boxes
    )

    matched_pred = set(idx_p.tolist())

    if idx_p.numel() > 0:
        pb = pred_boxes[idx_p]
        gb = gt_boxes[idx_g]
        ious = box_iou_xyxy(pb, gb).diag()

        for k in range(len(idx_p)):
            for t in iou_thresholds:
                records[t].append({
                    "score": float(pred_scores[idx_p[k]].item()),
                    "is_tp": bool(ious[k] > t),
                    "class_id": int(pred_labels[idx_p[k]].item())
                })

    # unmatched predictions → FP
    for i in range(pred_boxes.size(0)):
        if i not in matched_pred:
            for t in iou_thresholds:
                records[t].append({
                    "score": float(pred_scores[i].item()),
                    "is_tp": False,
                    "class_id": int(pred_labels[i].item())
                })

    return records

def compute_ap(det_records):
    """
    det_records: list of {"score", "is_tp"}
    """
    if len(det_records) == 0:
        return 0.0

    det_records = sorted(det_records, key=lambda x: x["score"], reverse=True)

    tp = np.array([1 if r["is_tp"] else 0 for r in det_records])
    fp = 1 - tp

    tp_cum = np.cumsum(tp)
    fp_cum = np.cumsum(fp)

    recall = tp_cum / max(tp.sum(), 1)
    precision = tp_cum / np.maximum(tp_cum + fp_cum, 1)

    ap = 0.0
    for t in np.linspace(0, 1, 11):
        p = precision[recall >= t].max() if np.any(recall >= t) else 0
        ap += p / 11.0
    return float(ap)

def compute_map_multi_iou(
    all_det_records_multi_iou,
    num_classes,
    iou_thresholds
):
    """
    all_det_records_multi_iou:
      list (per image) of dict:
        { iou_thr -> [det_records] }
    """
    map_per_iou = {}
    ap_per_iou_per_class = {}

    for t in iou_thresholds:
        per_class = {c: [] for c in range(num_classes)}
        for img_rec in all_det_records_multi_iou:
            for r in img_rec[t]:
                per_class[r["class_id"]].append(r)

        ap_per_class = {
            c: compute_ap(per_class[c]) for c in range(num_classes)
        }
        ap_per_iou_per_class[t] = ap_per_class
        map_per_iou[t] = float(np.mean(list(ap_per_class.values())))

    map_5095 = float(np.mean(list(map_per_iou.values())))

    return {
        "map_5095": map_5095,
        "map_per_iou": map_per_iou,
        "ap_per_iou_per_class": ap_per_iou_per_class
    }

def compute_ap_from_detections(det_records):
    """
    det_records: list of dicts
    { "score": float, "is_tp": bool }
    return: AP
    """
    if len(det_records) == 0:
        return 0.0
    
    # sort by score desc
    det_records = sorted(det_records, key=lambda x: x["score"], reverse=True)

    tp = np.array([1 if d["is_tp"] else 0 for d in det_records])
    fp = 1 - tp

    tp_cum = np.cumsum(tp)
    fp_cum = np.cumsum(fp)

    recall = tp_cum / max(tp.sum(), 1)
    precision = tp_cum / np.maximum(tp_cum + fp_cum, 1)

    # VOC-style AP
    ap = 0.0
    for t in np.linsspace(0, 1, 11):
        p = precision[recall >= t].max() if np.any(recall >= t) else 0
        ap += p / 11.0
    
    return float(ap)

def compute_map50(all_det_results, num_classes):
    """
    all_det_results: list of per-image results (output of collect_det_results_one_image)
    """
    per_class_records = {c: [] for c in range(num_classes)}

    for img_res in all_det_results:
        for r in img_res:
            per_class_records[r["class_id"]].append(r)
    
    ap_per_class = {}
    for c in range(num_classes):
        ap_per_class[c] = compute_ap_from_detections(per_class_records[c])

    map50 = np.mean(list(ap_per_class.values()))
    return map50, ap_per_class

def compute_per_image_highest_severity_acc(
    pred_boxes, pred_labels,
    gt_boxes, gt_labels,
    matcher,
    iou_threshold=0.5
):
    """
    return: 0 or 1
    """
    if gt_boxes.numel():
        return 1 # no lesion case treated as correct

    highest_gt = int(gt_labels.max().item())

    # select GT of highest severity
    gt_mask = gt_labels == highest_gt
    gt_boxes_h = gt_boxes[gt_mask]
    gt_labels_h = gt_labels[gt_mask]

    # select preds of same class
    pred_mask = pred_labels == highest_gt
    if not pred_mask.any():
        return 0
    
    pb = pred_boxes[pred_mask]
    pl = pred_labels[pred_mask]

    idx_p, idx_g = matcher(
        pl, pb, gt_labels_h, gt_boxes_h
    )

    if idx_p.numel() == 0:
        return 0
    
    ious = box_iou_xyxy(
        pb[idx_p],
        gt_boxes_h[idx_g]
    ).diag()

    return int((ious >= iou_threshold).any().item())

def collect_calibration_records(
    det: UnifiedDetection,
    gt_boxes, gt_labels,
    matcher      
):
    """
    det: UnifiedDetection (ROI coords or original coords)
    """
    records = []

    if det.boxes.numel() == 0:
        return records
    
    if gt_boxes.numel() == 0:
        for i in range(det.boxes.size(0)):
            records.append({
                "model_id": det.model_id,
                "class_id": int(det.labels[i].item()),
                "raw_score": float(det.scores[i].item()),
                "iou": 0.0
            })
        return records

    idx_p, idx_g = matcher(
        det.labels,
        det.boxes,
        gt_labels,
        gt_boxes
    )

    matched_pred = set(idx_p.tokist())

    pb = det.boxes[idx_p]
    gb = gt_boxes[idx_g]
    ious = box_iou_xyxy(pb, gb).diag()

    for k in range(len(idx_p)):
        i = idx_p[k]
        records.append({
            "model_id": det.model_id,
            "class_id": int(det.labels[i].item()),
            "raw_score": float(det.scores[i].item()),
            "iou": float(ious[k].item())
        })
    
    # unmatched preds -> iou = 0
    for i in range(det.boxes.size(0)):
        if i not in matched_pred:
            records.append({
                "model_id": det.model_id,
                "class_id": int(det.labels[i].item()),
                "raw_score": float(det.scores[i].item()),
                "iou": 0.0
            })
    
    return records

def autopad(k: int, p: Optional[int] = None) -> int:
    """
    Same padding for odd kernel sizes.
    """
    if p is None:
        return k // 2
    return p

def box_iou_xyxy(boxes1: torch.Tensor, boxes2: torch.Tensor, eps: float = 1e-7) -> torch.Tensor:
    """
    boxes1: [N,4], boxes2: [M,4] in xyxy
    return: [N,M] IoU
    """
    x11, y11, x12, y12 = boxes1.unbind(-1)
    x21, y21, x22, y22 = boxes2.unbind(-1)

    inter_x1 = torch.max(x11[:, None], x21[None, :])
    inter_y1 = torch.max(y11[:, None], y21[None, :])
    inter_x2 = torch.min(x12[:, None], x22[None, :])
    inter_y2 = torch.min(y12[:, None], y22[None, :])

    inter_w = (inter_x2 - inter_x1).clamp(min=0)
    inter_h = (inter_y2 - inter_y1).clamp(min=0)
    inter = inter_w * inter_h

    area1 = (x12 - x11).clamp(min=0) * (y12 - y11).clamp(min=0)
    area2 = (x22 - x21).clamp(min=0) * (y22 - y21).clamp(min=0)

    union = area1[:, None] + area2[None, :] - inter + eps
    return inter / union

def nms_xyxy(boxes: torch.Tensor, scores: torch.Tensor, iou_thres: float) -> torch.Tensor:
    """
    Pure torch NMS.
    boxes: [N,4], scores: [N]
    return: indices kept (descending score)
    """
    if boxes.numel() == 0:
        return torch.zeros((0,), dtype=torch.long, device=boxes.device)

    order = scores.argsort(descending=True)
    keep = []

    while order.numel() > 0:
        i = order[0].item()
        keep.append(i)
        if order.numel() == 1:
            break

        rest = order[1:]
        ious = box_iou_xyxy(boxes[i].unsqueeze(0), boxes[rest]).squeeze(0)
        order = rest[ious <= iou_thres]

    return torch.tensor(keep, dtype=torch.long, device=boxes.device)

def soft_nms_xyxy(
    boxes: torch.Tensor,
    scores: torch.Tensor,
    iou_thres: float = 0.5,
    sigma: float = 0.5,
    score_thres: float = 0.001
) -> torch.Tensor:
    """
    Gaussian Soft-NMS (scores decay). Returns kept indices.
    """
    if boxes.numel() == 0:
        return torch.zeros((0,), dtype=torch.long, device=boxes.device)

    boxes = boxes.clone()
    scores = scores.clone()

    N = boxes.size(0)
    idxs = torch.arange(N, device=boxes.device)

    keep = []
    for _ in range(N):
        # pick max score
        max_pos = scores.argmax()
        if scores[max_pos] < score_thres:
            break

        keep.append(idxs[max_pos].item())

        cur_box = boxes[max_pos:max_pos+1]
        cur_score = scores[max_pos]

        # swap selected to end-like (remove it)
        boxes[max_pos] = boxes[-1]
        scores[max_pos] = scores[-1]
        idxs[max_pos] = idxs[-1]

        boxes = boxes[:-1]
        scores = scores[:-1]
        idxs = idxs[:-1]

        if boxes.numel() == 0:
            break

        ious = box_iou_xyxy(cur_box, boxes).squeeze(0)
        # Gaussian decay
        decay = torch.exp(-(ious * ious) / sigma)
        scores = scores * decay
        # optional hard threshold too
        scores = torch.where(ious > iou_thres, scores, scores)

    return torch.tensor(keep, dtype=torch.long, device=boxes.device)

def select_best_mouth_bbox(boxes, image_shape):
    """
    Heuristic:
    - highest confidence
    - reasonable size
    """
    if len(boxes) == 0:
        return None

    h, w = image_shape[:2]
    img_area = h * w

    def score_fn(b):
        x1, y1, x2, y2 = b["bbox"]
        area = (x2 - x1) * (y2 - y1)
        area_ratio = area / img_area
        return b["score"] * min(area_ratio / 0.25, 1.0)

    boxes = sorted(boxes, key=score_fn, reverse=True)
    return boxes[0]["bbox"]

def crop_mouth_roi(
    image: np.ndarray,
    bbox,
    pad_ratio: float = 0.25
):
    """
    bbox: [x1, y1, x2, y2]
    """
    h, w = image.shape[:2]
    x1, y1, x2, y2 = bbox

    bw = x2 - x1
    bh = y2 - y1

    pad_w = int(bw * pad_ratio)
    pad_h = int(bh * pad_ratio)

    cx1 = max(0, x1 - pad_w)
    cy1 = max(0, y1 - pad_h)
    cx2 = min(w, x2 + pad_w)
    cy2 = min(h, y2 + pad_h)

    roi = image[cy1:cy2, cx1:cx2]

    meta = {
        "roi_bbox": [cx1, cy1, cx2, cy2],
        "orig_bbox": bbox
    }

    return roi, meta

def letterbox_resize(
    image,
    target_size=512,
    color=(114, 114, 114)
):
    h, w = image.shape[:2]
    scale = target_size / max(h, w)

    nh, nw = int(h * scale), int(w * scale)
    resized = cv2.resize(image, (nw, nh))

    canvas = np.full(
        (target_size, target_size, 3),
        color,
        dtype=np.uint8
    )

    top = (target_size - nh) // 2
    left = (target_size - nw) // 2

    canvas[top:top+nh, left:left+nw] = resized

    transform = {
        "scale": scale,
        "pad": [left, top]
    }

    return canvas, transform

def fallback_center_crop(image, ratio=0.6):
    h, w = image.shape[:2]
    cw, ch = int(w * ratio), int(h * ratio)

    x1 = (w - cw) // 2
    y1 = (h - ch) // 2
    x2 = x1 + cw
    y2 = y1 + ch

    roi = image[y1:y2, x1:x2]

    return roi, {
        "roi_bbox": [x1, y1, x2, y2],
        "fallback": True
    }

def infer_mouth_bbox(
    model,
    image_bgr: np.ndarray,
    conf_thres: float = 0.4,
    iou_thres: float = 0.5
):
    """
    Return mouth bounding boxes in xyxy (pixel coords)
    """
    # YOLOv11 假設吃 RGB
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)

    results = model(
        image_rgb,
        conf=conf_thres,
        iou=iou_thres,
        verbose=False
    )

    boxes = []
    for r in results:
        if r.boxes is None:
            continue
        for box in r.boxes:
            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
            score = box.conf[0].item()
            boxes.append({
                "bbox": [int(x1), int(y1), int(x2), int(y2)],
                "score": score
            })

    return boxes

def mouth_roi_pipeline(image_bgr, yolo_model):
    boxes = infer_mouth_bbox(yolo_model, image_bgr)

    bbox = select_best_mouth_bbox(boxes, image_bgr.shape)

    if bbox is None:
        roi, meta = fallback_center_crop(image_bgr)
        meta["status"] = "fallback"
    else:
        roi, meta = crop_mouth_roi(image_bgr, bbox)
        meta["status"] = "detected"

    roi_aligned, transform = letterbox_resize(roi)

    output = {
        "roi_image": roi_aligned,
        "roi_meta": meta,
        "transform": transform
    }

    return output

def save_bundle_checkpoint(epoch, lesion_dino, lesion_yolo, calibrator_table, output_dir="checkpoints"):
    os.makedirs(output_dir, exist_ok=True)
    dino_pth = os.path.join(output_dir, f"dino_epoch{epoch}.pth")
    yolo_pth = os.path.join(output_dir, f"yolo_epoch{epoch}.pth")
    cal_json = os.path.join(output_dir, f"cal_epoch{epoch}.json")
    bundle_zip = os.path.join(output_dir, f"lesion_bundle_best_epoch{epoch}.zip")

    torch.save(lesion_dino.state_dict(), dino_pth)
    torch.save(lesion_yolo.state_dict(), yolo_pth)
    with open(cal_json, "w", encoding="utf-8") as f:
        json.dump({str(k): v for k, v in calibrator_table.items()}, f, ensure_ascii=False, indent=2)

    with zipfile.ZipFile(bundle_zip, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.write(dino_pth, arcname=os.path.basename(dino_pth))
        z.write(yolo_pth, arcname=os.path.basename(yolo_pth))
        z.write(cal_json, arcname=os.path.basename(cal_json))

    return bundle_zip

def load_local_bundle(
    bundle_path: str,
    device: str = None
):
    """
    Load a local multi-stage lesion bundle (non-MLflow).

    Args:
        bundle_path:
            - directory path containing bundle files, or
            - .zip file path
        device:
            - "cuda" / "cpu" / None (use config or auto)

    Returns:
        bundle: InferenceBundle-like object with .predict()
    """

    # -------------------------------------------------
    # 1. Prepare bundle directory
    # -------------------------------------------------
    if os.path.isfile(bundle_path) and bundle_path.endswith(".zip"):
        tmpdir = tempfile.mkdtemp(prefix="lesion_bundle_")
        with zipfile.ZipFile(bundle_path, "r") as zf:
            zf.extractall(tmpdir)
        bundle_dir = tmpdir
    elif os.path.isdir(bundle_path):
        bundle_dir = bundle_path
    else:
        raise ValueError(f"Invalid bundle_path: {bundle_path}")

    # -------------------------------------------------
    # 2. Validate required files
    # -------------------------------------------------
    def _req(p):
        fp = os.path.join(bundle_dir, p)
        if not os.path.exists(fp):
            raise FileNotFoundError(f"Missing bundle file: {fp}")
        return fp

    bundle_config = _req("bundle_config.json")
    dino_weights = _req("dino_weights.pth")
    yolo_weights = _req("yolo_weights.pth")
    calibrator_table = os.path.join(bundle_dir, "calibrator_table.json")
    if not os.path.exists(calibrator_table):
        calibrator_table = None

    # -------------------------------------------------
    # 3. Build fake MLflow context
    # -------------------------------------------------
    artifacts = {
        "bundle_config": bundle_config,
        "dino_weights": dino_weights,
        "yolo_weights": yolo_weights,
    }
    if calibrator_table:
        artifacts["calibrator_table"] = calibrator_table

    context = SimpleNamespace(artifacts=artifacts)

    # -------------------------------------------------
    # 4. Instantiate and load InferenceBundle
    # -------------------------------------------------

    bundle = InferenceBundle()

    # optional device override
    if device is not None:
        with open(bundle_config, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        cfg["device"] = device
        with open(bundle_config, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)

    bundle.load_context(context)

    return bundle

def upload_bundle_to_gcs(
    bucket_name: str,
    local_path: str,
    gcs_path: str,
):
    """
    Upload a local bundle zip to GCS.

    Args:
        bucket_name: e.g. "oral-models"
        local_path: e.g. "checkpoints/lesion_bundle_best_epoch10.zip"
        gcs_path: e.g. "bundle/v1/lesion_bundle_best_epoch10.zip"
    """
    assert os.path.exists(local_path), f"Local file not found: {local_path}"

    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(gcs_path)

    blob.upload_from_filename(local_path)

    print(f"✅ Bundle uploaded to gs://{bucket_name}/{gcs_path}")

def fit_calibration_table(records, mode="poly", degree=2, min_samples=50):
    """
    records: list of {model_id, class_id, raw_score, iou}
    returns: dict {(model_id, class_id): params}
    """
    table = {}
    # group
    groups = {}
    for r in records:
        key = (r["model_id"], int(r["class_id"]))
        groups.setdefault(key, []).append((r["raw_score"], r["iou"]))

    for key, vals in groups.items():
        if len(vals) < min_samples:
            continue
        x = np.array([v[0] for v in vals], dtype=np.float32)
        y = np.array([v[1] for v in vals], dtype=np.float32)

        if mode == "linear":
            # y = a x + b
            A = np.vstack([x, np.ones_like(x)]).T
            a, b = np.linalg.lstsq(A, y, rcond=None)[0]
            table[key] = {"mode": "linear", "a": float(a), "b": float(b)}
        else:
            # poly fit: coef c0..ck
            coef = np.polyfit(x, y, deg=degree)      # returns high->low
            coef = coef[::-1].tolist()               # make it c0..ck (for Horner in calibrator)
            table[key] = {"mode": "poly", "coef": [float(c) for c in coef]}

    return table

def weighted_boxes_fusion(
    boxes: torch.Tensor,
    scores: torch.Tensor,
    labels: torch.Tensor,
    iou_thres: float = 0.55,
    top_k: int = 300
) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """
    Simple class-aware WBF:
    - group by class
    - cluster boxes by IoU > threshold
    - fuse by score-weighted average
    """
    device = boxes.device
    if boxes.numel() == 0:
        return boxes, scores, labels

    # limit to top_k for speed
    if boxes.size(0) > top_k:
        idx = scores.argsort(descending=True)[:top_k]
        boxes, scores, labels = boxes[idx], scores[idx], labels[idx]

    fused_boxes = []
    fused_scores = []
    fused_labels = []

    for c in labels.unique().tolist():
        mask = labels == c
        b = boxes[mask]
        s = scores[mask]
        if b.numel() == 0:
            continue

        order = s.argsort(descending=True)
        b = b[order]
        s = s[order]

        used = torch.zeros(b.size(0), dtype=torch.bool, device=device)

        for i in range(b.size(0)):
            if used[i]:
                continue
            # start a cluster with i
            cluster_idx = [i]
            used[i] = True
            if i + 1 < b.size(0):
                ious = box_iou_xyxy(b[i].unsqueeze(0), b[i+1:]).squeeze(0)
                to_add = torch.where(ious > iou_thres)[0] + (i + 1)
                for j in to_add.tolist():
                    if not used[j]:
                        used[j] = True
                        cluster_idx.append(j)

            cb = b[cluster_idx]          # [K,4]
            cs = s[cluster_idx].clamp(min=1e-6)  # weights
            w = cs / cs.sum()
            fb = (cb * w[:, None]).sum(dim=0)
            fs = cs.max()  # common choice: max score, or average
            fused_boxes.append(fb)
            fused_scores.append(fs)
            fused_labels.append(int(c))

    if len(fused_boxes) == 0:
        return (torch.zeros((0,4), device=device),
                torch.zeros((0,), device=device),
                torch.zeros((0,), dtype=torch.long, device=device))

    return (torch.stack(fused_boxes, dim=0),
            torch.stack(fused_scores, dim=0),
            torch.tensor(fused_labels, dtype=torch.long, device=device))

def bbox_iou_ciou(box1_xyxy: torch.Tensor, box2_xyxy: torch.Tensor, eps: float = 1e-7) -> torch.Tensor:
    """
    CIoU between corresponding boxes.
    box1: [N,4]
    box2: [N,4]
    """
    b1_x1, b1_y1, b1_x2, b1_y2 = box1_xyxy.unbind(-1)
    b2_x1, b2_y1, b2_x2, b2_y2 = box1_xyxy.unbind(-1)
    
    # Intersection
    inter_x1 = torch.max(b1_x1, b2_x1)
    inter_y1 = torch.max(b1_y1, b2_y1)
    inter_x2 = torch.min(b1_x2, b2_x2)
    inter_y2 = torch.min(b1_y2, b2_y2)
    inter_w = (inter_x2 - inter_x1).clamp(min=0)
    inter_h = (inter_y2 - inter_y1).clamp(min=0)
    inter_area = inter_w * inter_h

    # Union
    area1 = (b1_x2 - b1_x1).clamp(min=0) * (b1_y2 - b1_y1).clamp(min=0)
    area2 = (b2_x2 - b2_x1).clamp(min=0) * (b2_y2 - b2_y1).clamp(min=0)
    union = area1 + area2 - inter_area + eps
    iou = inter_area / union

    # Centers
    b1_cx = (b1_x1 + b1_x2) / 2
    b1_cy = (b1_y1 + b1_y2) / 2
    b2_cx = (b2_x1 + b2_x2) / 2
    b2_cy = (b2_y1 + b2_y2) / 2
    center_dist2 = (b1_cx - b2_cx) ** 2 + (b1_cy - b2_cy) ** 2

    # Enclosing box diagonal
    enc_x1 = torch.min(b1_x1, b2_x1)
    enc_y1 = torch.min(b1_y1, b2_y1)
    enc_x2 = torch.max(b1_x2, b2_x2)
    enc_y2 = torch.max(b1_y2, b2_y2)
    c2 = (enc_x2 - enc_x1) ** 2 + (enc_y2 - enc_y1) ** 2 + eps

    # Aspect ratio term
    w1 = (b1_x2 - b1_x1).clamp(min=eps)
    h1 = (b1_y2 - b1_y1).clamp(min=eps)
    w2 = (b2_x2 - b2_x1).clamp(min=eps)
    h2 = (b2_y2 - b2_y1).clamp(min=eps)

    v = (4 / (math.pi ** 2)) * (torch.atan(w2 / h2) - torch.atan(w1 / h1)) ** 2

    with torch.no_grad():
        alpha = v / (1 - iou + v + eps)

    ciou = iou - (center_dist2 / c2) - alpha * v
    return ciou

def make_divisible(x: int, divisor: int = 8) -> int:
    return math.ceil(x / divisor) * divisor

def download_from_gcs(bucket_name, blob_path, local_path):
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_path)

    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    blob.download_to_filename(local_path)
    print(f"[GCS] Downloaded {blob_path} → {local_path}")

def match_predictions(
    pred_boxes,
    pred_labels,
    pred_scores,
    gt_boxes,
    gt_labels,
    iou_threshold=0.5,
    score_threshold=0.5
):
    """
    :param pred_boxes: Tensor [N,4] xyxy
    :param pred_labels: Tensor [N]
    :param pred_scores: Tensor [N]
    :param gt_boxes: Tensor [M,4] xyxy
    :param gt_labels: Tensor [M]
    return dict with tp / fp / fn
    """
    # Confidence filtering
    keep = pred_scores >= score_threshold
    pred_boxes = pred_boxes[keep]
    pred_labels = pred_labels[keep]
    pred_scores = pred_scores[keep]

    matched_gt = set()
    tp = []
    fp = []

    # IoU matching 
    if len(pred_boxes) > 0 and len(gt_boxes) > 0:
        ious = box_iou(pred_boxes, gt_boxes) # [N, M]

        for pred_idx in range(len(pred_boxes)):
            # Find the best prediction iou for corresponding gt
            best_iou, best_gt_idx = ious[pred_idx].max(0)

            # IoU & label matching
            if (
                best_iou >= iou_threshold
                and best_gt_idx.item() not in matched_gt
                and pred_labels[pred_idx] == gt_labels[best_gt_idx]
            ):
                tp.append(pred_idx)
                matched_gt.add(best_gt_idx.item())
            else:
                fp.append(pred_idx)
    else:
        # 沒有 gt, 全部 pred 都是 fp
        fp = list(range(len(pred_boxes)))
    
    # False Negative Case
    fn = [
        gt_idx for gt_idx in range(len(gt_boxes))
        if gt_idx not in matched_gt
    ]

    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "num_gt": len(gt_boxes),
        "num_pred": len(pred_boxes)
    }

def postprocess_boxes(boxes, scores, labels, iou_thresh=0.5):
    keep = nms(boxes, scores, iou_thresh)
    return boxes[keep], scores[keep], labels[keep]

def build_raw_text(row):
    parts = []

    if pd.notna(row["chief_complaint"]):
        parts.append(f"Chief complaint: {row['chief_complaint']}.")

    if pd.notna(row["patient_statement"]):
        parts.append(f"Patient statement: {row['patient_statement']}.")

    if pd.notna(row["doctor_note"]):
        parts.append(f"Doctor note: {row['doctor_note']}.")

    if pd.notna(row["observation_text"]):
        parts.append(f"Observation: {row['observation_text']}.")

    if pd.notna(row["diagnosis_text"]):
        parts.append(f"Diagnosis: {row['diagnosis_text']}.")

    if pd.notna(row["pathology_report"]):
        parts.append(f"Pathology: {row['pathology_report']}.")

    return " ".join(parts)

def gcs_download_to_cache(gs_uri: str, cache_dir: str = "/tmp/gcs_cache") -> str:
    os.makedirs(cache_dir, exist_ok=True)
    # stable local filename
    h = hashlib.md5(gs_uri.encode("utf-8")).hexdigest()
    local_path = os.path.join(cache_dir, h + os.path.splitext(gs_uri)[-1])

    if os.path.exists(local_path):
        return local_path

    assert gs_uri.startswith("gs://")
    bucket_name, blob_path = gs_uri.replace("gs://", "").split("/", 1)
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    blob.download_to_filename(local_path)
    return local_path

def serialize_meta(obj):
    """
    Recursively convert objects to JSON-serializable types.
    """
    if isinstance(obj, dict):
        return {k: serialize_meta(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [serialize_meta(v) for v in obj]
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif torch.is_tensor(obj):
        return obj.detach().cpu().numpy().tolist()
    elif isinstance(obj, (float, int, str, bool)) or obj is None:
        return obj
    else:
        raise TypeError(f"Object of type {type(obj)} is not JSON serializable")

def save_retriever_index_gcs(index, meta, gcs_path):
    """
    Docstring for save_retriever_index_gcs
    
    :param index: teacher_index (FIASS/custom vectors)
    :param meta: teacher_meta (list/dict)
    :param gcs_path: "gs://bucket/path/index.pt"
    """
    local_index = "/tmp/retriever_index.pt"
    local_meta = "/tmp/retriever_meta.json"

    torch.save(index, local_index)

    # ---- serialize meta ----
    meta_json = serialize_meta(meta)

    with open(local_meta, "w", encoding="utf-8") as f:
        json.dump(meta_json, f, ensure_ascii=False, indent=2)
    
    print("gcs_path:", gcs_path)
    bucket_name = gcs_path.replace("gs://", "").split("/")[0]
    print("bucket_name:", bucket_name)
    blob_path = "/".join(gcs_path.replace("gs://", "").split("/")[1:])
    print("blob_path:", blob_path)

    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)

    bucket.blob(blob_path + "_index").upload_from_filename(local_index)
    bucket.blob(blob_path + "_meta").upload_from_filename(local_meta)

    print(f"Saved retriever index to: {gcs_path}")

def load_retriever_index_gcs(gcs_path, device):
    """
    Docstring for load_retriever_index_gcs
    
    :param gcs_path: "gs://retriever_index.pt"
    :param device: (index, meta)
    """
    local_index = "/tmp/retriever_index.pt"
    local_meta = "/tmp/retriever_meta.json"

    bucket_name = gcs_path.replace("gs://", "").split("/")[0]
    blob_path = "/".join(gcs_path.replace("gs://", "").split("/")[1])

    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)

    bucket.blob(blob_path + "_index").download_to_filename(local_index)
    bucket.blob(blob_path + "_meta").download_to_filename(local_meta)

    index = torch.load(local_index, map_location=device)

    with open(local_meta, "r") as f:
        meta = json.load(f)
    
    print(f"Loaded retriever index from {gcs_path}")
    return index, meta

def upload_checkpoint_to_gcs(model, bucket, path):
    with tempfile.NamedTemporaryFile(suffix=".pth") as f:
        torch.save(model.state_dict(), f.name)
        blob = bucket.blob(path)
        blob.upload_from_filename(f.name)

def upload_to_gcs(bucket, model_bucket, job_id, local_file_path="/tmp/run_id.txt", prefix="runs"):
    blob = bucket.blob(f"gs://{model_bucket}/{prefix}/{job_id}/run_id.txt")
    blob.upload_from_filename(local_file_path)

def polygon_to_mask(polygon, height, width):
    """
    polygon: List[[x, y], ...]
    return: (H, W) binary mask
    """
    mask = np.zeros((height, width), dtype=np.uint8)

    if len(polygon) == 0:
        return mask

    pts = np.array(polygon, dtype=np.int32)
    pts = pts.reshape((-1, 1, 2))   # OpenCV 格式

    cv2.fillPoly(mask, [pts], color=1)

    return mask

def polygons_to_gt_masks(polygons, H, W):
    """
    polygons: List[List[[x,y]]]
    return: Tensor [N, H, W]
    """
    masks = []
    for poly in polygons:
        m = polygon_to_mask(poly, H, W)
        masks.append(m)

    masks = np.stack(masks, axis=0)  # [N, H, W]
    return masks

def preprocess(img_path):
    img = Image.open(img_path).convert("RGB")
    tf = T.Compose([
        T.ToTensor(),
        T.Resize(),
        T.Normalize([0.485,0.456,0.406],[0.228,0.224,0.225])
    ])
    return tf(img).unsqueeze(0), img.size

def cxcywh_to_xyxy(b):
    # b: [N, 4] or [*, 4]
    x_c, y_c, w, h = b.unbind(-1)  # ✅ 對最後一個維度做拆分
    x1 = x_c - 0.5 * w
    y1 = y_c - 0.5 * h
    x2 = x_c + 0.5 * w
    y2 = y_c + 0.5 * h
    return torch.stack([x1, y1, x2, y2], dim=-1)

def xyxy_to_cxcywh(xyxy: torch.Tensor) -> torch.Tensor:
    x1, y1, x2, y2 = xyxy.unbind(-1)
    cx = (x1 + x2) / 2
    cy = (y1 + y2) / 2
    w = (x2 - x1).clamp(min=1e-6)
    h = (y2 - y1).clamp(min=1e-6)
    return torch.stack([cx, cy, w, h], dim=-1)

def compute_precision_recall(tp, fp, fn):
    """
    Docstring for compute_precision_recall
    
    :param tp: Description
    :param fp: Description
    :param fn: Description
    """
    precision = len(tp) / max(len(tp) + len(fp), 1)
    recall = len(tp) / max(len(tp) + len(fn), 1)
    return precision, recall

def update_confusion_matrix(
    cm, tp, fp, fn,
    pred_labels, gt_labels,
    num_classes
):
    bg = num_classes

    for pi, gi in tp:
        cm[gt_labels[0][gi], pred_labels[pi]] += 1

    for pi in fp:
        cm[bg, pred_labels[pi]] += 1

    for gi in fn:
        cm[gt_labels[0][gi], bg] += 1

    return cm

def box_iou(boxes1, boxes2):
    """
    boxes1: Tensor[N, 4]
    boxes2: Tensor[M, 4]  (M can be 0)
    return: Tensor[N, M]
    """
    if boxes2.numel() == 0:
        # no GT → IoU matrix is empty
        return torch.zeros(
            (boxes1.shape[0], 0),
            device=boxes1.device
        )

    area1 = (boxes1[:, 2] - boxes1[:, 0]) * (boxes1[:, 3] - boxes1[:, 1])
    area2 = (boxes2[:, 2] - boxes2[:, 0]) * (boxes2[:, 3] - boxes2[:, 1])

    lt = torch.max(boxes1[:, None, :2], boxes2[:, :2])
    rb = torch.min(boxes1[:, None, 2:], boxes2[:, 2:])
    wh = (rb - lt).clamp(min=0)

    inter = wh[:, :, 0] * wh[:, :, 1]
    union = area1[:, None] + area2 - inter

    return inter / union.clamp(min=1e-6)

class HungarianMatcher(torch.nn.Module):
    """
    DETR / DINO style Hugarian matcher
    Description: Handle empty GT safely
    """
    def __init__(
        self,
        const_class=1.0,
        const_bbox=1.0,
        const_iou=1.0
    ):
        super().__init__()
        self.const_class = const_class
        self.const_bbox = const_bbox
        self.const_iou = const_iou

    @torch.no_grad()
    def forward(self, pred_logits, pred_boxes, gt_labels, gt_boxes):
        """
        pred_logits: (N, C)
        pred_boxes: (N, 4) cxcywh
        gt_labels: (M,)
        gt_boxes: (M, 4) cxcywh
        """

        N = pred_boxes.shape[0]
        M = gt_boxes.shape[0]

        device = pred_boxes.device

        # Case 1: No GT
        if M == 0:
            # no matches
            return (
                torch.empty(0, dtype=torch.long, device=device),
                torch.empty(0, dtype=torch.long, device=device)
            )
        
        # compute classification cost
        prob = pred_logits.softmax(-1)      # (N, C)
        cost_class = -prob[:, gt_labels]    # (N, M)

        # compute bbox (L1) cost
        cost_bbox = torch.cdist(pred_boxes, gt_boxes, p=1)
        
        # compute IoU cost
        pred_xyxy = cxcywh_to_xyxy(pred_boxes)
        gt_xyxy = cxcywh_to_xyxy(gt_boxes)

        iou = box_iou(pred_xyxy, gt_xyxy)
        cost_iou = -iou

        total_cost = \
            self.const_class * cost_class + \
            self.const_bbox * cost_bbox + \
            self.const_iou * cost_iou
        
        # Hugarian matching
        indices = linear_sum_assignment(total_cost.cpu())

        return (
            torch.as_tensor(indices[0], dtype=torch.long, device=device),
            torch.as_tensor(indices[1], dtype=torch.long, device=device)
        )

def dfl_decode(pred, reg_max):
    """
    pred: [N, 4*(reg_max+1)]
    return: [N, 4] distances
    """
    pred = pred.view(-1, 4, reg_max + 1)
    prob = pred.softmax(dim=2)
    bins = torch.arange(reg_max + 1, device=pred.device, dtype=pred.dtype)
    dist = (prob * bins).sum(dim=2)
    return dist

def decode_boxes(boxes, img_w, img_h, fmt="cxcywh"):
    """
    boxes: Tensor[N,4], normalized
    return: Tensor[N,4], xyxy in image space
    """
    if fmt == "cxcywh":
        cx, cy, w, h = boxes.unbind(-1)
        x1 = cx - w / 2
        y1 = cy - h / 2
        x2 = cx + w / 2
        y2 = cy + h / 2
        boxes = torch.stack([x1, y1, x2, y2], dim=-1)

    # normalized -> pixel
    boxes[:, [0, 2]] *= img_w
    boxes[:, [1, 3]] *= img_h

    return boxes

def decode_yolov7_outputs(
    outputs,
    anchors,
    strides,
    num_classes,
    score_threshold=0.01
):
    """
    outputs: list of Tensor[B, C, H, W]
    anchors: list of Tensor[na, 2] (w,h) per scale
    strides: list[int]
    return: list of dict per image
    """

    device = outputs[0].device
    B = outputs[0].shape[0]
    all_results = []

    for b in range(B):
        boxes_all = []
        scores_all = []
        labels_all = []

        for out, anchor, stride in zip(outputs, anchors, strides):
            _, C, H, W = out.shape
            na = anchor.shape[0]

            out_b = out[b].view(na, 5 + num_classes, H, W).permute(0, 2, 3, 1)

            # grid
            yv, xv = torch.meshgrid(
                torch.arange(H, device=device),
                torch.arange(W, device=device),
                indexing="ij"
            )
            grid = torch.stack((xv, yv), 2).float()

            # predictions
            xy = (torch.sigmoid(out_b[..., 0:2]) * 2 - 0.5 + grid) * stride
            wh = (torch.sigmoid(out_b[..., 2:4]) * 2) ** 2 * anchor[:, None, None, :]
            obj = torch.sigmoid(out_b[..., 4])
            cls = torch.sigmoid(out_b[..., 5:])

            score, label = cls.max(-1)
            score = score * obj

            mask = score > score_threshold
            if mask.sum() == 0:
                continue
            
            xy = xy[mask]
            wh = wh[mask]
            score = score[mask]
            label = label[mask]

            # xywh -> xyxy
            x1y1 = xy - wh / 2
            x2y2 = xy + wh / 2
            box = torch.cat([x1y1, x2y2], dim=-1)

            boxes_all.append(box)
            scores_all.ppend(score)
            labels_all.append(label)
        
        if boxes_all:
            all_results.append({
                "boxes": torch.zeros((0, 4), device=device),
                "scores": torch.zeros((0,), device=device),
                "labels": torch.zeros((0,), dtype=torch.long, device=device)
            })
    
    return all_results

def _to_torch_images(x: Any, device: torch.device) -> torch.Tensor:
    """
    Accepts:
      - np.ndarray [B,3,H,W] float32
      - torch.Tensor [B,3,H,W]
      - list of np.ndarray or torch tensors (each [3,H,W] or [1,3,H,W])
    Returns torch.Tensor [B,3,H,W] float32
    """
    if isinstance(x, torch.Tensor):
        t = x
    elif isinstance(x, np.ndarray):
        t = torch.from_numpy(x)
    elif isinstance(x, list):
        ts = []
        for item in x:
            ts.append(_to_torch_images(item, device=torch.device("cpu")))
        t = torch.cat(ts, dim=0)
    else:
        raise TypeError(f"Unsupported roi_images type: {type(x)}")

    if t.ndim == 3:
        t = t.unsqueeze(0)
    if t.ndim != 4:
        raise ValueError(f"roi_images must be [B,3,H,W], got shape={tuple(t.shape)}")

    return t.to(device=device, dtype=torch.float32)


def _maybe_json_load(v: Any) -> Any:
    if isinstance(v, str):
        v = v.strip()
        if (v.startswith("{") and v.endswith("}")) or (v.startswith("[") and v.endswith("]")):
            try:
                return json.loads(v)
            except Exception:
                return v
    return v

def _parse_pyfunc_inputs(model_input: Any) -> Tuple[np.ndarray, Optional[List[Dict]], Optional[List[Dict]], Optional[List[Tuple[int,int]]]]:
    """
    Returns:
      roi_images: np.ndarray [B,3,H,W]
      roi_meta_list: Optional[List[dict]]
      roi_transform_list: Optional[List[dict]]
      orig_shapes_list: Optional[List[(H,W)]]
    Supports:
      - dict with keys: roi_images, roi_meta, roi_transform, orig_shape
      - pandas.DataFrame with columns above (one row per image)
    """
    if isinstance(model_input, dict):
        roi_images = model_input.get("roi_images", None)
        roi_meta = model_input.get("roi_meta", None)
        roi_transform = model_input.get("roi_transform", None)
        orig_shape = model_input.get("orig_shape", None)

        if roi_images is None:
            raise ValueError("model_input dict must contain key 'roi_images'")

        roi_meta = _maybe_json_load(roi_meta)
        roi_transform = _maybe_json_load(roi_transform)
        orig_shape = _maybe_json_load(orig_shape)

        # normalize to list per image if provided
        # roi_images can be np array [B,3,H,W] or list
        if isinstance(roi_images, np.ndarray):
            B = roi_images.shape[0]
        elif isinstance(roi_images, list):
            B = len(roi_images)
        else:
            raise TypeError(f"Unsupported roi_images type: {type(roi_images)}")

        def _norm_list(x, name):
            if x is None:
                return None
            if isinstance(x, list):
                if len(x) != B:
                    raise ValueError(f"{name} length mismatch: {len(x)} != {B}")
                return x
            # if single dict/tuple, broadcast
            return [x for _ in range(B)]

        roi_meta_list = _norm_list(roi_meta, "roi_meta")
        roi_transform_list = _norm_list(roi_transform, "roi_transform")
        orig_shapes_list = _norm_list(orig_shape, "orig_shape")

        return roi_images, roi_meta_list, roi_transform_list, orig_shapes_list

    if isinstance(model_input, pd.DataFrame):
        if "roi_images" not in model_input.columns:
            raise ValueError("DataFrame must contain 'roi_images' column")

        roi_images_col = model_input["roi_images"].tolist()
        roi_meta_list = model_input["roi_meta"].tolist() if "roi_meta" in model_input.columns else None
        roi_transform_list = model_input["roi_transform"].tolist() if "roi_transform" in model_input.columns else None
        orig_shapes_list = model_input["orig_shape"].tolist() if "orig_shape" in model_input.columns else None

        # decode json string cells if needed
        if roi_meta_list is not None:
            roi_meta_list = [_maybe_json_load(v) for v in roi_meta_list]
        if roi_transform_list is not None:
            roi_transform_list = [_maybe_json_load(v) for v in roi_transform_list]
        if orig_shapes_list is not None:
            orig_shapes_list = [_maybe_json_load(v) for v in orig_shapes_list]

        # stack images
        if isinstance(roi_images_col[0], np.ndarray):
            roi_images = np.stack(roi_images_col, axis=0)  # [B,3,H,W]
        else:
            # allow list of lists, try numpy
            roi_images = np.array(roi_images_col, dtype=np.float32)

        return roi_images, roi_meta_list, roi_transform_list, orig_shapes_list

    raise TypeError(f"Unsupported model_input type: {type(model_input)}")

def draw_boxes(image, boxes, labels, scores=None, color_label_map=None):
    """
    image: np.ndarray [H,W,3]
    boxes: Tensor[N,4] or np.ndarray, xyxy pixel space
    """
    if torch.is_tensor(boxes):
        boxes = boxes.cpu().numpy()
    if torch.is_tensor(labels):
        labels = labels.cpu().numpy()
    if scores is not None and torch.is_tensor(scores):
        scores = scores.cpu().numpy()

    box_idx = np.argsort(scores) if scores is not None else range(len(boxes))
    boxes = boxes[box_idx]
    labels = labels[box_idx]

    for i, (x1, y1, x2, y2) in enumerate(boxes[:2].astype(int)):
        
        if color_label_map is not None:
            color = color_label_map[labels[i]]
        else:
            color = (0, 255, 0)

        cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)

        text = str(labels[i])
        if scores is not None:
            text += f" {scores[i]:.2f}"

            cv2.putText(
                image, text,
                (x1, max(y1 - 5, 10)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5, color, 1
            )

def tensor_to_cv2(image_tensor, width, height, mean=None, std=None):
    """
    image_tensor: torch.Tensor [3,H,W], normalized
    return: np.ndarray [H,W,3] uint8 (BGR)
    """
    img = image_tensor.detach().cpu()

    # ===== denormalize if needed =====
    if mean is not None and std is not None:
        mean = torch.tensor(mean).view(3,1,1)
        std = torch.tensor(std).view(3,1,1)
        img = img * std + mean

    # ===== clamp to valid range =====
    img = img.clamp(0, 1)

    # ===== CHW -> HWC =====
    img = img.permute(1, 2, 0).numpy()

    # ===== float -> uint8 =====
    img = (img * 255).astype(np.uint8)

    # ===== RGB -> BGR (OpenCV) =====
    img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    img = cv2.resize(img, (width, height))

    return img

def plot_roc_pr_multi_class(
    all_y_true,
    all_y_score,
    num_classes,
    save_dir="metric"      
):
    os.makedirs(save_dir, exist_ok=True)

    all_y_true = np.array(all_y_true)
    all_y_score = np.array(all_y_score)

    roc_aucs = {}
    aps = {}

    # ----- per-class -----
    for c in range(num_classes):
        y_true_c = all_y_true[:, c]
        y_score_c = all_y_score[:, c]

        # skip class with no positive GT
        if y_true_c.sum() == 0:
            print(f"[Class {c}] skipped (no positive GT)")
            continue

        roc_auc, ap = plot_roc_pr_single_class(
            y_true_c, y_score_c, c, save_dir
        )

        roc_aucs[c] = roc_auc
        aps[c] = ap

    # ----- ROC ------
    plt.figure()
    for c, auc_c in roc_aucs.items():
        fpr, tpr, _ = roc_curve(all_y_true[:, c], all_y_score[:, c])
        plt.plot(fpr, tpr, label=f"Class {c} (AUC)={auc_c:.2f}")

    plt.plot([0, 1], [0, 1], "--", color="gray")
    plt.xlabel("False Positive Rate")
    plt.ylabel("True Positive Rate")
    plt.title("Per-class ROC Curves")
    plt.legend()
    plt.tight_layout()
    plt.savefig(f"{save_dir}/roc_all_classes.png")
    plt.close()

    # ----- PR -----
    plt.figure()
    for c, ap_c in aps.items():
        precision, recall, _ = precision_recall_curve(
            all_y_true[:, c], all_y_score[:, c]
        )
        plt.plot(recall, precision, label=f"Class {c} (AP={ap_c:.2f})")
    
    plt.xlabel("Recall")
    plt.ylabel("Precision")
    plt.title("Per-class PR Curves")
    plt.legend()
    plt.tight_layout()
    plt.savefig(f"{save_dir}/pr_all_classes.png")
    plt.close()

    return roc_aucs, aps

def plot_roc_pr_single_class(y_true, y_score, class_id, save_dir):
    """
    y_true: (N,) binary
    y_score: (N,) float
    """

    # ------ ROC ------
    fpr, tpr, _ = roc_curve(y_true, y_score)
    roc_auc = auc(fpr, tpr)

    plt.figure()
    plt.plot(fpr, tpr, label=f"ROC (AUC={roc_auc:.3f})")
    plt.plot([0, 1], [0, 1], "--", color="gray")
    plt.xlabel("False Positive Rate")
    plt.ylabel("True Positive Rate")
    plt.title(f"ROC Curve - Class {class_id}")
    plt.legend()
    plt.tight_layout()
    plt.savefig(f"{save_dir}/roc_class_{class_id}.png")
    plt.close()

    # ----- Precision/Recall -----
    precision, recall, _ = precision_recall_curve(y_true, y_score)
    ap = average_precision_score(y_true, y_score)

    plt.figure()
    plt.plot(recall, precision, label=f"AP={ap:.3f}")
    plt.xlabel("Recall")
    plt.ylabel("Precision")
    plt.title(f"PR Curve - Class {class_id}")
    plt.legend()
    plt.tight_layout()
    plt.savefig(f"{save_dir}/pr_class_{class_id}.png")
    plt.close()

    return roc_auc, ap

def visualize_result(
    image_tensor, 
    width, 
    height, 
    pred, 
    gt, 
    save_path, 
    color_label_map
):
    img = tensor_to_cv2(
        image_tensor,
        width,
        height,
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )

    # GT = green
    draw_boxes(
        img,
        gt["boxes"].cpu().numpy(),
        gt["labels"].cpu().numpy(),
        color_label_map=color_label_map
    )

    # Prediction = red
    draw_boxes(
        img,
        pred["boxes"].cpu().numpy(),
        pred["labels"].cpu().numpy(),
        pred["scores"].cpu().numpy(),
        color_label_map=color_label_map
    )

    cv2.imwrite(save_path, img)

def dist2bbox(
    dist: torch.Tensor,
    points: torch.Tensor,
    xyxy: bool = True
):
    """
    Distance to bounding box.

    Args:
        dist:   Tensor[N, 4]  -> (l, t, r, b) distances (pixel units)
        points: Tensor[N, 2]  -> (x, y) anchor points (pixel coords)
        xyxy:   return xyxy if True else cxcywh

    Returns:
        Tensor[N, 4]
    """
    x, y = points[:, 0], points[:, 1]
    l, t, r, b = dist[:, 0], dist[:, 1], dist[:, 2], dist[:, 3]

    x1 = x - l
    y1 = y - t
    x2 = x + r
    y2 = y + b

    if xyxy:
        return torch.stack([x1, y1, x2, y2], dim=-1)
    else:
        cx = (x1 + x2) * 0.5
        cy = (y1 + y2) * 0.5
        w = x2 - x1
        h = y2 - y1
        return torch.stack([cx, cy, w, h], dim=-1)

def bbox2dist(
    points: torch.Tensor,
    bbox: torch.Tensor,
    reg_max: int
):
    """
    Bounding box to distance representation.

    Args:
        points: Tensor[N, 2]  -> (x, y) anchor points (pixel coords)
        bbox:   Tensor[N, 4]  -> (x1, y1, x2, y2) ground truth bbox
        reg_max: int          -> maximum distance bin (DFL)

    Returns:
        Tensor[N, 4] -> (l, t, r, b), clipped to [0, reg_max)
    """
    x, y = points[:, 0], points[:, 1]
    x1, y1, x2, y2 = bbox.unbind(-1)

    l = x - x1
    t = y - y1
    r = x2 - x
    b = y2 - y

    dist = torch.stack([l, t, r, b], dim=-1)

    # DFL requires target in [0, reg_max)
    return dist.clamp(min=0, max=reg_max - 1e-6)

# -------------------------------------------
#               Loss functions
# -------------------------------------------

def loss_dfl_tal(
    reg_pred, obj_pred, cls_pred,
    anchors_xy, stride,
    targets,
    assigner,
    reg_max
):
    """
    targets: gt_boxes [M,4]
    """
    device = reg_pred.device

    reg_pred = reg_pred.flatten(2).permute(0, 2, 1)
    obj_pred = obj_pred.flatten(2).permute(0, 2, 1).sigmoid()
    cls_pred = cls_pred.flatten(2).permute(0, 2, 1).sigmoid()

    pred_dist = dfl_decode(reg_pred.reshape(-1, 4 * (reg_max + 1)), reg_max)
    pred_boxes = dist2bbox(pred_dist, anchors_xy)
    pred_scores = obj_pred.squeeze(-1) * cls_pred.squeeze(-1)

    matched_gt, fg_mask = assigner.assign(
        pred_scores,
        pred_boxes,
        targets["boxes"]
    )

    # bbox loss
    box_loss = bbox_iou_ciou(
        pred_boxes[fg_mask],
        targets["boxes"][matched_gt[fg_mask]]
    )
    box_loss = (1 - box_loss).mean()

    # DFL loss
    dfl = dfl_loss(
        reg_pred.reshape(-1, 4 * (reg_max + 1))[fg_mask],
        bbox2dist(anchors_xy[fg_mask], targets["boxes"][matched_gt[fg_mask]]),
        reg_max
    )

    # cls / obj
    cls_loss = F.binary_cross_entropy(
        cls_pred.squeeze(-1)[fg_mask],
        torch.ones_like(cls_pred.squeeze(-1)[fg_mask])
    )

    obj_loss = F.binary_cross_entropy(
        obj_pred.squeeze(-1),
        fg_mask.float()
    )

    return box_loss + dfl + cls_loss + obj_loss


def dfl_loss(pred, target, reg_max):
    """
    pred: [N, 4*(reg_max+1)]
    target: [N, 4] (continuous)
    """
    pred = pred.view(-1, 4, reg_max + 1)
    target = target.clamp(0, reg_max - 1e-6)

    left = target.floor().long()
    right = left + 1

    wl = right.float() - target
    wr = target - left.float()

    loss = (
        F.cross_entropy(pred[..., 0, :], left[:, 0], reduction="none") * wl[:, 0] + 
        F.cross_entropy(pred[..., 0, :], right[:, 0], reduction="none") * wr[:, 0]
    )

    for i in range(1, 4):
        loss += (
            F.cross_entropy(pred[..., i, :], left[:, i], reduction="none") * wl[:, i] + 
            F.cross_entropy(pred[..., i, :], right[:, i], reduction="none") * wr[:, i]
        )

    return loss.mean()


def mouth_localization_loss(
    preds: List[torch.Tensor], 
    targets: List[Dict[str, torch.Tensor]], 
    cfg: MouthDetConfig = MouthDetConfig()
) -> Dict[str, torch.Tensor]:
    """
    targets: list length B
        each item:
        - "boxes": FloatTensor [M,4] in xyxy pixel coords (mouth boxes)
        - "labels": LongTensor [M] (for mouth-only can be zeros)
    """
    device = preds[0].device
    box_loss = torch.tensor(0.0, device=device)
    obj_loss = torch.tensor(0.0, device=device)
    cls_loss = torch.tensor(0.0, device=device)

    bce = nn.BCEWithLogitsLoss(reduction="none")

    bs = preds[0].shape[0]
    assert len(targets) == bs, "targets length must match batch size"

    for b in range(bs):
        gt_boxes = targets[b].get("boxes", torch.zeros((0, 4), device=device)).to(device)
        gt_labels = targets[b].get("labels", torch.zeros((0,), dtype=torch.long, device=device)).to(device)

        # If no GT: only obj loss to zeros
        for si, pred in enumerate(preds):
            stride = cfg.strides[si]
            p = pred[b]  # [C,H,W]
            reg = p[0:4]                # distances
            obj_logit = p[4:5]          # [1,H,W]
            cls_logit = p[5:]           # [nc,H,W]
            H, W = reg.shape[1], reg.shape[2]

            # Build grid centers
            yy, xx = torch.meshgrid(
                torch.arange(H, device=device),
                torch.arange(W, device=device),
                indexing="ij",
            )
            cx = (xx + 0.5) * stride
            cy = (yy + 0.5) * stride
            points = torch.stack([cx, cy], dim=-1).reshape(-1, 2)  # [HW,2]

            # Prepare targets for this scale
            obj_t = torch.zeros((H * W, 1), device=device)
            cls_t = torch.zeros((H * W, cfg.nc), device=device)
            reg_t = torch.zeros((H * W, 4), device=device)  # l,t,r,b in pixels

            if gt_boxes.numel() > 0:
                # Assign each GT to a small center region on each scale
                gt_c = xyxy_to_cxcywh(gt_boxes)[:, :2]  # [M,2]
                # Convert GT center to feature coordinates
                gt_fx = gt_c[:, 0] / stride - 0.5
                gt_fy = gt_c[:, 1] / stride - 0.5

                # For each GT, mark points within center_radius as positive (can overlap -> keep best IoU later)
                # Compute distance in feature grid units
                px = points[:, 0] / stride - 0.5
                py = points[:, 1] / stride - 0.5
                # [HW, M]
                dist2 = (px[:, None] - gt_fx[None, :]) ** 2 + (py[:, None] - gt_fy[None, :]) ** 2
                pos_mask = dist2 <= (cfg.center_radius ** 2)

                # Additionally ensure point lies inside GT box
                x, y = points[:, 0], points[:, 1]
                inside = (
                    (x[:, None] >= gt_boxes[None, :, 0]) &
                    (y[:, None] >= gt_boxes[None, :, 1]) &
                    (x[:, None] <= gt_boxes[None, :, 2]) &
                    (y[:, None] <= gt_boxes[None, :, 3])
                )
                pos_mask = pos_mask & inside  # [HW, M]

                # If multiple GTs match same point, choose the GT with highest IoU (w.r.t. a *current* box estimate)
                # First estimate predicted boxes for all points (detach to avoid heavy coupling in assignment)
                reg_pix = reg.reshape(4, -1).T * stride  # [HW,4] l,t,r,b in pixels
                pred_boxes = torch.stack([
                    x - reg_pix[:, 0],
                    y - reg_pix[:, 1],
                    x + reg_pix[:, 2],
                    y + reg_pix[:, 3],
                ], dim=-1).detach()

                # For points with any GT match:
                any_pos = pos_mask.any(dim=1)  # [HW]
                if any_pos.any():
                    # Compute IoU for those points with all GTs (only where pos_mask true)
                    idx = torch.where(any_pos)[0]
                    pb = pred_boxes[idx]  # [K,4]
                    # Expand to [K,M,4] and compute IoU (vectorized)
                    pb_e = pb[:, None, :].expand(-1, gt_boxes.shape[0], -1)
                    gb_e = gt_boxes[None, :, :].expand(pb.shape[0], -1, -1)

                    # IoU (use plain IoU from CIoU parts for speed)
                    inter_x1 = torch.max(pb_e[..., 0], gb_e[..., 0])
                    inter_y1 = torch.max(pb_e[..., 1], gb_e[..., 1])
                    inter_x2 = torch.min(pb_e[..., 2], gb_e[..., 2])
                    inter_y2 = torch.min(pb_e[..., 3], gb_e[..., 3])
                    inter = (inter_x2 - inter_x1).clamp(min=0) * (inter_y2 - inter_y1).clamp(min=0)
                    area_p = (pb_e[..., 2] - pb_e[..., 0]).clamp(min=0) * (pb_e[..., 3] - pb_e[..., 1]).clamp(min=0)
                    area_g = (gb_e[..., 2] - gb_e[..., 0]).clamp(min=0) * (gb_e[..., 3] - gb_e[..., 1]).clamp(min=0)
                    union = area_p + area_g - inter + 1e-7
                    iou = inter / union  # [K,M]

                    # Mask out non-center candidates
                    pm = pos_mask[idx]  # [K,M]
                    iou = torch.where(pm, iou, torch.full_like(iou, -1.0))
                    best_iou, best_gt = iou.max(dim=1)  # [K]

                    # Filter weak positives
                    keep_pos = best_iou >= cfg.min_iou_pos
                    idx = idx[keep_pos]
                    best_gt = best_gt[keep_pos]

                    if idx.numel() > 0:
                        obj_t[idx, 0] = 1.0
                        # cls target
                        if cfg.nc == 1:
                            cls_t[idx, 0] = 1.0
                        else:
                            cls_t[idx, gt_labels[best_gt]] = 1.0

                        # reg target (l,t,r,b distances in pixels)
                        g = gt_boxes[best_gt]  # [K,4]
                        pxp = points[idx, 0]
                        pyp = points[idx, 1]
                        l = (pxp - g[:, 0]).clamp(min=0)
                        t = (pyp - g[:, 1]).clamp(min=0)
                        r = (g[:, 2] - pxp).clamp(min=0)
                        btm = (g[:, 3] - pyp).clamp(min=0)
                        reg_t[idx] = torch.stack([l, t, r, btm], dim=-1)

            # Losses for this scale
            obj_logit_flat = obj_logit.reshape(1, -1).T  # [HW,1]
            cls_logit_flat = cls_logit.reshape(cfg.nc, -1).T  # [HW,nc]
            reg_flat = reg.reshape(4, -1).T * stride  # [HW,4] in pixels

            # Obj BCE
            obj_l = bce(obj_logit_flat, obj_t).mean()
            obj_loss = obj_loss + obj_l

            # Cls BCE (only on positives to reduce imbalance)
            pos_idx = obj_t[:, 0] > 0.5
            if pos_idx.any():
                cls_l = bce(cls_logit_flat[pos_idx], cls_t[pos_idx]).mean()
                cls_loss = cls_loss + cls_l

                # Box CIoU loss (decode reg into xyxy)
                x = points[:, 0]
                y = points[:, 1]
                pred_xyxy = torch.stack([
                    x - reg_flat[:, 0],
                    y - reg_flat[:, 1],
                    x + reg_flat[:, 2],
                    y + reg_flat[:, 3],
                ], dim=-1)

                tgt_xyxy = torch.stack([
                    x - reg_t[:, 0],
                    y - reg_t[:, 1],
                    x + reg_t[:, 2],
                    y + reg_t[:, 3],
                ], dim=-1)

                ciou = bbox_iou_ciou(pred_xyxy[pos_idx], tgt_xyxy[pos_idx])
                box_l = (1.0 - ciou).mean()
                box_loss = box_loss + box_l

    # Normalize by batch (and number of scales implicitly)
    n = float(bs)
    box_loss = box_loss / n
    obj_loss = obj_loss / n
    cls_loss = cls_loss / n

    total = (
        cfg.box_weight * box_loss
        + cfg.obj_weight * obj_loss
        + cfg.cls_weight * cls_loss
    )
    return {
        "loss": total,
        "loss_box": box_loss.detach(),
        "loss_obj": obj_loss.detach(),
        "loss_cls": cls_loss.detach(),
    }

def distill_loss(student_logits, teacher_logits, labels, T=2.0, alpha=0.2):
    """
    student_logits/teacher_logits: [B, L, V]
    labels: [B, L] with -100 ignore
    """
    # mask for valid positions
    mask = (labels != -100).unsqueeze(-1)  # [B, L, 1]

    # KL( teacher || student ) or KL(student || teacher)
    # 常用：KL(teacher_probs || student_probs) with log_softmax(student)
    t_probs = F.softmax(teacher_logits / T, dim=-1)
    s_log_probs = F.log_softmax(student_logits / T, dim=-1)

    kl = F.kl_div(s_log_probs, t_probs, reduction="none")  # [B, L, V]
    kl = (kl * mask).sum() / mask.sum().clamp_min(1)

    # Hard CE
    ce = F.cross_entropy(
        student_logits.view(-1, student_logits.size(-1)),
        labels.view(-1),
        ignore_index=-100
    )

    return alpha * ce + (1 - alpha) * (T * T) * kl, ce, kl

def groundingdino_compute_loss(out, gt_boxes, gt_labels, pos_mask=None, neg_mask=None,
                 iou_threshold=0.2, margin=0.3):

    pred_boxes = out["boxes"]   # [B, Q, 4]
    scores = out["scores"]      # [B, Q] 或 [B, Q, C]
    cls_logits = out["cls_logits"] if "cls_logits" in out else None
    B, Q, _ = pred_boxes.shape

    all_loss = {"l1": 0., "iou": 0., "cls": 0., "ground": 0., "contrast": 0.}
    total_loss = 0.
    
    for b in range(B):
        gt_b = gt_boxes[b]
        label_b = gt_labels[b]
        pred_b = pred_boxes[b]             # [Q, 4]
        score_b = scores[b]                # [Q] 或 [Q, C]
        cls_logit = cls_logits[b] if cls_logits is not None else None  # [Q, C] 或 None

        # >>>>>>> 正確取出當前 batch 的 mask <<<<<<
        cur_pos_mask = pos_mask[b] if (pos_mask is not None and pos_mask.dim() == 2) else None
        cur_neg_mask = neg_mask[b] if (neg_mask is not None and neg_mask.dim() == 2) else None

        # --- 若未提供 mask，動態計算 ---
        if cur_pos_mask is None or cur_neg_mask is None:
            iou = box_iou(pred_b, gt_b) if gt_b.numel() > 0 else torch.zeros((Q, 1), device=pred_b.device)
            max_iou, gt_idx = iou.max(dim=1)
            cur_pos_mask = max_iou > iou_threshold
            cur_neg_mask = ~cur_pos_mask
        else:
            # 防止mask shape錯誤
            cur_pos_mask = cur_pos_mask.bool()
            cur_neg_mask = cur_neg_mask.bool()
            assert cur_pos_mask.shape[0] == Q, f"pos_mask shape mismatch: {cur_pos_mask.shape} vs {Q}"
            assert cur_neg_mask.shape[0] == Q, f"neg_mask shape mismatch: {cur_neg_mask.shape} vs {Q}"

        # --- L1 + IoU ---
        matched_gt = gt_b[gt_idx[cur_pos_mask]] if cur_pos_mask.any() else torch.zeros((0, 4), device=pred_b.device)
        l1 = F.l1_loss(pred_b[cur_pos_mask], matched_gt, reduction="mean") if matched_gt.numel() > 0 else 0.
        iou_loss = 1 - max_iou[cur_pos_mask].mean() if cur_pos_mask.any() else 0.

        # --- Objectness confidence ---
        if score_b.ndim == 2:
            obj_conf = score_b.softmax(dim=-1).max(dim=-1).values
        else:
            obj_conf = score_b

        if cur_pos_mask.any():
            ground_pos = F.binary_cross_entropy_with_logits(
                obj_conf[cur_pos_mask],
                torch.ones_like(obj_conf[cur_pos_mask])
            )
        else:
            print(f"[DEBUG] No positive matches. Max IoU: {max_iou.max().item():.3f}")
            ground_pos = torch.tensor(0.0, device=scores.device)

        if cur_neg_mask.any():
            ground_neg = F.binary_cross_entropy_with_logits(
                obj_conf[cur_neg_mask],
                torch.zeros_like(obj_conf[cur_neg_mask])
            )
        else:
            print(f"[DEBUG] No negative matches. Max IoU: {max_iou.max().item():.3f}")
            ground_neg = torch.tensor(0.0, device=scores.device)

        # 分類 loss
        # cls_loss = F.cross_entropy(cls_logit[cur_pos_mask], label_b)
        if cur_pos_mask.any():
            target_labels = label_b[gt_idx[cur_pos_mask]]       # 對應正樣本的 label
            pred_logits = cls_logit[cur_pos_mask]               # [num_pos, C]
            cls_loss = F.cross_entropy(pred_logits, target_labels, reduction="mean")
        else:
            cls_loss = torch.tensor(0.0, device=scores.device)

        ground_loss = ground_pos + ground_neg

        # --- Pairwise contrastive loss ---
        if cur_pos_mask.any() and cur_neg_mask.any():
            pos_scores = obj_conf[cur_pos_mask].unsqueeze(1)  # [N_pos, 1]
            neg_scores = obj_conf[cur_neg_mask].unsqueeze(0)  # [1, N_neg]
            # pairwise margin-based loss
            pairwise_diff = neg_scores - pos_scores + margin   # [N_pos, N_neg]
            contrast = F.relu(pairwise_diff).mean()
        else:
            contrast = torch.tensor(0.0, device=scores.device)
        
        # --- Final loss ---
        loss = l1 + iou_loss + ground_loss + 0.5 * contrast
        total_loss += loss

        all_loss["l1"] += float(l1)
        all_loss["iou"] += float(iou_loss)
        all_loss["ground"] += float(ground_loss)
        all_loss["cls"] += float(cls_loss)
        all_loss["contrast"] += float(contrast)

    for k in all_loss:
        all_loss[k] /= B
    all_loss["total"] = total_loss / B
    return all_loss

def hungarian_matcher(pred_boxes, gt_boxes):
    """
    pred_boxes: [Q, 4]
    gt_boxes:   [N, 4]
    return: matched indices
    """
    Q = pred_boxes.size(0)
    N = gt_boxes.size(0)

    if N == 0:
        return [], []

    # cost = L1 distance
    cost = torch.cdist(pred_boxes, gt_boxes, p=1)  # [Q, N]
    cost = cost.detach().cpu().numpy()

    row_ind, col_ind = linear_sum_assignment(cost)
    return row_ind, col_ind

def compute_rag_loss(images, s_txt_outs, retriever_index=None, retriever_meta=None, k=3):
    # Placeholder for RAG loss computation
    # In a real implementation, this would involve retrieving top-k relevant samples
    # and computing a loss based on their similarity to the current batch.

    rag_loss = torch.tensor(0.0)

    if retriever_index is not None:
        # Utilize teacher text embedding for retrieval
        q_emb = F.normalize(s_txt_outs, dim=-1).detach().numpy()  # [B, D]
        D, I = retriever_index.search(q_emb, k)

        # Fetch top-k teacher embeddings
        retrieved_feats = []
        for i in range(images.size(0)):
            retrieved_vecs = []
            for j in range(k):
                idx = I[i, j]
                feat = retriever_meta[idx]["teacher_emb"]
                retrieved_vecs.append(torch.tensor(feat, device=s_txt_outs.device))
            retrieved_feats.append(torch.stack(retrieved_vecs, dim=0))  # [k, D]
        retrieved_feats = torch.stack(retrieved_feats, dim=0)  # [B, k, D]

        # retrieved knowledge與 student text embedding 計算相似度
        rag_loss = 0
        if len(retrieved_feats) != 0:
            for i in range(retrieved_feats.shape[1]):  # k
                rag_loss += F.mse_loss(s_txt_outs, retrieved_feats[:, i, :])
            rag_loss /= retrieved_feats.shape[1]

    return rag_loss

def compute_contrastive_loss(image_feats, text_feats, temperature=0.07):
    """
    image_feats: [B, D]
    text_feats:  [B, D]
    """
    image_feats = F.normalize(image_feats, dim=-1)
    text_feats = F.normalize(text_feats, dim=-1)

    logits = torch.matmul(image_feats, text_feats.t()) / temperature  # [B, B]
    labels = torch.arange(image_feats.size(0), device=image_feats.device)

    loss_i2t = F.cross_entropy(logits, labels)
    loss_t2i = F.cross_entropy(logits.t(), labels)

    loss = (loss_i2t + loss_t2i) / 2
    return loss

def compute_dice_loss(pred_masks, gt_masks, eps=1e-6):
    """
    pred_masks: [Q, H, W] (sigmoid applied)
    gt_masks:   [Q, H, W]
    return: [Q, N] cost
    """
    Q = pred_masks.shape[0]
    N = gt_masks.shape[0]
    
    pred = pred_masks.flatten(1)    # [Q, HW]
    gt = gt_masks.flatten(1)        # [N, HW]

    # intersection: [Q, N]
    inter = torch.einsum("qh,nh->qn", pred, gt)
    union = pred.sum(1)[:, None] + gt.sum(1)[None, :]

    dice = (2 * inter + eps) / (union + eps)
    return 1 - dice

def mask_bce_cost(pred_masks, gt_masks):
    """
    pred_masks: [Q, H, W] (logits)
    gt_masks: [N, H, W]
    return: [Q, N]
    """
    Q = pred_masks.shape[0]
    N = gt_masks.shape[0]

    pred = pred[:, None, :]
    gt = gt[None, :, :]

    bce = F.binary_cross_entropy_with_logits(pred, gt, reduction="none").mean(-1)  # [Q, N]

    return bce

def dinov3_compute_loss(
    det_outs,
    gt_boxes_list,
    gt_labels_list,
    matcher,
    no_object_class_idx=None,
    lambda_bbox=5.0,
    lambda_iou=2.0,
    lambda_cls=1.0,
    eos_coef=1.0      
):
    """
    def_outs:
        pred_boxes: (B, N, 4) cxcywh (norm)
        pred_logits: (B, N, C) logits (C includes no-object)
    gt_boxes_list: list[Tensor(Mi, 4)]
    gt_labels_list: list[Tensor(Mi,)]
    """

    pred_boxes = det_outs["pred_boxes"]
    pred_logits = det_outs["pred_logits"]
    B, N, C = pred_logits.shape
    device = pred_logits.device

    # no-object class index
    if no_object_class_idx is None:
        no_object_class_idx = C - 1
    
    total_loss_bbox = torch.tensor(0.0, device=device)
    total_loss_iou = torch.tensor(0.0, device=device)
    total_loss_cls = torch.tensor(0.0, device=device)

    # class weighting: downweight no-object
    empty_weight = torch.ones(C, device=device)
    empty_weight[no_object_class_idx] = eos_coef

    for i in range(B):
        gt_boxes = gt_boxes_list[i]
        gt_labels = gt_labels_list[i]

        # matcher returns matched indices (can be empty if gt empty)
        idx_pred, idx_gt = matcher(pred_logits[i], pred_boxes[i], gt_labels, gt_boxes)
        # print("idx_pred, idx_gt:", idx_pred, idx_gt)

        # classification targets (default all no-object)
        target_classes = torch.full((N,), no_object_class_idx, dtype=torch.long, device=device)
        if idx_pred.numel() > 0:
            target_classes[idx_pred] = gt_labels[idx_gt]
        
        # print("pred_logits[", i, "], target_classes:", pred_logits[i], target_classes)
        loss_cls = F.cross_entropy(pred_logits[i], target_classes, weight=empty_weight)

        # bbox & iou loss only on matched pairs
        if idx_pred.numel() > 0:
            pb = pred_boxes[i, idx_pred]    # (K,4) cxcywh
            gb = gt_boxes[idx_gt]

            loss_bbox = F.l1_loss(pb, gb, reduction="mean")

            pb_xyxy = cxcywh_to_xyxy(pb)
            gb_xyxy = cxcywh_to_xyxy(gb)
            loss_iou = iou_loss(pb_xyxy, gb_xyxy, device)
        else:
            loss_bbox = torch.tensor(0.0, device=device)
            loss_iou = torch.tensor(0.0, device=device)
        
        total_loss_cls += loss_cls
        total_loss_bbox += loss_bbox
        total_loss_iou += loss_iou
    
    # average over batch
    total_loss_cls = total_loss_cls / B
    total_loss_bbox = total_loss_bbox / B
    total_loss_iou = total_loss_iou / B

    return (lambda_bbox * total_loss_bbox, lambda_iou * total_loss_iou, lambda_cls * total_loss_cls)

def iou_loss(boxes1, boxes2, device):
    # boxes: (K,4) xyxy
    if boxes1.numel() == 0:
        return torch.tensor(0.0, device=device)
    
    # IoU
    area1 = (boxes1[:,2]-boxes1[:,0]).clamp(min=0) * (boxes1[:,3]-boxes2[:,1]).clamp(min=0)
    area2 = (boxes2[:,2]-boxes2[:,0]).clamp(min=0) * (boxes2[:,3]-boxes2[:,1]).clamp(min=0)

    lt = torch.max(boxes1[:, None, :2], boxes2[:, :2])
    rb = torch.min(boxes1[:, None, 2:], boxes2[:, 2:])
    wh = (rb - lt).clamp(min=0)
    inter = wh[:,:,0] * wh[:,:,1]
    union = area1[:,None] + area2 - inter
    iou = inter / union.clamp(min=1e-6)

    # matched pairs -> diagonal after selecting same K
    # we'll call this with K matched and aligned (K,4) vs (K,4)
    # so compute per-pair IoU simply
    diag = iou.diag()
    return (1.0 - diag).mean()

def dinov3_compute_loss_llm(det_outs, gt_boxes, gt_labels, llm_type=False, s_txt_outs=None, pos_mask=None, neg_mask=None, region_feat=None, device='cpu', cfg=DINOv3Cfg()):

    loss_box = torch.tensor(0.0, device=device)
    loss_iou = torch.tensor(0.0, device=device)
    if gt_boxes is not None and gt_boxes.numel() > 0:
        pred_boxes = det_outs["pred_boxes"]
        # L1 loss
        loss_box = F.l1_loss(pred_boxes, gt_boxes, reduction="mean")
        # IoU loss
        inter = torch.min(pred_boxes[..., 2:], gt_boxes[..., 2:]) - torch.max(pred_boxes[..., :2], gt_boxes[..., :2])
        inter = inter.clamp(min=0)
        inter_area = inter[..., 0] * inter[..., 1]
        box_area = (pred_boxes[..., 2] - pred_boxes[..., 0]) * (pred_boxes[..., 3] - pred_boxes[..., 1])
        gt_area = (gt_boxes[..., 2] - gt_boxes[..., 0]) * (gt_boxes[..., 3] - gt_boxes[..., 1])
        union = box_area + gt_area - inter_area
        iou = (inter_area + 1e-6) / (union + 1e-6)
        loss_iou = 1 - iou.mean()

    loss_cls = torch.tensor(0.0, device=device)
    if gt_labels is not None and gt_labels.numel() > 0:
        cls_logits = det_outs["pred_logits"]
        valid_mask = (gt_labels >= 0) & (gt_labels < cfg.num_classes)
        if valid_mask.any():
            target = gt_labels[valid_mask]
            pred = cls_logits[valid_mask]
            loss_cls = F.cross_entropy(pred, target, reduction="mean")
    
    loss_region = torch.tensor(0.0, device=device)

    if llm_type == True:
        if gt_labels is not None and gt_labels.numel() > 0:
            # === region-text alignment ===
            sim_region = F.cosine_similarity(region_feat, s_txt_outs, dim=-1).mean()
            loss_region = 1 - sim_region  # maximize alignment

    return loss_box, loss_iou, loss_cls, loss_region

def build_retriever_index(enc_model, enc_tokenizer, dataloader, device):
    enc_model.eval()
    all_embeddings = []
    meta_info = []

    with torch.no_grad():
        for batch in dataloader:
            # 取得 batch output_text (list of str)
            texts = batch["output_text"]
            if isinstance(texts, str):  # 保險檢查
                texts = [texts]

            # Tokenize
            inputs = enc_tokenizer(
                texts,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=512
            ).to(device)

            # Forward
            outputs = enc_model(**inputs)
            t_txt_feats = outputs.last_hidden_state.mean(dim=1)  # [B, D]
            t_txt_feats = F.normalize(t_txt_feats, dim=-1)

            # 保險檢查長度
            B = t_txt_feats.shape[0]
            all_embeddings.append(t_txt_feats.cpu())

            # 只取前 B 筆，避免越界
            meta_info.extend([
                {
                    "prompt": texts[i],
                    "teacher_emb": t_txt_feats[i].cpu().numpy()
                }
                for i in range(B)
            ])

    # Concatenate
    all_embeddings = torch.cat(all_embeddings, dim=0)
    # dim = all_embeddings.shape[1]

    # Build FAISS index
    index = None
    # index = faiss.IndexFlatL2(dim)
    # index.add(all_embeddings.numpy())

    # print(f"[INIT] Built retriever index: dim={dim}, total={index.ntotal}")
    return index, meta_info
