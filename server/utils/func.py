import torch
import torch.nn.functional as F
from PIL import Image
import torchvision.transforms as T
from utils.config import DINOv3Cfg
from tqdm import tqdm
import numpy as np
import faiss
from google.cloud import storage
import json
import os
import pandas as pd
import hashlib

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

def preprocess(img_path):
    img = Image.open(img_path).convert("RGB")
    tf = T.Compose([
        T.ToTensor(),
        T.Resize(),
        T.Normalize([0.485,0.456,0.406],[0.228,0.224,0.225])
    ])
    return tf(img).unsqueeze(0), img.size

'''
def cxcywh_to_xyxy(b):
    cx, cy, w, h = b
    return [cx - w/2, cy - h/2, cx + w/2, cy + h/2]
'''

def cxcywh_to_xyxy(b):
    # b: [N, 4] or [*, 4]
    x_c, y_c, w, h = b.unbind(-1)  # ✅ 對最後一個維度做拆分
    x1 = x_c - 0.5 * w
    y1 = y_c - 0.5 * h
    x2 = x_c + 0.5 * w
    y2 = y_c + 0.5 * h
    return torch.stack([x1, y1, x2, y2], dim=-1)

'''
def box_iou(box1, box2):
    """Compute pairwise IoU between two sets of boxes (cxcywh)."""
    print("box1:", box1)
    print("box2:", box2)

    box1_xyxy = cxcywh_to_xyxy(box1)
    box2_xyxy = cxcywh_to_xyxy(box2)
    area1 = (box1_xyxy[:,2]-box1_xyxy[:,0])*(box1_xyxy[:,3]-box1_xyxy[:,1])
    area2 = (box2_xyxy[:,2]-box2_xyxy[:,0])*(box2_xyxy[:,3]-box2_xyxy[:,1])

    inter_x1 = torch.max(box1_xyxy[:, None, 0], box2_xyxy[:, 0])
    inter_y1 = torch.max(box1_xyxy[:, None, 1], box2_xyxy[:, 1])
    inter_x2 = torch.min(box1_xyxy[:, None, 2], box2_xyxy[:, 2])
    inter_y2 = torch.min(box1_xyxy[:, None, 3], box2_xyxy[:, 3])

    inter = (inter_x2 - inter_x1).clamp(min=0) * (inter_y2 - inter_y1).clamp(min=0)
    union = area1[:, None] + area2 - inter
    return inter / union.clamp(min=1e-6)
'''

def box_iou(box1, box2):
    """
    box1: [N, 4] (cxcywh)
    box2: [M, 4] (cxcywh)
    return: [N, M] IoU matrix
    """
    box1_xyxy = cxcywh_to_xyxy(box1)
    box2_xyxy = cxcywh_to_xyxy(box2)

    area1 = (box1_xyxy[:, 2] - box1_xyxy[:, 0]) * (box1_xyxy[:, 3] - box1_xyxy[:, 1])
    area2 = (box2_xyxy[:, 2] - box2_xyxy[:, 0]) * (box2_xyxy[:, 3] - box2_xyxy[:, 1])

    lt = torch.max(box1_xyxy[:, None, :2], box2_xyxy[:, :2])  # [N,M,2]
    rb = torch.min(box1_xyxy[:, None, 2:], box2_xyxy[:, 2:])  # [N,M,2]
    wh = (rb - lt).clamp(min=0)
    inter = wh[:, :, 0] * wh[:, :, 1]
    union = area1[:, None] + area2 - inter
    return inter / union.clamp(min=1e-6)

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

def dinov3_compute_loss(outputs, gt_boxes, gt_labels, pos_mask=None, neg_mask=None, device='cpu', cfg=DINOv3Cfg()):
    s_img_outs, s_txt_outs, _, _, _, det_outs = outputs
    B = s_img_outs.shape[0]

    loss_box = torch.tensor(0.0, device=device)
    loss_iou = torch.tensor(0.0, device=device)
    if gt_boxes is not None and gt_boxes.numel() > 0:
        # 此處假設你有 model 預測 box (若無則略過)
        # dummy prediction placeholder: [B, N_gt, 4]
        # 可替換成 model.outputs["boxes"]
        pred_boxes = torch.zeros_like(gt_boxes, device=device)

        # L1 loss
        loss_box = F.l1_loss(pred_boxes, gt_boxes, reduction="mean")

        # IoU loss (GIoU / DIoU 可自行加)
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
        # dummy logits (假設 model 有 cls_logits)
        # 你可以替換成 model.outputs["cls_logits"]
        cls_logits = torch.zeros(B, gt_labels.shape[1], cfg.num_classes, device=device)
        # 取有效樣本
        valid_mask = (gt_labels >= 0) & (gt_labels < cfg.num_classes)
        if valid_mask.any():
            target = gt_labels[valid_mask]
            pred = cls_logits[valid_mask]
            loss_cls = F.cross_entropy(pred, target, reduction="mean")
    
    loss_region = det_outs["loss_region"]
    '''
    loss_region = torch.tensor(0.0, device=device)

    if gt_labels is not None and gt_labels.numel() > 0:
        # === region-text alignment ===
        sim_region = F.cosine_similarity(region_feat, s_txt_outs, dim=-1).mean()
        loss_region = 1 - sim_region  # maximize alignment
    '''

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
