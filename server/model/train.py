import os
import torch
import torch.nn as nn
import torch.nn.functional as F
from tqdm import tqdm
import mlflow
from sklearn.metrics import (
    confusion_matrix,
    multilabel_confusion_matrix,
    roc_curve,
    auc,
    roc_auc_score,
    precision_score,
    recall_score,
    accuracy_score
)
from utils.func import groundingdino_compute_loss, dinov3_compute_loss, \
                       dinov3_compute_loss_llm, compute_rag_loss, distill_loss, \
                       cxcywh_to_xyxy, box_iou, \
                       plot_roc_pr_multi_class

tqdm_disable = bool(os.environ.get("VERTEX_TQDM_DISABLE", "1"))

def grounddino_train_val(
    model, 
    train_loader, 
    val_loader, 
    optimizer, 
    num_epochs, 
    device, 
    output_dir="checkpoints"
):
    model.train()
    best_val_loss = float("inf")
    
    for epoch in range(num_epochs):
        running_loss = 0.0
        
        for batch in tqdm(train_loader, desc=f"Epoch {epoch+1}/{num_epochs}", disable=tqdm_disable):
            images = batch["image"].to(device)
            input_ids = batch["input_ids"].to(device)
            attn_mask = batch["attn_mask"].to(device)
            boxes = [b.to(device) for b in batch["boxes"]]
            labels = [b.to(device) for b in batch["labels"]]
            neg_mask = batch["neg_mask"].to(device)
            
            # === 前向 ===
            outputs = model(images, input_ids, attn_mask)
            
            # === 組成 gt tensor (補成固定長度或 list 傳入 compute_loss) ===
            # compute_loss 內部會判斷空 gt
            # 修正版：負樣本自動補零
            fixed_boxes = []
            for b in boxes:
                if b.numel() == 0:
                    fixed_boxes.append(torch.zeros((1, 4), device=b.device))  # 假的空框
                else:
                    fixed_boxes.append(b)

            gt_boxes = torch.nn.utils.rnn.pad_sequence(fixed_boxes, batch_first=True, padding_value=0.)
            
            fixed_labels = []
            for l in labels:
                if l.numel() == 0:
                    fixed_labels.append(torch.zeros((1,), device=l.device, dtype=torch.long))
                else:
                    fixed_labels.append(l)

            gt_labels = torch.nn.utils.rnn.pad_sequence(fixed_labels, batch_first=True, padding_value=0)
            
            # === 計算 loss ===
            loss_dict = groundingdino_compute_loss(outputs, gt_boxes, gt_labels, pos_mask=None, neg_mask=neg_mask)

            print("Loss components:", loss_dict)

            loss = loss_dict["total"]

            # === 反向傳播 ===
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            running_loss += loss.item()
        
        avg_train_loss = running_loss / len(train_loader)
        print(f"[Train] Epoch {epoch+1} | Avg Loss: {avg_train_loss:.4f}")

        if val_loader is not None:
            model.eval()
            val_running_loss = 0.0
            val_loss_components = {"l1": 0., "iou": 0., "cls": 0., "ground": 0., "contrast": 0.}
            num_batches = 0

            with torch.no_grad():
                for batch in tqdm(val_loader, desc=f"[Val] Epoch {epoch+1}/{num_epochs}", disable=tqdm_disable):
                    images = batch["image"].to(device)
                    input_ids = batch["input_ids"].to(device)
                    attn_mask = batch["attn_mask"].to(device)
                    boxes = [b.to(device) for b in batch["boxes"]]
                    labels = [b.to(device) for b in batch["labels"]]
                    neg_mask = batch["neg_mask"].to(device)

                    # 前向
                    outputs = model(images, input_ids, attn_mask)

                    # 修正空 GT
                    fixed_boxes = []
                    for b in boxes:
                        if b.numel() == 0:
                            fixed_boxes.append(torch.zeros((1, 4), device=b.device))
                        else:
                            fixed_boxes.append(b)
                    gt_boxes = torch.nn.utils.rnn.pad_sequence(fixed_boxes, batch_first=True, padding_value=0.)

                    fixed_labels = []
                    for l in labels:
                        if l.numel() == 0:
                            fixed_labels.append(torch.zeros((1,), device=l.device, dtype=torch.long))
                        else:
                            fixed_labels.append(l)
                    gt_labels = torch.nn.utils.rnn.pad_sequence(fixed_labels, batch_first=True, padding_value=0)

                    # Loss
                    val_loss_dict = groundingdino_compute_loss(outputs, gt_boxes, gt_labels, pos_mask=None, neg_mask=neg_mask)
                    val_running_loss += val_loss_dict["total"].item()
                    num_batches += 1

                    for k in val_loss_components:
                        val_loss_components[k] += float(val_loss_dict.get(k, 0.))

            avg_val_loss = val_running_loss / num_batches
            for k in val_loss_components:
                val_loss_components[k] /= num_batches

            print(f"[Val] Epoch {epoch+1} | Total: {avg_val_loss:.4f} | " +
                  ", ".join([f"{k}: {v:.4f}" for k, v in val_loss_components.items()]))

            # 保存最佳模型
            if avg_val_loss < best_val_loss:
                best_val_loss = avg_val_loss
                torch.save(model.state_dict(), f"{output_dir}/groundingdino_best_model.pth")
                print(f"✅ Best model updated at epoch {epoch+1}")

        torch.save(model.state_dict(), f"{output_dir}/grounding_dino_oral_epoch{epoch+1}.pth")

def build_embeds(llm, ctx_token, llm_inputs):
    embeds = llm.get_input_embeddings()(llm_inputs["input_ids"])
    embeds = torch.cat([0.5 * ctx_token.unsqueeze(1), embeds], dim=1)
    attn = F.pad(llm_inputs["attention_mask"], (1, 0), value=1)
    return embeds.to(llm.dtype), attn

def dinov3_train_val_bbox(
    model,
    pyfunc_model,
    train_loader,
    val_loader,
    optimizer,
    num_epochs,
    device,
    output_dir="checkpoints",
    iou_threshold=0.5,
    score_threshold=0.3,
    matcher=None,
    num_classes=4,
    env_node="local",
    signature=None
):
    best_val_loss = float("inf")

    for epoch in range(num_epochs):
        model.train()
        total_train_loss = 0.0
        for i, batch in enumerate(tqdm(train_loader, desc=f"[Train] Epoch {epoch+1}/{num_epochs}")):
            images = batch["image"].to(device)
            # ✅ 保留「真的空 GT」
            gt_boxes_list  = [b.to(device) for b in batch["boxes"]]   # (Mi,4) 允許 Mi=0
            gt_labels_list = [l.to(device) for l in batch["labels"]]  # (Mi,)
            outputs = model.forward_train(batch, epoch, phase="train")
            loss_box, loss_iou, loss_cls = dinov3_compute_loss(
                outputs["det_outs"],
                gt_boxes_list,
                gt_labels_list,
                matcher=matcher
            )
            loss_total = loss_box + loss_cls + loss_iou
            optimizer.zero_grad()
            loss_total.backward()
            optimizer.step()
            model.update_teacher(epoch, num_epochs)
            total_train_loss += loss_total.item()
            print(f"[Train] Epoch {epoch+1} | Step {i+1} | box loss: {loss_box:.4f}, loss_cls: {loss_cls:.4f}, loss_iou: {loss_iou:.4f}")
        
        avg_train_loss = total_train_loss / len(train_loader)
        print(f"[Train] Epoch {epoch+1} | Avg Loss: {avg_train_loss:.4f}")
        mlflow.log_metric("train/loss", avg_train_loss, step=epoch)

        # ================= Validation =================
        if val_loader is None:
            continue
        model.eval()
        total_val_loss = 0.0
        all_y_true = []
        all_y_pred = []
        all_y_score = []
        with torch.no_grad():
            for i, batch in enumerate(val_loader):
                images = batch["image"].to(device)
                boxes = batch["boxes"]
                labels = batch["labels"]
                gt_boxes_list  = [b.to(device) for b in batch["boxes"]]
                gt_labels_list = [l.to(device) for l in batch["labels"]]
                outputs = model.forward_train(batch, epoch, phase="val")
                loss_box, loss_iou, loss_cls = dinov3_compute_loss(
                    outputs["det_outs"],
                    gt_boxes_list,
                    gt_labels_list,
                    matcher=matcher
                )
                
                total_val_loss += (
                    loss_box +
                    loss_cls +
                    loss_iou
                )
                pred_boxes = outputs["det_outs"]["pred_boxes"]      # [B,N,4] cxcywh norm
                pred_logits = outputs["det_outs"]["pred_logits"]    # [B,N,C]
                B = images.size(0)
                for bi in range(B):
                    gt_b = boxes[bi].to(device)      # (Mi,4) cxcywh
                    gt_l = labels[bi].to(device)     # (Mi,)
                    # GT multi-hot
                    gt_vec = torch.zeros(num_classes, dtype=torch.int)
                    if gt_l.numel() > 0:
                        gt_vec[gt_l.unique()] = 1
                    # ---- default pred multi-hot = all 0 ----
                    pred_vec = torch.zeros(num_classes, dtype=torch.int)
                    score_vec = torch.zeros(num_classes)
                    # no GT case: skip matching, all pred remain 0
                    if gt_b.numel() == 0:
                        all_y_true.append(gt_vec.numpy())
                        all_y_pred.append(pred_vec.numpy())
                        all_y_score.append(score_vec.numpy())
                        continue
                    # ---- predictions ----
                    scores = torch.softmax(pred_logits[bi], dim=-1)
                    max_scores, pred_l = scores.max(-1)
                    keep = max_scores > score_threshold
                    if keep.sum() == 0:
                        all_y_true.append(gt_vec.numpy())
                        all_y_pred.append(pred_vec.numpy())
                        all_y_score.append(score_vec.numpy())
                        continue
                    pb = pred_boxes[bi][keep]    # (K,4) cxcywh
                    pl = pred_l[keep]
                    ps = max_scores[keep]
                    # Hungarian matching (per image)
                    idx_pred, idx_gt = matcher(
                        pred_logits[bi][keep],
                        pb,
                        gt_l,
                        gt_b
                    )
                    if idx_pred.numel() > 0:
                        pb_xyxy = cxcywh_to_xyxy(pb[idx_pred])
                        gt_xyxy = cxcywh_to_xyxy(gt_b[idx_gt])
                        ious = box_iou(pb_xyxy, gt_xyxy).diag()
                        for j in range(len(idx_pred)):
                            if ious[j] >= iou_threshold:
                                c = pl[idx_pred[j]].item()
                                pred_vec[c] = 1
                                score_vec[c] = max(score_vec[c], ps[idx_pred[j]].item())
                    all_y_true.append(gt_vec.numpy())
                    all_y_pred.append(pred_vec.numpy())
                    all_y_score.append(score_vec.numpy())
                print(f"[Val] Epoch {epoch+1} | Step {i+1} | box loss: {loss_box:.4f}, loss_cls: {loss_cls:.4f}, loss_iou: {loss_iou:.4f}")

        avg_val_loss = total_val_loss / len(val_loader)
        print(f"[Val] Epoch {epoch+1} | Avg Loss: {avg_val_loss:.4f}")
        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            if env_node in ["develop", "staging", "production"]:
                mlflow.pyfunc.log_model(
                    artifact_path=f"dinov3_bbox_model",
                    python_model=pyfunc_model,
                    signature=signature,
                    registered_model_name="oral_dinov3_bbox"
                )
            else:
                torch.save(
                    model.state_dict(),
                    f"{output_dir}/dinov3_bbox_best_epoch{epoch}.pth"
                )
            print("✅ Best bbox-only model updated")
        
        mlflow.log_metric("val/loss", avg_val_loss, step=epoch)
        # ===============================
        #  Validation Metric computation
        # ===============================
        mcm = multilabel_confusion_matrix(all_y_true, all_y_pred)
        for c in range(num_classes):
            tn, fp, fn, tp = mcm[c].ravel()
            cm = {
                "TP": int(tp),
                "FP": int(fp),
                "FN": int(fn),
                "TN": int(tn)
            }
            sensitivity = tp / (tp + fn + 1e-8)
            specificity = tn / (tn + fp + 1e-8)
            precision = tp / (tp + fp + 1e-8)
            recall = sensitivity
            accuracy = (tp + tn) / (tp + tn + fp + fn)
            fpr = fp / (fp + tn + 1e-8)
            fnr = fn / (fn + tp + 1e-8)
            # fpr_curve, tpr_curve, _ = roc_curve(all_y_true, all_y_score)
            auc_c = roc_auc_score(
                [y[c] for y in all_y_true],
                [s[c] for s in all_y_score]
            )
        auc_macro = roc_auc_score(
            all_y_true,
            all_y_score,
            average="macro"
        )
        auc_micro = roc_auc_score(
            all_y_true,
            all_y_score,
            average="micro"
        )
        roc_aucs, aps = plot_roc_pr_multi_class(
            all_y_true,
            all_y_score,
            num_classes=num_classes,
            save_dir="outputs/curves"
        )
        for c, auc_c in roc_aucs.items():
            mlflow.log_metric(f"val/auc_class_{c}", auc_c)
        for c, ap_c in aps.items():
            mlflow.log_metric(f"val/ap_class_{c}", ap_c)
        mlflow.log_artifacts("outputs/curves", artifact_path="curves")
        print("ROC AUC per class:", roc_aucs)
        print("AP per class:", aps)
        mlflow.log_metric("val/sensitivity", sensitivity, step=epoch)
        mlflow.log_metric("val/specificity", specificity, step=epoch)
        mlflow.log_metric("val/precision", precision, step=epoch)
        mlflow.log_metric("val/recall", recall, step=epoch)
        mlflow.log_metric("val/accuracy", accuracy, step=epoch)
        mlflow.log_metric("val/fpr", fpr, step=epoch)
        mlflow.log_metric("val/fnr", fnr, step=epoch)
        mlflow.log_metric("val/auc_macro", auc_macro, step=epoch)
        mlflow.log_metric("val/auc_micro", auc_micro, step=epoch)

def dinov3_train_val_seg(
    model,
    train_loader,
    val_loader,
    optimizer,
    num_epochs,
    device,
    output_dir="checkpoints"
):
    best_val_loss = float("inf")

    for epoch in range(num_epochs):
        model.train()
        total_train_loss = 0.0

        for i, batch in enumerate(tqdm(train_loader, desc=f"[Train] Epoch {epoch+1}/{num_epochs}")):

            images = batch["image"].to(device)
            masks = [m.to(device) for m in batch["masks"]]

            # ===== Fix empty GT =====
            fixed_masks = []
            for m in masks:
                fixed_masks.append(
                    m if m.numel() > 0 else torch.zeros((1, 1, 28, 28), device=device)
                )

            gt_masks = torch.nn.utils.rnn.pad_sequence(fixed_masks, batch_first=True)

            # ===== Forward =====
            outputs = model.forward(batch, epoch, phase="train")

            # ===== Mask loss =====
            loss_mask = F.binary_cross_entropy_with_logits(
                outputs["mask_outs"],
                gt_masks
            )

            loss_total = loss_mask

            optimizer.zero_grad()
            loss_total.backward()
            optimizer.step()

            model.update_teacher(epoch, num_epochs)
            total_train_loss += loss_total.item()
            print(f"[Train] Epoch {epoch+1} | Step {i+1} | mask loss: {loss_mask:.4f}")

        avg_train_loss = total_train_loss/len(train_loader)
        print(f"[Train] Epoch {epoch+1} | Avg Loss: {avg_train_loss:.4f}")

        # ================= Validation =================
        if val_loader is None:
            continue

        model.eval()
        total_val_loss = 0.0
        all_y_true = []
        all_y_pred = []
        all_y_score = []

        with torch.no_grad():
            for i, batch in enumerate(val_loader):
                images = batch["image"].to(device)
                masks = batch["masks"]

                outputs = model.forward(batch, epoch, phase="val")
                logits = outputs["mask_outs"]
                probs = torch.sigmoid(logits)

                for b in range(probs.shape[0]):
                    gt_mask = masks[b].to(device)
                    pred_prob = probs[b]

                    gt_positive = (gt_mask.sum() > 0).item()

                    # image-level confidence
                    score = pred_prob.max().item()
                    pred_positive = int(score >= 0.5)

                    all_y_true.append(int(gt_positive))
                    all_y_pred.append(pred_positive)
                    all_y_score.append(score)

            loss_mask = F.binary_cross_entropy_with_logits(
                logits,
                masks
            )

            total_val_loss += loss_mask.item()

            print(f"[Val] Epoch {epoch+1} | Step {i+1} | mask loss: {loss_mask:.4f}")

        avg_val_loss = total_val_loss / len(val_loader)
        print(f"[Val] Epoch {epoch+1} | Avg Loss: {avg_val_loss:.4f}")

        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            torch.save(
                model.state_dict(),
                f"{output_dir}/dinov3_seg_best_epoch{epoch}.pth"
            )
        
        mlflow.log_metric("train/loss", avg_train_loss, step=epoch)
        mlflow.log_metric("val/loss", avg_val_loss, step=epoch)

        # validation metric
        tn, fp, fn, tp = confusion_matrix(all_y_true, all_y_pred).ravel()

        sensitivity = tp / (tp + fn + 1e-8)
        specificity = tn / (tn + fp + 1e-8)
        precision = tp / (tp + fp + 1e-8)
        recall = sensitivity
        accuracy = (tp + tn) / (tp + tn + fp + fn)

        fpr = fp / (fp + tn + 1e-8)
        fnr = fn / (fn + tp + 1e-8)

        fpr_curve, tpr_curve, _ = roc_curve(all_y_true, all_y_score)
        roc_auc = auc(fpr_curve, tpr_curve)

        cm = {
            "TP": int(tp),
            "FP": int(fp),
            "FN": int(fn),
            "TN": int(tn)
        }
        mlflow.log_dict(cm, "confusion_matrix_seg.json")
        mlflow.log_metric("val/sensitivity", sensitivity, step=epoch)
        mlflow.log_metric("val/specificity", specificity, step=epoch)
        mlflow.log_metric("val/precision", precision, step=epoch)
        mlflow.log_metric("val/recall", recall, step=epoch)
        mlflow.log_metric("val/accuracy", accuracy, step=epoch)
        mlflow.log_metric("val/fpr", fpr, step=epoch)
        mlflow.log_metric("val/fnr", fnr, step=epoch)
        mlflow.log_metric("val/auc", roc_auc, step=epoch)

def dinov3_train_val(
    model,
    train_loader,
    val_loader,
    optimizer,
    num_epochs,
    device,
    output_dir="checkpoints"
):
    best_val_loss = float("inf")

    for epoch in range(num_epochs):
        model.train()
        total_train_loss = 0.0

        for i, batch in enumerate(tqdm(train_loader, desc=f"[Train] Epoch {epoch+1}/{num_epochs}")):

            images = batch["image"].to(device)
            boxes = [b.to(device) for b in batch["boxes"]]
            labels = [l.to(device) for l in batch["labels"]]

            # ===== Fix empty GT =====
            fixed_boxes, fixed_labels = [], []
            for b, l in zip(boxes, labels):
                fixed_boxes.append(
                    b if b.numel() > 0 else torch.zeros((1, 4), device=device)
                )
                fixed_labels.append(
                    l if l.numel() > 0 else torch.zeros((1,), dtype=torch.long, device=device)
                )

            gt_boxes = torch.nn.utils.rnn.pad_sequence(fixed_boxes, batch_first=True)
            gt_labels = torch.nn.utils.rnn.pad_sequence(fixed_labels, batch_first=True)

            # ===== Forward =====
            outputs = model.forward_train(batch, epoch)

            # ===== Detection losses =====
            loss_box, loss_iou, loss_cls = dinov3_compute_loss(
                outputs["det_outs"],
                gt_boxes,
                gt_labels
            )

            loss_total = (
                loss_box +
                loss_cls +
                loss_iou
            )

            optimizer.zero_grad()
            loss_total.backward()
            optimizer.step()

            model.update_teacher(epoch, num_epochs)
            total_train_loss += loss_total.item()
            print(f"[Train] Epoch {epoch+1} | Step {i+1} | box loss: {loss_box:.4f}, loss_cls: {loss_cls:.4f}, loss_iou: {loss_iou:.4f}")

        print(f"[Train] Epoch {epoch+1} | Avg Loss: {total_train_loss/len(train_loader):.4f}")

        # ================= Validation =================
        if val_loader is None:
            continue

        model.eval()
        total_val_loss = 0.0

        with torch.no_grad():
            for i, batch in enumerate(val_loader):
                images = batch["image"].to(device)
                boxes = batch["boxes"]
                labels = batch["labels"]

                outputs = model.forward_train(batch, epoch)

                '''
                s_img_outs, s_txt_outs, t_img_outs, t_txt_outs, center, _ = outputs

                dino_loss = 0.5 * (
                    (-F.softmax((t_img_outs - center) / Tt, dim=-1)
                     * F.log_softmax(s_txt_outs / Ts, dim=-1)).sum(-1).mean() +
                    (-F.softmax((t_txt_outs - center) / Tt, dim=-1)
                     * F.log_softmax(s_img_outs / Ts, dim=-1)).sum(-1).mean()
                )
                '''

                loss_box, loss_iou, loss_cls = dinov3_compute_loss(
                    outputs["det_outs"],
                    boxes,
                    labels
                )
                
                total_val_loss += (
                    loss_box +
                    loss_cls +
                    loss_iou
                )

                print(f"[Val] Epoch {epoch+1} | Step {i+1} | box loss: {loss_box:.4f}, loss_cls: {loss_cls:.4f}, loss_iou: {loss_iou:.4f}")

        avg_val_loss = total_val_loss / len(val_loader)
        print(f"[Val] Epoch {epoch+1} | Avg Loss: {avg_val_loss:.4f}")

        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            torch.save(
                model.state_dict(),
                f"{output_dir}/dinov3_bbox_best.pth"
            )
            print("✅ Best bbox-only model updated")

def dinov3_train_val_llm(
    model,
    train_loader,
    val_loader,
    optimizer,
    num_epochs,
    device,
    output_dir="checkpoints",
    teacher_llm=None,
    student_llm=None,
    teacher_tokenizer=None,
    adapter=None,
    teacher_ctx_proj=None,
    student_ctx_proj=None,
    teacher_index=None,
    teacher_meta=None,
    retriever_index=None,
    retriever_meta=None,
):
    best_val_loss = float("inf")

    # ===== LLM control =====
    LLM_UPDATE_INTERVAL = 10
    FREEZE_LLM_EPOCHS = 5
    GENERATE_EVERY = 10

    global_step = 0

    for epoch in range(num_epochs):
        model.train()
        student_llm.train()

        if epoch < FREEZE_LLM_EPOCHS:
            student_llm.eval()
            for p in student_llm.parameters():
                p.requires_grad = False
        else:
            for p in student_llm.parameters():
                p.requires_grad = True
        
        total_train_loss = 0.0

        for i, batch in enumerate(tqdm(train_loader, desc=f"[Train] Epoch {epoch+1}/{num_epochs}")):

            global_step += 1

            images = batch["image"].to(device)
            boxes = [b.to(device) for b in batch["boxes"]]
            labels = [b.to(device) for b in batch["labels"]]
            neg_mask = batch["neg_mask"].to(device)

            # ===== Fix empty GT ======
            fixed_boxes, fixed_labels = [], []

            for b, l in zip(boxes, labels):
                fixed_boxes.append(b if b.numel() > 0 else torch.zeros((1, 4), device=device))
                fixed_labels.append(l if l.numel() > 0 else torch.zeros((1, ), dtype=torch.long, device=device))
            
            gt_boxes = torch.nn.utils.rnn.pad_sequence(fixed_boxes, batch_first=True)
            gt_labels = torch.nn.utils.rnn.pad_sequence(fixed_labels, batch_first=True)

            # ===== DINO forward =====
            outputs = model.forward_train(batch, epoch)
            s_img_outs, s_txt_outs, t_img_outs, t_txt_outs, center, det_outs = outputs

            # ===== Prompt & Text =====
            gt_texts = batch["output_text"]
            prompts = [
                "[Patient Statement] " + "".join(s) + 
                "[Doctor's Note] " + "".join(d) + 
                "\n[Generate Pathology Report]" 
                for s, d in zip(batch["patient_statement"], batch["doctor_note"])
            ]

            llm_inputs = teacher_tokenizer(prompts, return_tensors="pt", padding=True, truncation=True, max_length=512).to(device)
            llm_targets = teacher_tokenizer(gt_texts, return_tensors="pt", padding=True, truncation=True, max_length=512).to(device)

            # ===== Vision + Text feature =====
            img_feat = model.img_enc(images)
            txt_feat = model.text_enc(llm_inputs["input_ids"], llm_inputs["attention_mask"])
            multi_feat = torch.cat([img_feat, txt_feat], dim=-1)

            ctx = adapter(multi_feat)
            teacher_ctx = teacher_ctx_proj(ctx)
            student_ctx = student_ctx_proj(ctx)

            # ===== Build LLM embeddings =====
            t_embeds, t_attn = build_embeds(teacher_llm, teacher_ctx, llm_inputs)
            s_embeds, s_attn = build_embeds(student_llm, student_ctx, llm_inputs)

            # ===== Align labels =====
            labels = llm_targets["input_ids"]
            B, L_in = s_embeds.size(0), s_embeds.size(1)

            if labels.size(1) < L_in:
                labels = torch.cat(
                    [torch.full((B, L_in, labels.size(1)), -100, device=device), labels],
                    dim=1
                )
            else:
                labels = labels[:, :L_in]

            # ===== Distillation =====
            use_llm = (epoch >= FREEZE_LLM_EPOCHS) and (global_step % LLM_UPDATE_INTERVAL == 0)

            if use_llm:
                with torch.no_grad():
                    t_logits = teacher_llm(inputs_embeds=t_embeds, attention_mask=t_attn).logits
                s_logits = student_llm(inputs_embeds=s_embeds, attention_mask=s_attn).logits

                loss_text, _, _ = distill_loss(
                    s_logits, t_logits, labels, T=2.0, alpha=0.2
                )
            else:
                loss_text = torch.tensor(0.0, device=device)

            # ---- DINO losses ----
            Tt, Ts = model.cfg.teacher_temp_base, model.cfg.student_temp
            dino_loss_img = (-F.softmax((t_img_outs - center) / Tt, dim=-1)
                             * F.log_softmax(s_txt_outs / Ts, dim=-1)).sum(-1).mean()
            dino_loss_txt = (-F.softmax((t_txt_outs - center) / Tt, dim=-1)
                             * F.log_softmax(s_img_outs / Ts, dim=-1)).sum(-1).mean()

            loss_box, loss_iou, loss_cls, loss_region = dinov3_compute_loss_llm(
                det_outs, gt_boxes, gt_labels, llm_type=True, pos_mask=None, neg_mask=neg_mask
            )

            # ---- RAG ----
            if retriever_index is not None:
                s_txt_proj = model.project_for_retriever(s_txt_outs)
                rag_loss = compute_rag_loss(images, s_txt_proj, retriever_index, retriever_meta, k=3)
            else:
                rag_loss = torch.tensor(0.0, device=device)

            loss_dino = 0.5 * (dino_loss_img + dino_loss_txt)
            loss_total = (
                loss_dino +
                loss_box + loss_cls + loss_iou +
                0.5 * loss_region +
                0.5 * rag_loss +
                0.5 * loss_text
            )

            optimizer.zero_grad()
            loss_total.backward()
            optimizer.step()
            model.update_teacher(epoch, num_epochs)

            total_train_loss += loss_total.item()

        print(f"[Train] Epoch {epoch+1} | Avg Loss: {total_train_loss/len(train_loader):.4f}")

        # ================= Validation =================
        if val_loader is None:
            continue

        model.eval()
        student_llm.eval()
        total_val_loss = 0.0

        with torch.no_grad():
            for i, batch in enumerate(val_loader):
                images = batch["image"].to(device)
                outputs = model.forward_train(batch, epoch)
                s_img_outs, s_txt_outs, t_img_outs, t_txt_outs, center, _ = outputs

                loss_dino = 0.5 * (
                    (-F.softmax((t_img_outs - center) / Tt, dim=-1)
                     * F.log_softmax(s_txt_outs / Ts, dim=-1)).sum(-1).mean() +
                    (-F.softmax((t_txt_outs - center) / Tt, dim=-1)
                     * F.log_softmax(s_img_outs / Ts, dim=-1)).sum(-1).mean()
                )

                total_val_loss += loss_dino.item()

                if epoch % GENERATE_EVERY == 0 and i == 0:
                    prompts = [
                        "[Patient Statement] " + "".join(s) +
                        " [Doctor's Note] " + "".join(d) +
                        "\n[Generate Pathology Report]:"
                        for s, d in zip(batch["patient_statement"], batch["doctor_note"])
                    ]
                    llm_inputs = teacher_tokenizer(prompts, return_tensors="pt", padding=True).to(device)
                    img_feat = model.img_enc(images)
                    txt_feat = model.text_enc(llm_inputs["input_ids"], llm_inputs["attention_mask"])
                    ctx = adapter(torch.cat([img_feat, txt_feat], dim=-1))
                    s_ctx = student_ctx_proj(ctx)

                    embeds = student_llm.get_input_embeddings()(llm_inputs["input_ids"])
                    embeds = torch.cat([0.5 * s_ctx.unsqueeze(1), embeds], dim=1)
                    attn = F.pad(llm_inputs["attention_mask"], (1, 0), value=1)

                    gen_ids = student_llm.generate(
                        inputs_embeds=embeds,
                        attention_mask=attn,
                        max_new_tokens=64
                    )
                    print("Generated:", teacher_tokenizer.decode(gen_ids[0], skip_special_tokens=True))

        avg_val_loss = total_val_loss / len(val_loader)
        print(f"[Val] Epoch {epoch+1} | Avg Loss: {avg_val_loss:.4f}")

        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            torch.save(model.state_dict(), f"{output_dir}/dinov3_best_model.pth")
            print("✅ Best model updated")