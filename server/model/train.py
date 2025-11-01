import os
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms as T
from PIL import Image
from transformers import AutoTokenizer
from tqdm import tqdm
from utils.func import groundingdino_compute_loss, dinov3_compute_loss, compute_rag_loss
from model.architecture import DINOv3ToLLMAdapter
from nltk.translate.bleu_score import sentence_bleu
from rouge import Rouge

def grounddino_train_val(model, train_loader, val_loader, optimizer, num_epochs, device):
    model.train()
    best_val_loss = float("inf")
    
    for epoch in range(num_epochs):
        running_loss = 0.0
        
        for batch in tqdm(train_loader, desc=f"Epoch {epoch+1}/{num_epochs}"):
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
                for batch in tqdm(val_loader, desc=f"[Val] Epoch {epoch+1}/{num_epochs}"):
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
                torch.save(model.state_dict(), f"checkpoints/groundingdino_best_model.pth")
                print(f"✅ Best model updated at epoch {epoch+1}")

        torch.save(model.state_dict(), f"checkpoints/grounding_dino_oral_epoch{epoch+1}.pth")

def dinov3_train_val(model, llm, llm_tokenizer, adapter, train_loader, val_loader, optimizer, num_epochs, device, retriever_index=None, retreiver_meta=None):
    best_val_loss = float("inf")
    
    for epoch in range(num_epochs):
        model.train()
        total_train_loss = 0.0
        
        for batch in tqdm(train_loader, desc=f"[Train] Epoch {epoch+1}/{num_epochs}"):
            
            images = batch["image"].to(device)
            # input_ids = batch["input_ids"].to(device)
            # attn_mask = batch["attn_mask"].to(device)
            boxes = [b.to(device) for b in batch["boxes"]]
            labels = [b.to(device) for b in batch["labels"]]
            neg_mask = batch["neg_mask"].to(device)

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
            
            # forward propagation
            outputs = model.forward_train(batch, epoch=0)  # 只 forward，不更新
            s_img_outs, s_txt_outs, t_img_outs, t_txt_outs, center, _ = outputs

            ground_truth_texts = batch["output_text"]
            prompts = [
                "[Patient Statement] " + "".join(s) + " [Doctor's Note] " + "".join(d) + "\n[Generate Pathology Report]:"
                for s, d in zip(batch["patient_statement"], batch["doctor_note"])
            ]

            llm_inputs = llm_tokenizer(prompts, return_tensors="pt", padding=True, truncation=True, max_length=512).to(device)
            llm_targets = llm_tokenizer(ground_truth_texts, return_tensors="pt", padding=True, truncation=True, max_length=512).to(device)

            # === Visual + Text Embedding ===
            img_feat = model.img_enc(images)                # [B, D_img]
            txt_feat = model.text_enc(llm_inputs["input_ids"], llm_inputs["attention_mask"]) # [B, D_txt]
            multi_feat = torch.cat([img_feat, txt_feat], dim=-1)  # [B, D_img + D_txt]
            context_token = adapter(multi_feat)  # [B, hidden_size]

            # === 插入到 LLM context ===
            input_embeds = llm.get_input_embeddings()(llm_inputs["input_ids"])  # [B, L, hidden_size]
            input_embeds = torch.cat([0.5 * context_token.unsqueeze(1), input_embeds], dim=1)
            input_embeds = input_embeds.to(dtype=llm.dtype)
            attn_mask = F.pad(llm_inputs["attention_mask"], (1, 0), value=1)
            
            # === Align labels ===
            labels = llm_targets["input_ids"]
            B, L_in = input_embeds.size(0), input_embeds.size(1)
            L_out = labels.size(1)

            if L_out < L_in:
                pad_len = L_in - L_out
                ignore_pad = torch.full((B, pad_len), -100, device=labels.device)
                labels = torch.cat([ignore_pad, labels], dim=1)
            elif L_out > L_in:
                labels = labels[:, :L_in]
            
            # === Forward pass through LLM ===
            outputs_llm = llm(inputs_embeds=input_embeds, attention_mask=attn_mask, labels=labels)
            loss_text = outputs_llm.loss

            # Contrastive loss
            T_t = model.cfg.teacher_temp_base
            T_s = model.cfg.student_temp
            teacher_prob = F.softmax((t_img_outs - center) / T_t, dim=-1)
            student_logprob = F.log_softmax(s_txt_outs / T_s, dim=-1)        

            dino_loss_img = torch.sum(-teacher_prob * student_logprob, dim=-1).mean()

            teacher_prob = F.softmax((t_txt_outs - center) / T_t, dim=-1)
            student_logprob = F.log_softmax(s_img_outs / T_s, dim=-1)
            dino_loss_txt = torch.sum(-teacher_prob * student_logprob, dim=-1).mean()

            with torch.no_grad():
                new_center = center * model.cfg.center_momentum + teacher_prob.mean(dim=0, keepdim=True) * (1 - model.cfg.center_momentum)
                center.copy_(new_center)

            # Box & Classification loss
            loss_box, loss_iou, loss_cls, loss_region = dinov3_compute_loss(outputs, gt_boxes, gt_labels, pos_mask=None, neg_mask=neg_mask)

            # RAG loss
            if retriever_index.d != s_txt_outs.shape[1]:
                projector = nn.Linear(s_txt_outs.shape[1], retriever_index.d).to(s_txt_outs.device)
                s_txt_outs = projector(s_txt_outs)
            
            rag_loss = compute_rag_loss(images, s_txt_outs, retriever_index, retreiver_meta, k=3)

            optimizer.zero_grad()
            
            loss_dino = (dino_loss_img + dino_loss_txt) / 2
            loss_total = 1.0 * loss_dino + 1.0 * loss_box + 1.0 * loss_cls + 1.0 * loss_iou + 0.5 * rag_loss + 0.5 * loss_region + 0.5 * loss_text
            total_train_loss += loss_total.item()

            print(f"[Train] Epoch {epoch+1} | loss_dino: {loss_dino:.4f} | loss_box: {loss_box:.4f} | loss_cls: {loss_cls:.4f} | loss_iou: {loss_iou:.4f} | rag_loss: {rag_loss:.4f} | loss_region: {loss_region:.4f} | loss_text: {loss_text:.4f}")

            optimizer.zero_grad()
            loss_total.backward()
            optimizer.step()
            model.update_teacher(epoch, num_epochs)
        
        avg_train_loss = total_train_loss / len(train_loader)
        print(f"[Train] Epoch {epoch+1} | Avg Loss: {avg_train_loss:.4f}")
        
        if val_loader is not None:
            model.eval()
            total_val_loss = 0.0
            total_text_loss = 0.0
            bleu_scores, rouge_l_scores = [], []

            for batch in tqdm(val_loader, desc=f"[Validation] Epoch {epoch+1}/{num_epochs}]"):
                images = batch["image"].to(device)
                # input_ids = batch["input_ids"].to(device)
                # attn_mask = batch["attn_mask"].to(device)
                boxes = [b.to(device) for b in batch["boxes"]]
                labels = [b.to(device) for b in batch["labels"]]
                neg_mask = batch["neg_mask"].to(device)
                
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

                outputs = model.forward_train(batch, epoch=0)  # 只 forward，不更新
                s_img_outs, s_txt_outs, t_img_outs, t_txt_outs, center, _ = outputs

                ground_truth_texts = batch["output_text"]
                prompts = [
                    "[Patient Statement] " + "".join(s) + " [Doctor's Note] " + "".join(d) + "\n[Generate Pathology Report]:"
                    for s, d in zip(batch["patient_statement"], batch["doctor_note"])
                ]

                llm_inputs = llm_tokenizer(prompts, return_tensors="pt", padding=True, truncation=True, max_length=512).to(device)
                llm_targets = llm_tokenizer(ground_truth_texts, return_tensors="pt", padding=True, truncation=True, max_length=512).to(device)

                # === Visual + Text Embedding ===
                img_feat = model.img_enc(images)                # [B, D_img]
                txt_feat = model.text_enc(llm_inputs["input_ids"], llm_inputs["attention_mask"]) # [B, D_txt]
                multi_feat = torch.cat([img_feat, txt_feat], dim=-1)  # [B, D_img + D_txt]
                context_token = adapter(multi_feat)  # [B, hidden_size]

                # === 插入到 LLM context ===
                input_embeds = llm.get_input_embeddings()(llm_inputs["input_ids"])  # [B, L, hidden_size]
                input_embeds = torch.cat([0.5 * context_token.unsqueeze(1), input_embeds], dim=1)
                input_embeds = input_embeds.to(dtype=llm.dtype)
                attn_mask = F.pad(llm_inputs["attention_mask"], (1, 0), value=1)
                
                # === Align labels ===
                labels = llm_targets["input_ids"]
                B, L_in = input_embeds.size(0), input_embeds.size(1)
                L_out = labels.size(1)

                if L_out < L_in:
                    pad_len = L_in - L_out
                    ignore_pad = torch.full((B, pad_len), -100, device=labels.device)
                    labels = torch.cat([ignore_pad, labels], dim=1)
                elif L_out > L_in:
                    labels = labels[:, :L_in]
                
                # === Forward pass through LLM ===
                outputs_llm = llm(inputs_embeds=input_embeds, attention_mask=attn_mask, labels=labels)
                loss_text = outputs_llm.loss

                T_t = model.cfg.teacher_temp_base
                T_s = model.cfg.student_temp
                
                teacher_prob = F.softmax((t_img_outs - center) / T_t, dim=-1)
                student_logprob = F.log_softmax(s_txt_outs / T_s, dim=-1)
                dino_loss_img = torch.sum(-teacher_prob * student_logprob, dim=-1).mean()

                teacher_prob = F.softmax((t_txt_outs - center) / T_t, dim=-1)
                student_logprob = F.log_softmax(s_img_outs / T_s, dim=-1)
                dino_loss_txt = torch.sum(-teacher_prob * student_logprob, dim=-1).mean()
                
                # Box & Classification loss
                loss_box, loss_iou, loss_cls, loss_region = dinov3_compute_loss(outputs, gt_boxes, gt_labels, pos_mask=None, neg_mask=neg_mask)

                # RAG loss
                if retriever_index.d != s_txt_outs.shape[1]:
                    projector = nn.Linear(s_txt_outs.shape[1], retriever_index.d).to(s_txt_outs.device)
                    s_txt_outs = projector(s_txt_outs)

                rag_loss = compute_rag_loss(images, s_txt_outs, retriever_index, retreiver_meta, k=3)

                # Text generation
                with torch.no_grad():
                    ground_truth_texts = batch["output_text"]
                    print("ground_truth_texts:", ground_truth_texts)

                    prompts = [
                        "[Patient Statement] " + "".join(s) + " [Doctor's Note] " + "".join(d) + "\n[Generate Pathology Report]:"
                        for s, d in zip(batch["patient_statement"], batch["doctor_note"])
                    ]

                    llm_inputs = llm_tokenizer(prompts, return_tensors="pt", padding=True, truncation=True, max_length=512).to(device)
                    llm_targets = llm_tokenizer(ground_truth_texts, return_tensors="pt", padding=True, truncation=True, max_length=512).to(device)

                    # ----- image + text feature fusion
                    img_feat = model.img_enc(images)
                    txt_feat = model.text_enc(llm_inputs["input_ids"], llm_inputs["attention_mask"])
                    multi_feat = torch.cat([img_feat, txt_feat], dim=-1)
                    context_token = adapter(multi_feat)

                    # Multi-modal token
                    input_embeds = llm.get_input_embeddings()(llm_inputs["input_ids"])
                    input_embeds = torch.cat([0.5 * context_token.unsqueeze(1), input_embeds], dim=1)
                    input_embeds = input_embeds.to(dtype=llm.dtype)
                    attn_mask = F.pad(llm_inputs["attention_mask"], (1, 0), value=1)

                    # === Align labels ===
                    labels = llm_targets["input_ids"]
                    B, L_in = input_embeds.size(0), input_embeds.size(1)
                    L_out = labels.size(1)

                    if L_out < L_in:
                        pad_len = L_in - L_out
                        ignore_pad = torch.full((B, pad_len), -100, device=labels.device)
                        labels = torch.cat([ignore_pad, labels], dim=1)
                    elif L_out > L_in:
                        labels = labels[:, :L_in]

                    # LLM forward
                    outputs_llm = llm(
                        inputs_embeds=input_embeds,
                        attention_mask=attn_mask,
                        labels=labels
                    )
                    loss_text = outputs_llm.loss
                    total_text_loss += loss_text.item()

                    # Generated text for assessment
                    generated_ids = llm.generate(
                        inputs_embeds=input_embeds,
                        attention_mask=attn_mask,
                        max_new_tokens=200,
                        temperature=0.7,
                        top_p=0.9
                    )

                    generated_text = llm_tokenizer.decode(generated_ids[0], skip_special_tokens=True)
                    ref_text = "".join(ground_truth_texts)

                    print("generated_text:", generated_text)

                    # BLEU / ROUGE 
                    bleu = sentence_bleu([ref_text.split()], generated_text.split())
                    rouge = Rouge().get_scores(generated_text, ref_text)[0]
                    bleu_scores.append(bleu)
                    rouge_l_scores.append(rouge["rouge-l"]["f"])

                loss_dino = (dino_loss_img + dino_loss_txt) / 2
                loss_total = 1.0 * loss_dino + 1.0 * loss_box + 1.0 * loss_cls + 1.0 * loss_iou + 0.5 * rag_loss + 0.5 * loss_region
                total_val_loss += loss_total.item()
            
            avg_val_loss = total_val_loss / len(val_loader)
            avg_bleu = sum(bleu_scores) / len(bleu_scores)
            avg_rouge = sum(rouge_l_scores) / len(rouge_l_scores)
            print(f"[Val] Epoch {epoch+1} | Avg Loss: {avg_val_loss:.4f} | Text Loss: {total_text_loss/len(val_loader):.4f}")
            print(f"Avg BLEU: {avg_bleu:.4f} | Avg ROUGE-L: {avg_rouge:.4f}")

        # 保存最佳模型
        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            torch.save(model.state_dict(), f"checkpoints/dinov3_best_model.pth")
            print(f"✅ Best model updated at epoch {epoch+1}")

        torch.save(model.state_dict(), f"checkpoints/dinov3_oral_epoch{epoch+1}.pth")
