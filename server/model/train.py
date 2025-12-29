import os
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms as T
from PIL import Image
from transformers import AutoTokenizer
from tqdm import tqdm
from utils.func import groundingdino_compute_loss, dinov3_compute_loss, dinov3_compute_loss_llm, compute_rag_loss, distill_loss
from model.architecture import DINOv3ToLLMAdapter
from nltk.translate.bleu_score import sentence_bleu
from rouge import Rouge

tqdm_disable = bool(os.environ.get("VERTEX_TQDM_DISABLE", "1"))

def grounddino_train_val(model, train_loader, val_loader, optimizer, num_epochs, device, output_dir="checkpoints"):
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
            s_img_outs, s_txt_outs, t_img_outs, t_txt_outs, center, _ = outputs

            # ===== Prompt & Text =====
            gt_texts = batch["output_text"]
            prompts = [
                "[Patient Statement] " + "".join(s) + 
                "[Doctor's Note] " + "".join(d) + 
                "\n[Generate Pathology Report]" 
                for s, d in zip(batch["patient_statement"], batch["doctor_note"])
            ]

            llm_inputs = tokenizer(prompts, return_tensors="pt", padding=True, truncation=True, max_length=512).to(device)
            llm_targets = tokenizer(gt_texts, return_tensors="pt", padding=True, truncation=True, max_length=512).to(device)

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
                    llm_inputs = tokenizer(prompts, return_tensors="pt", padding=True).to(device)
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
                    print("Generated:", tokenizer.decode(gen_ids[0], skip_special_tokens=True))

        avg_val_loss = total_val_loss / len(val_loader)
        print(f"[Val] Epoch {epoch+1} | Avg Loss: {avg_val_loss:.4f}")

        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            torch.save(model.state_dict(), f"{output_dir}/dinov3_best_model.pth")
            print("✅ Best model updated")