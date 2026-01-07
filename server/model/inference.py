import torch
import cv2
import matplotlib.pyplot as plt
from torchvision.ops import box_convert
import cv2
import os
import numpy as np
from PIL import Image
from transformers import AutoTokenizer
from torchvision import transforms
from tqdm import tqdm
from torch.nn import functional as F
from utils.func import compute_precision_recall, decode_boxes, match_predictions, postprocess_boxes, update_confusion_matrix, visualize_result

def grounding_inference_single(model, image_path, prompt, checkpoint_path, device="cuda",
                               box_thresh=0.3, text_thresh=0.25, save_path="results"):
    """
    單張圖片 + grounding 文字提示的推論模板
    ===================================================
    Args:
        model: 已定義好的 GroundingDINO 模型 (需與訓練時相同架構)
        image_path: 圖片路徑
        prompt: Grounding prompt，例如 "find oral lesion" / "detect ulcer area"
        checkpoint_path: 模型權重檔 .pth
        device: 'cuda' or 'cpu'
        box_thresh: 最低框信心閾值
        text_thresh: Grounding語意分數閾值
        save_path: 輸出資料夾

    Output:
        - 顯示與儲存畫出框的圖片
        - 終端印出每個偵測框與分數
    ===================================================
    """

    # 準備輸出資料夾
    os.makedirs(save_path, exist_ok=True)

    # 載入模型權重
    print(f"Loading checkpoint from {checkpoint_path} ...")
    model.load_state_dict(torch.load(checkpoint_path, map_location=device))
    model.to(device)
    model.eval()

    # 載入圖片
    img = Image.open(image_path).convert("RGB")
    img_np = np.array(img)
    H, W = img_np.shape[:2]

    # 若你的模型需要相同的 transform
    preprocess = transforms.Compose([
        transforms.Resize((384, 384)),
        transforms.ToTensor(),
    ])
    img_tensor = preprocess(img).unsqueeze(0).to(device)

    # 準備文字 prompt
    tokenizer = AutoTokenizer.from_pretrained("bert-base-uncased")
    encoding = tokenizer(prompt, return_tensors="pt", padding=True, truncation=True, max_length=32)
    input_ids = encoding["input_ids"].to(device)
    attn_mask = encoding["attention_mask"].to(device)

    # 模型前向推論
    with torch.no_grad():
        outputs = model(img_tensor, input_ids, attn_mask)

    # outputs 應包含：
    # "grounding": [B,Q]
    # "cls_logits": [B,Q,C]
    # "boxes": [B,Q,4] (cx,cy,w,h normalized)
    grounding_scores = outputs["grounding"].sigmoid()[0]  # [Q]
    cls_logits = outputs["cls_logits"].softmax(-1)[0]     # [Q,C]
    boxes = outputs["boxes"][0]                           # [Q,4]

    # 整合分數 (grounding × cls softmax)
    cls_scores, cls_labels = cls_logits.max(dim=-1)
    final_scores = grounding_scores * cls_scores

    # 篩選高分數
    keep = final_scores > box_thresh
    boxes = boxes[keep].cpu()
    cls_labels = cls_labels[keep].cpu()
    final_scores = final_scores[keep].cpu()

    # 若沒偵測到
    if boxes.numel() == 0:
        print(f"No detection above threshold {box_thresh}.")
        return

    # 將 bbox 座標反歸一化到原圖大小
    boxes_xywh = boxes.clone()
    boxes_xywh[:, 0] *= W
    boxes_xywh[:, 1] *= H
    boxes_xywh[:, 2] *= W
    boxes_xywh[:, 3] *= H
    boxes_xyxy = box_convert(boxes_xywh, in_fmt="cxcywh", out_fmt="xyxy")

    # 繪製結果
    img_vis = img_np.copy()
    for i, box in enumerate(boxes_xyxy):
        x1, y1, x2, y2 = map(int, box.tolist())
        conf_val = float(final_scores[i].item())
        cls_val = int(cls_labels[i].item())

        color = (0, 255, 0)
        cv2.rectangle(img_vis, (x1, y1), (x2, y2), color, 2)
        cv2.putText(img_vis, f"cls:{cls_val} {conf_val:.2f}",
                    (x1, max(10, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX,
                    0.5, (255, 255, 255), 1)

        print(f"Detected box {i}: cls={cls_val}, score={conf_val:.3f}, box={x1, y1, x2, y2}")

    # 儲存與顯示結果
    out_path = os.path.join(save_path, os.path.basename(image_path))
    cv2.imwrite(out_path, cv2.cvtColor(img_vis, cv2.COLOR_RGB2BGR))
    print(f"Saved result to {out_path}")

    plt.imshow(img_vis)
    plt.title(f"Prompt: {prompt}")
    plt.axis("off")
    plt.show()

def grounddino_inference(model, dataloader, checkpoint_path, device="cpu", score_thresh=0.4, save_vis=True):
    """
    Inference phase for GroundingDINO model.
    """
    # 載入訓練好的模型權重
    print(f"Loading checkpoint: {checkpoint_path}")
    model.load_state_dict(torch.load(checkpoint_path, map_location=device))
    model.to(device)
    model.eval()

    os.makedirs("results", exist_ok=True)

    with torch.no_grad():
        for i, batch in enumerate(dataloader):
            images = batch["image"].to(device)                # [B,3,H,W]
            input_ids = batch["input_ids"].to(device)
            attn_mask = batch["attn_mask"].to(device)

            # 前向推論
            outputs = model(images, input_ids, attn_mask)

            # === 模型輸出 ===
            # outputs = {"grounding": [B,Q], "cls_logits": [B,Q,C], "boxes": [B,Q,4]}
            scores = outputs["grounding"].sigmoid()           # grounding confidence
            boxes = outputs["boxes"]                          # normalized cxcywh
            cls_logits = outputs["cls_logits"].softmax(-1)    # [B,Q,C]
            cls_scores, cls_labels = cls_logits.max(dim=-1)   # [B,Q]

            for b in range(images.size(0)):
                img = images[b].permute(1, 2, 0).cpu().numpy()
                img = (img - img.min()) / (img.max() - img.min() + 1e-8)
                img = (img * 255).astype("uint8")

                img_h, img_w = img.shape[:2]

                # === 篩選高分數樣本 ===
                conf = scores[b] * cls_scores[b]
                keep = conf > score_thresh
                boxes_xywh = boxes[b][keep].cpu()
                labels = cls_labels[b][keep].cpu()
                conf_scores = conf[keep].cpu()

                if boxes_xywh.numel() == 0:
                    print(f"[{i}] No detection above threshold ({score_thresh})")
                    continue

                # === 座標反歸一化 & 轉換 ===
                boxes_xywh[:, 0] *= img_w
                boxes_xywh[:, 1] *= img_h
                boxes_xywh[:, 2] *= img_w
                boxes_xywh[:, 3] *= img_h
                boxes_xyxy = box_convert(boxes_xywh, in_fmt="cxcywh", out_fmt="xyxy")

                # === 視覺化繪製 ===
                for j, box in enumerate(boxes_xyxy):
                    x1, y1, x2, y2 = map(int, box.tolist())
                    label = int(labels[j].item())
                    conf_val = float(conf_scores[j].item())
                    color = (0, 255, 0)
                    cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
                    cv2.putText(img, f"Cls:{label} {conf_val:.2f}", 
                                (x1, max(10, y1-5)), cv2.FONT_HERSHEY_SIMPLEX, 
                                0.5, (255,255,255), 1)

                # === 儲存 / 顯示結果 ===
                out_path = f"results/infer_{i}.jpg"
                cv2.imwrite(out_path, img[..., ::-1])
                print(f"[{i}] Saved: {out_path}")

                if not save_vis:
                    plt.imshow(img[..., ::-1])
                    plt.title(f"Inference {i}")
                    plt.axis("off")
                    plt.show()

def dinov3_inference_single(model, image_path, prompt, device="cpu", score_thresh=0.4):
    model.eval()
    model.to(device)

    # === Preprocess ===
    tfm = transforms.Compose([
        transforms.Resize((model.cfg.img_size, model.cfg.img_size)),
        transforms.ToTensor(),
        transforms.Normalize([0.485,0.456,0.406], [0.229,0.224,0.225]),
    ])

    # Load image
    img = Image.open(image_path).convert("RGB")
    img_tensor = tfm(img).unsqueeze(0).to(device)  # [1, 3, H, W]

    # Tokenize text
    tokenizer = AutoTokenizer.from_pretrained(model.cfg.text_model_name)
    enc = tokenizer(prompt, return_tensors="pt", padding=True, truncation=True, max_length=32)
    input_ids = enc["input_ids"].to(device)
    attn_mask = enc["attention_mask"].to(device)

    # === Forward (student or teacher branch均可) ===
    img_feat = model.img_enc(img_tensor)               # [1, img_dim]
    txt_feat = model.text_enc(input_ids, attn_mask)    # [1, txt_dim]

    # 如果模型包含 detection head
    if hasattr(model, "det_head"):
        det_out = model.det_head(
            img_feat.unsqueeze(1), txt_feat.unsqueeze(1)
        )  # 模擬多 query
        boxes = det_out["boxes"]                   # [B, Q, 4]
        grounding = det_out["grounding"].sigmoid() # [B, Q]
        cls_logits = det_out["cls_logits"].softmax(-1)
        cls_scores, cls_labels = cls_logits.max(-1)
    else:
        boxes, grounding, cls_scores, cls_labels = None, None, None, None

    # ===== Draw detection boxes =====
    if boxes is not None:
        img_h, img_w = img.shape[:2]
        boxes_xywh = boxes.cpu()
        boxes_xywh[:, 0] *= img_w
        boxes_xywh[:, 1] *= img_h
        boxes_xywh[:, 2] *= img_w
        boxes_xywh[:, 3] *= img_h
        boxes_xyxy = box_convert(boxes_xywh, "cxcywh", "xyxy")

        conf = (grounding.cpu() * cls_scores.cpu()).numpy()
        labels = cls_labels.cpu().numpy()

        for j, box in enumerate(boxes_xyxy):
            if conf[j] < score_thresh:
                continue
            x1, y1, x2, y2 = map(int, box.tolist())
            cls_id = int(labels[j])
            cv2.rectangle(img, (x1, y1), (x2, y2), (0,255,0), 2)
            cv2.putText(
                img, f"Cls {cls_id} ({conf[j]:.2f})",
                (x1, max(10, y1 - 5)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255,255,255), 1
            )

    img_proj = model.img_head(img_feat)                # [1, out_dim]
    txt_proj = model.text_head(txt_feat)               # [1, out_dim]

    # === Normalize & compute similarity ===
    img_proj = F.normalize(img_proj, dim=-1)
    txt_proj = F.normalize(txt_proj, dim=-1)
    sim = (img_proj * txt_proj).sum(dim=-1)            # cosine similarity scalar

    score = sim.item()
    print(f"Similarity Score = {score:.4f}")

    # === (Optional) Threshold-based match ===
    matched = score > 0.5  # 可調
    print("→ Match" if matched else "→ Not Match")

    out_path = f"results/{image_path.split('/')[-1].split('.')[0]}_infer.jpg"
    cv2.imwrite(out_path, img)
    print(f"→ Saved {out_path}")
    
    return {
        "image_path": image_path,
        "prompt": prompt,
        "score": score,
        "matched": matched
    }

@torch.no_grad()
def dinov3_inference_llm(
    model,
    student_llm,
    tokenizer,
    adapter,
    student_ctx_proj,
    data_loader,
    device,
    max_new_tokens: int = 128,
    temperature: float = 0.7,
    top_p: float = 0.9,
    retriever_index=None,
    retriever_meta=None,
    verbose: bool = True
):
    """
    Student-only inference pipeline.

    Args:
        model: Trained OralDINOv3 model
        student_llm: Distilled student LLM (trainable during training, eval here)
        tokenizer: Tokenizer shared with training
        adapter: DINOv3ToLLMAdapter
        student_ctx_proj: Projection to student LLM hidden size
        data_loader: DataLoader yielding OralDataset batches
        device: cuda / cpu
        max_new_tokens: LLM generation length
        temperature, top_p: sampling params
        retriever_index: (optional) FAISS index for RAG
        retriever_meta: (optional) metadata for retriever
        verbose: print outputs

    Returns:
        results: List[dict]
    """

    model.eval()
    student_llm.eval()

    results = []

    for batch in tqdm(data_loader, desc="[Inference] Student-only"):

        images = batch["image"].to(device)

        # ----------------------------
        # Build prompts
        # ----------------------------
        prompts = [
            "[Patient Statement] " + "".join(s) +
            " [Doctor's Note] " + "".join(d) +
            "\n[Generate Pathology Report]:"
            for s, d in zip(batch["patient_statement"], batch["doctor_note"])
        ]

        llm_inputs = tokenizer(
            prompts,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=512
        ).to(device)

        # ----------------------------
        # Vision + Text features
        # ----------------------------
        img_feat = model.img_enc(images)
        txt_feat = model.text_enc(
            llm_inputs["input_ids"],
            llm_inputs["attention_mask"]
        )

        multi_feat = torch.cat([img_feat, txt_feat], dim=-1)

        # ----------------------------
        # Adapter → Student context
        # ----------------------------
        ctx = adapter(multi_feat)
        ctx = student_ctx_proj(ctx)

        # ----------------------------
        # (Optional) Retriever RAG
        # ----------------------------
        if retriever_index is not None:
            # project text embedding for retriever
            s_txt_proj = model.project_for_retriever(txt_feat)

            retrieved = retrieve_topk(
                s_txt_proj,
                retriever_index,
                retriever_meta,
                k=3
            )

            # append retrieved cases to prompt
            augmented_prompts = []
            for p, r in zip(prompts, retrieved):
                aug = (
                    p +
                    "\n[Similar Cases]\n" +
                    "\n".join(r)
                )
                augmented_prompts.append(aug)

            llm_inputs = tokenizer(
                augmented_prompts,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=512
            ).to(device)

        # ----------------------------
        # Inject context token
        # ----------------------------
        input_embeds = student_llm.get_input_embeddings()(
            llm_inputs["input_ids"]
        )
        input_embeds = torch.cat(
            [0.5 * ctx.unsqueeze(1), input_embeds],
            dim=1
        )
        attn_mask = F.pad(
            llm_inputs["attention_mask"],
            (1, 0),
            value=1
        )

        # ----------------------------
        # Generate
        # ----------------------------
        gen_ids = student_llm.generate(
            inputs_embeds=input_embeds,
            attention_mask=attn_mask,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
            top_p=top_p,
            do_sample=True
        )

        outputs = tokenizer.batch_decode(
            gen_ids,
            skip_special_tokens=True
        )

        # ----------------------------
        # Collect results
        # ----------------------------
        for i in range(len(outputs)):
            result = {
                "image_id": batch.get("image_name", [None])[i],
                "patient_statement": batch["patient_statement"][i],
                "doctor_note": batch["doctor_note"][i],
                "generated_report": outputs[i]
            }
            results.append(result)

            if verbose:
                print("----")
                print("Generated Report:")
                print(outputs[i])

    return results

@torch.no_grad()
def dinov3_inference_seg(
    model,
    data_loader,
    device,
    checkpoint_path=None,
    color_label_map=None,
    output_path="results",
    score_thresh: float = 0.3,
    verbose: bool = True,
    num_classes: int = 3,
    save_vis: bool = True
):
    
    # ======================
    # Load trained weights
    # ======================
    ckpt = os.path.join(checkpoint_path, "dinov3_seg_best.pth")
    print(f"Loading checkpoint: {ckpt}")
    model.to(device)
    model.eval()

    os.makedirs(output_path, exist_ok=True)

    results = []

    if checkpoint_path is not None:
        state = torch.load(checkpoint_path, map_location=device)
        model.load_state_dict(state)
        if verbose:
            print(f"[INFO] Loaded checkpoint: {checkpoint_path}")

    for batch in tqdm(data_loader, desc="[Inference][Seg]"):
        images = batch["image"].to(device)           # [B, 3, H, W]
        image_names = batch.get("image_name", [None] * images.size(0))

        # ===== Forward =====
        outputs = model.forward_inference(images)
        mask_logits = outputs["mask_outs"]            # [B, Q, 1, Hm, Wm] or [B, 1, Hm, Wm]

        # ===== Sigmoid =====
        probs = torch.sigmoid(mask_logits)

        B = probs.size(0)

        for i in range(B):
            pm = probs[i]  # [Q, 1, Hm, Wm] or [1, Hm, Wm]

            # ---- handle query dimension ----
            if pm.dim() == 4:  # [Q, 1, Hm, Wm]
                pm = pm.squeeze(1)                   # [Q, Hm, Wm]
                pm, _ = pm.max(dim=0)                # merge queries → [Hm, Wm]

            elif pm.dim() == 3:                       # [1, Hm, Wm]
                pm = pm.squeeze(0)

            # ---- threshold ----
            binary_mask = (pm > score_thresh).float().cpu().numpy()

            # ---- resize to image size ----
            H, W = images.shape[-2:]
            binary_mask = cv2.resize(
                binary_mask,
                (W, H),
                interpolation=cv2.INTER_NEAREST
            )

            result = {
                "image_id": image_names[i],
                "mask": binary_mask
            }
            results.append(result)

            # ===== Visualization =====
            if save_vis and image_names[i] is not None:
                img = images[i].permute(1, 2, 0).cpu().numpy()
                img = (img - img.min()) / (img.max() - img.min() + 1e-6)
                img = (img * 255).astype(np.uint8)

                overlay = img.copy()
                overlay[binary_mask > 0] = (
                    overlay[binary_mask > 0] * 0.5 + np.array([255, 0, 0]) * 0.5
                )

                out_path = os.path.join(
                    output_path,
                    f"{os.path.splitext(image_names[i])[0]}_mask.png"
                )
                cv2.imwrite(out_path, overlay)

                if verbose:
                    print(f"[Saved] {out_path}")

    return results

@torch.no_grad()
def dinov3_inference_bbox(
    model,
    data_loader,
    device,
    color_label_map=None,
    output_path="results",
    score_thresh: float = 0.3,
    verbose: bool = True,
    num_classes: int = 3,
    save_vis: bool = True
):
    """
    Bounding-box-only inference pipeline.

    Args:
        model: Trained DINOv3 detection model
        data_loader: DataLoader yielding batches with "image"
        device: cuda / cpu
        score_thresh: confidence threshold
        verbose: print predictions

    Returns:
        results: List[dict]
    """

    all_results = []

    for batch in tqdm(data_loader, desc="[Inference] BBox-only"):

        images = batch["image"].to(device)
        widths = batch["width"]
        heights = batch["height"]

        # ===============================
        # Forward (student only)
        # ===============================
        outputs = model.forward_inference(images)

        pred_boxes = outputs["pred_boxes"]
        pred_logits = outputs["pred_logits"]

        scores = torch.softmax(pred_logits, dim=-1)
        max_scores, pred_labels = scores.max(-1)

        B = images.size(0)

        for i in range(B):
            keep = max_scores[i] > score_thresh

            boxes_i = pred_boxes[i][keep]
            scores_i = max_scores[i][keep]
            labels_i = pred_labels[i][keep]

            post_boxes, post_scores, post_labels = postprocess_boxes(
                boxes_i,
                scores_i,
                labels_i
            )

            result = {
                "image_id": batch.get("image_name", [None])[i],
                "boxes": post_boxes.cpu(),     # cxcywh (normalized)
                "scores": post_scores.cpu(),
                "labels": post_labels.cpu()
            }

            if save_vis:
                pred = {
                    "boxes": decode_boxes(boxes_i, widths[i], heights[i], fmt="cxcywh"),
                    "scores": scores_i,
                    "labels": labels_i
                }
                gt = {
                    "boxes": decode_boxes(batch["boxes"][i], widths[i], heights[i], fmt="cxcywh"),
                    "labels": batch["labels"][i]
                }
                visualize_result(images[i], widths[i], heights[i], pred, gt, f"{output_path}/{batch['image_name'][i]}", color_label_map)

            all_results.append(result)

            if verbose:
                print("----")
                print(f"Image: {result['image_id']}")
                print(f"Detections: {len(post_boxes)}")

    cm = np.zeros((num_classes+1, num_classes+1), dtype=int)
    precisions, recalls = [], []

    for batch, pred in zip(data_loader, all_results):
        gt = {
            "boxes": batch["boxes"],
            "labels": batch["labels"]
        }

        tp, fp, fn = match_predictions(
            pred["boxes"], pred["labels"], pred["scores"],
            gt["boxes"], gt["labels"]
        )

        p, r = compute_precision_recall(tp, fp, fn)
        precisions.append(p)
        recalls.append(r)

        update_confusion_matrix(
            cm, tp, fp, fn,
            pred["labels"], gt["labels"], num_classes
        )

    print("Precision:", sum(precisions)/len(precisions))
    print("Recall:", sum(recalls)/len(recalls))
    print("Confusion Matrix:\n", cm)

    return all_results
