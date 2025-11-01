import torch
from model.groundingdino.util.slconfig import SLConfig
from model.groundingdino.models import build_model

def load_grounding_dino(cfg_path:str, ckpt_path:str, device="cuda"):
    args = SLConfig.fromfile(cfg_path)
    model = build_model(args)
    ckpt = torch.load(ckpt_path, map_location="cpu")
    model.load_state_dict(ckpt["model"], strict=False)
    model.eval()
    model.to(device)
    return model

def set_trainable_backbone(model, train_text=False, train_backbone=False, train_xattn=True):
    # 預設只微調 cross-attention, detection head / 把 backbone & text encoder 固定
    for n, p in model.named_parameters():
        p.requires_grad = False
    
    for n, p in model.named_parameters():
        if train_text and ("text-encoder" in n or "bert" in n or "roberta" in n):
            p.requires_grad = True
        if train_backbone and ("backbone" in n):
            p.requires_grad = True
        if train_xattn and ("trainsformer.decoder.cross_attn" in n or "trainsformer.encoder" in n or "bbox_embed" in n or "class_embed" in n):
            p.requires_grad = True

    return model

