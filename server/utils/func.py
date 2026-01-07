import torch
import torchvision.transforms as T
import torch.nn.functional as F

from PIL import Image
from torchvision.ops import nms
from utils.config import DINOv3Cfg
import faiss
from google.cloud import storage
from scipy.optimize import linear_sum_assignment

import json
import os
import numpy as np
import pandas as pd
import hashlib
import cv2

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

def download_from_gcs(bucket_name, blob_path, local_path):
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_path)

    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    blob.download_to_filename(local_path)
    print(f"[GCS] Downloaded {blob_path} → {local_path}")

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

def _gcs_download_to_cache(gs_uri: str, cache_dir: str = "/tmp/gcs_cache") -> str:
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
    Docstring for match_predictions
    
    :param pred_boxes: Description
    :param pred_labels: Description
    :param pred_scores: Description
    :param gt_boxes: Description
    :param gt_labels: Description
    :param iou_threshold: Description
    :param score_threshold: Description
    """
    keep = pred_scores >= score_threshold
    pred_boxes = pred_boxes[keep]
    pred_labels = pred_labels[keep]

    # boxes: [N,4] xyxy

    if isinstance(gt_boxes, (list, tuple)):
        gt_boxes = gt_boxes[0]
    if isinstance(gt_labels, (list, tuple)):
        gt_labels = gt_labels[0]

    # ---- edge cases ----
    if pred_boxes.numel() == 0 and gt_boxes.numel() == 0:
        return [], [], []

    if pred_boxes.numel() == 0:
        return [], [], list(range(len(gt_boxes)))

    if gt_boxes.numel() == 0:
        return [], list(range(len(pred_boxes))), []
    
    pred_boxes = cxcywh_to_xyxy(pred_boxes)
    gt_boxes   = cxcywh_to_xyxy(gt_boxes)

    ious = box_iou(pred_boxes, gt_boxes)

    matched_gt = set()
    tp, fp = [], []

    for i in range(len(pred_boxes)):
        max_iou, j = ious[i].max(dim=0)

        if max_iou >= iou_threshold and j.item() not in matched_gt:
            tp.append((i, j))
            matched_gt.add(j.item())
        else:
            fp.append(i)

    fn = [j for j in range(len(gt_boxes)) if j not in matched_gt]
    return tp, fp, fn

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
    # boxes2 could be list[tensor] when batch_size=1
    if isinstance(boxes2, (list, tuple)):
        assert len(boxes2) == 1, f"Expected batch_size=1, got {len(boxes2)}"
        boxes2 = boxes2[0]

    area1 = (boxes1[:, 2]-boxes1[:, 0]) * (boxes1[:, 3]-boxes1[:, 1])
    area2 = (boxes2[:, 2]-boxes2[:, 0]) * (boxes2[:, 3]-boxes2[:, 1])

    lt = torch.max(boxes1[:, None, :2], boxes2[:, :2])
    rb = torch.min(boxes1[:, None, 2:], boxes2[:, 2:])
    wh = (rb - lt).clamp(min=0)

    inter = wh[:, :, 0] * wh[:, :, 1]
    union = area1[:, None] + area2 - inter
    return inter / union

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
    gt_boxes,
    gt_labels,
    device="cpu",
    cfg=DINOv3Cfg()
):
    pred_boxes = det_outs["pred_boxes"]     # [B, Q, 4]
    pred_logits = det_outs["pred_logits"]   # [B, Q, C]

    loss_box = torch.tensor(0.0, device=device)
    loss_iou = torch.tensor(0.0, device=device)
    loss_cls = torch.tensor(0.0, device=device)

    B = pred_boxes.size(0)

    for b in range(B):
        pb = pred_boxes[b]
        gb = gt_boxes[b]
        gl = gt_labels[b]

        if gb.numel() == 0:
            continue

        idx_p, idx_g = hungarian_matcher(pb, gb)

        matched_pb = pb[idx_p]
        matched_gb = gb[idx_g]
        matched_gl = gl[idx_g]

        # L1 bbox loss
        loss_box += F.l1_loss(matched_pb, matched_gb, reduction="mean")

        # IoU loss (cxcywh assumed)
        iou = box_iou(matched_pb, matched_gb)
        loss_iou += 1 - iou.diag().mean()

        # classification loss
        loss_cls += F.cross_entropy(
            pred_logits[b, idx_p],
            matched_gl,
            reduction="mean"
        )

    num = max(B, 1)
    return loss_box / num, loss_iou / num, loss_cls / num

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
    dim = all_embeddings.shape[1]

    # Build FAISS index
    index = faiss.IndexFlatL2(dim)
    index.add(all_embeddings.numpy())

    print(f"[INIT] Built retriever index: dim={dim}, total={index.ntotal}")
    return index, meta_info
