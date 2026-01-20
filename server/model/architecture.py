from torchvision.models import resnet50
from transformers import AutoModel, AutoTokenizer
# from utils.func import box_iou
import timm
import math
import mlflow.pyfunc
import torch
import json
import torch.nn as nn
import torch.nn.functional as F
from typing import Dict, List, Tuple, Optional, Literal, Any
import pandas as pd
import numpy as np
from utils.config import GroundDINOConfig, DINOv3Cfg, MouthDetConfig, UnifiedDetection, \
                         cosine_schedule, ema_update
from utils.func import autopad, box_iou, \
                       weighted_boxes_fusion, \
                       soft_nms_xyxy, \
                       nms_xyxy, \
                       _parse_pyfunc_inputs, _to_torch_images, \
                       decode_yolov7_outputs

from timm import create_model
import copy
# from transformers import AutoModelForCausalLM

'''
Mouth Localization Model

Input
│
├─ Backbone
│   ├─ Stem Conv
│   ├─ C3k2 × 2 (stride 8)
│   ├─ C3k2 × 2 + C2PSA (stride 16)
│   └─ C3k2 × 2 + C2PSA (stride 32)
│
├─ Neck
│   ├─ FPN (P5→P3)
│   └─ PAN (P3→P5)
│
└─ Head
    ├─ Single-class cls
    ├─ BBox regression
    └─ Objectness

A trainable PyTorch module
- forward() returns raw multi-scale predictions
- loss() provides a workable training loss (BCE obj/cls + CIoU box) with a simple target assignment

Notes:
- This is a clean, self-contained references implementation
- For production-grade training, replace the simple assigner with a stronger matcher (SimOTA/SimOTA/TaskAlignedAssigner)
  and consider DFL + distribution bbox regression.
'''
class ConvBNAct(nn.Module):
    def __init__(self, c1: int, c2: int, k: int = 1, s: int = 1, g: int = 1, act: str = "silu"):
        super().__init__()
        p = autopad(k)
        self.conv = nn.Conv2d(c1, c2, k, s, p, groups=g, bias=False)
        self.bn = nn.BatchNorm2d(c2)
        if act == "silu":
            self.act = nn.SiLU(inplace=True)
        elif act == "relu":
            self.act = nn.ReLU(inplace=True)
        elif act == "lrelu":
            self.act = nn.LeakyReLU(0.1, inplace=True)
        else:
            raise ValueError(f"Unknown act: {act}")
    
    def forward(self, x):
        return self.act(self.bn(self.conv(x)))

class DWConv(nn.Module):
    """
    Depthwise separable conv.
    """
    def __init__(self, c1: int, c2: int, k: int = 3, s: int = 1, act: str = "silu"):
        super.__init__()
        self.dw = ConvBNAct(c1, c2, k=k, s=s, g=c1, act=act)
        self.pw = ConvBNAct(c1, c2, k=1, s=1, g=1, act=act)

    def forward(self, x):
        return self.pw(self.dw(x))

class Bottleneck(nn.Module):
    """
    Standard bottleneck: 1x1 -> 3x3 with residual.
    """
    def __init__(self, c: int, shortcut: bool = True, act: str = "silu"):
        super().__init__()
        self.cv1 = ConvBNAct(c, c, k=1, s=1, act=act)
        self.cv2 = ConvBNAct(c, c, k=3, s=1, act=act)
        self.add = shortcut
    
    def forward(self, x):
        y = self.cv2(self.cv1(x))
        return x + y if self.add else y

class C3k2(nn.Module):
    """
    CSP-like block with smaller kernel emphasis (k2 idea).
    - Split channels, process one path with bottlenecks, then
    """
    def __init__(self, c1: int, c2: int, n: int = 2, e: float = 0.5, act: str = "silu"):
        super().__init__()
        c_ = int(c2 * e)
        self.cv1 = ConvBNAct(c1, c_, k=1, s=1, act=act)
        self.cv2 = ConvBNAct(c1, c_, k=1, s=1, act=act)
        self.m = nn.Sequential(*[Bottleneck(c_, shortcut=True, act=act) for _ in range(n)])
        # "k2" flavor: add a 2x2-ish receptive field proxy via a (3x3) DWConv + stride1 (keeps speed, strong local)
        self.k2 = DWConv(c_, c_, k=3, s=1, act=act)
        self.cv3 = ConvBNAct(2 * c_, c2, k=1, s=1, act=act)
    
    def forward(self, x):
        y1 = self.m(self.cv1(x))
        y1 = self.k2(y1)
        y2 = self.cv2(x)
        return self.cv3(torch.cat([y1, y2], dim=1))

class SpatialAttention(nn.Module):
    """
    Lightweight spatial attention:
    SA(x) = sigmoid(conv([avgpool(x), maxpool(x)]))
    """
    def __init__(self, k: int = 7):
        super().__init__()
        self.conv = nn.Conv2d(2, 1, kernel_size=k, padding=k // 2, bias=False)
    
    def forward(self, x):
        avg = torch.mean(x, dim=1, keepdim=True)
        mx, _ = torch.max(x, dim=1, keepdim=True)
        attn = torch.sigmoid(self.conv(torch.cat([avg, mx], dim=1)))
        return x * attn

class C2PSA(nn.Module):
    """
    Cross Stage Partial + Spatial Attention block
    - Split -> process -> attention -> concat -> fuse
    """
    def __init__(self, c1: int, c2: int, n: int = 1, e: float = 0.5, act: str = "silu"):
        super().__init__()
        c_ = int(c2 * e)
        self.cv1 = ConvBNAct(c1, c_, k=1, s=1, act=act)
        self.cv2 = ConvBNAct(c1, c_, k=1, s=1, act=act)
        self.m = nn.Sequential(*[Bottleneck(c_, shortcut=True, act=act) for _ in range(n)])
        self.sa = SpatialAttention(k=7)
        self.cv3 = ConvBNAct(2 * c_, c2, k=1, s=1, act=act)

    def forward(self, x):
        y1 = self.m(self.cv1(x))
        y1 = self.sa(y1)
        y2 = self.cv2(x)
        return self.cv3(torch.cat([y1, y2], dim=1))

class MouthBackbone(nn.Module):
    """
    Output:
        P3: stride 8
        P4: stride 16
        P5: stride 32
    """
    def __init__(self, in_ch: int = 3, base: int = 32, act: str = "silu"):
        super().__init__()
        c1 = base
        c2 = base * 2
        c3 = base * 4
        c4 = base * 8

        self.stem = nn.Sequential(
            ConvBNAct(in_ch, c1, k=3, s=2, act=act),
            ConvBNAct(c1, c2, k=3, s=2, act=act),
        )

        # Stage1 -> stride 8
        self.down1 = ConvBNAct(c2, c2, k=3, s=2, act=act)
        self.stage1 = C3k2(c2, c2, n=2, act=act)

        # Stage2 -> stride 16
        self.down2 = ConvBNAct(c2, c3, k=3, s=2, act=act)
        self.stage2 = nn.Sequential(
            C3k2(c3, c3, n=2, act=act),
            C2PSA(c3, c3, n=11, act=act),
        )

        # Stage3 -> stride 32
        self.down3 = ConvBNAct(c3, c4, k=3, s=2, act=act)
        self.stage3 = nn.Sequential(
            C3k2(c4, c4, n=2, act=act),
            C2PSA(c4, c4, n=1, act=act)
        )
    
    def forward(self, x):
        x = self.stem(x)
        p3 = self.stage1(self.down1(x))
        p4 = self.stage2(self.down2(p3))
        p5 = self.stage3(self.down3(p4))
        return p3, p4, p5

class FPNPAN(nn.Module):
    """
    FPN top-down + PAN bottom-up on (P3,P4,P5)
    """
    def __init__(self, c3: int, c4: int, c5: int, out_ch: int, act: str = "silu"):
        super().__init__()
        self.lat5 = ConvBNAct(c5, out_ch, k=1, s=1, act=act)
        self.lat4 = ConvBNAct(c4, out_ch, k=1, s=1, act=act)
        self.lat3 = ConvBNAct(c3, out_ch, k=1, s=1, act=act)
        
        self.fuse4 = C3k2(out_ch * 2, out_ch, n=2, act=act)
        self.fuse3 = C3k2(out_ch * 2, out_ch, n=2, act=act)

        # PAN bottom-up
        self.down3 = ConvBNAct(out_ch, out_ch, k=3, s=2, act=act)
        self.pan4 = C3k2(out_ch * 2, out_ch, n=2, act=act)

        self.down4 = ConvBNAct(out_ch, out_ch, k=3, s=2, act=act)
        self.pan5 = C3k2(out_ch * 2, out_ch, n=2, act=act)
    
    def forward(self, p3, p4, p5):
        # FPN
        p5_td = self.lat5(p5)
        p4_td = self.lat4(p4)
        p3_td = self.lat3(p3)

        p4_f = self.fuse4(torch.cat([p4_td, F.interpolate(p5_td, scale_factor=2.0, mode="nearest")], dim=1))
        p3_f = self.fuse3(torch.cat([p3_td, F.interpolate(p4_f, scale_factor=2.0, mode="nearest")], dim=1))

        # PAN
        p4_b = self.pan4(torch.cat([p4_f, self.down3(p3_f)], dim=1))
        p5_b = self.pan5(torch.cat([p5_td, self.down4(p4_b)], dim=1))

        # outputs at 3 scales
        return p3_f, p4_b, p5_b

class DecoupledHead(nn.Module):
    """
    Head (anchor-free)

    For each scale feature map:
        - reg: predicts l,t,r,b distances (positive) from 
        - obj: objectness
        - cls: class prob (mouth -> 1 class)
    Output per scale: [B, (4 + 1 + nc), H, W]
    """
    def __init__(self, in_ch: int, nc: int = 2, act: str = "silu"):
        super().__init__()
        self.nc = nc

        self.stem = nn.Sequential(
            ConvBNAct(in_ch, in_ch, k=3, s=1, act=act),
            ConvBNAct(in_ch, in_ch, k=3, s=1, act=act),
        )
        self.reg = nn.Conv2d(in_ch, 4, kernel_size=1, stride=1, padding=0)
        self.obj = nn.Conv2d(in_ch, 1, kernel_size=1, stride=1, padding=0)
        self.cls = nn.Conv2d(in_ch, nc, kernel_size=1, stride=1, padding=0)

        # init biases: encourage low objectness at start
        nn.init.constant_(self.obj.bias, -4.5)
        nn.init.constant_(self.cls.bias, -4.5)
    
    def forward(self, x):
        x = self.stem(x)
        reg = F.relu(self.reg(x))
        obj = self.obj(x)
        cls = self.cls(x)
        return torch.cat([reg, obj, cls], dim=1)

class MouthLocalizationYOLO(nn.Module):
    def __init__(self, cfg: MouthDetConfig = MouthDetConfig(), act: str = "silu"):
        super().__init__()
        self.cfg = cfg
        base = cfg.base

        self.backbone = MouthBackbone(in_ch=3, base=base, act=act)

        # Infer backbone channels
        # p3: base*2, p4: base * 4, p5: base * 8
        c3, c4, c5 = base * 2, base * 4, base * 8

        self.neck = FPNPAN(c3=c3, c4=c4, c5=c5, out_ch=cfg.neck_ch, act=act)

        self.head3 = DecoupledHead(cfg.neck_ch, nc=cfg.nc, act=act)
        self.head4 = DecoupledHead(cfg.neck_ch, nc=cfg.nc, act=act)
        self.head5 = DecoupledHead(cfg.neck_ch, nc=cfg.nc, act=act)
    
    def forward(self, x):
        """
        Returns list of predictions per scale:
        pred_s: [B, 4+1+nc, H, W] for strides 8,16,32 respectively
        """
        p3, p4, p5 = self.backbone(x)
        f3, f4, f5 = self.neck(p3, p4, p5)
        o3 = self.head3(f3)
        o4 = self.head4(f4)
        o5 = self.head5(f5)
        return [o3, o4, o5]

    @torch.no_grad()
    def decode(self, preds: List[torch.Tensor], conf_thres: float = 0.4) -> List[Dict[str, torch.Tensor]]:
        """
        Decode raw outputs into xyxy boxes in image pixel coords.
        Simple decode for inference/debug (no NMS)
        Returns per-image list: {"boxes": [N,4], "scores": [N], "labels": [N]}
        """
        device = preds[0].device
        bs = preds[0].shape[0]
        out = []
        for b in range(bs):
            boxes_all = []
            scores_all = []
            labels_all = []
            for si, pred in enumerate(preds):
                stride = self.cfg.strides[si]
                p = pred[b]
                reg = p[0:4]
                obj = p[4:5].sigmoid()
                cls = p[5:].sigmoid()

                H, W = reg.shape[1], reg.shape[2]
                yy, xx = torch.meshgrid(
                    torch.arange(H, device=device),
                    torch.arange(W, device=device),
                    indexing="ij"
                )

                # point centers in pixels
                cx = (xx + 0.5) * stride
                cy = (yy + 0.5) * stride

                l = reg[0] * stride
                t = reg[1] * stride
                r = reg[2] * stride
                btm = reg[3] * stride

                x1 = (cx - l).reshape(-1)
                y1 = (cy - t).reshape(-1)
                x2 = (cx + r).reshape(-1)
                y2 = (cy + btm).reshape(-1)
                boxes = torch.stack([x1, y1, x2, y2], dim=-1)

                # score = obj * cls (single-class)
                cls_score = cls[0].reshape(-1) if self.cfg.nc == 1 else cls.max(0).values.reshape(-1)
                score = (obj.reshape(-1) * cls_score)

                keep = score >= conf_thres
                if keep.any():
                    boxes_all.append(boxes[keep])
                    scores_all.append(score[keep])
                    if self.cfg.nc == 1:
                        labels_all.append(torch.zeros_like(score[keep], dtype=torch.long))
                    else:
                        labels_all.append(cls.argmax(0).reshape(-1)[keep].long())

            if len(boxes_all) == 0:
                out.append({"boxes": torch.zeros((0, 4), device=device),
                            "scores": torch.zeros((0,), device=device),
                            "labels": torch.zeros((0,), dtype=torch.long, device=device)})
            else:
                out.append({"boxes": torch.cat(boxes_all, dim=0),
                            "scores": torch.cat(scores_all, dim=0),
                            "labels": torch.cat(labels_all, dim=0)})
    
        return out

class DFLHead(nn.Module):
    """
    Predicts distribution for l,t,r,b
    Output channels = 4 * (reg_max + 1)
    """
    def __init__(self, in_ch, reg_max=16):
        super().__init__()
        self.reg_max = reg_max
        self.conv = nn.Conv2d(in_ch, 4 * (reg_max + 1), 1)
    
    def forward(self, x):
        # [B, 4*(reg_max+1), H, W]
        return self.conv(x)


class TaskAlignedAssigner:
    def __init__(self, topk=10, alpha=1.0, beta=6.0):
        self.topk = topk
        self.alpha = alpha
        self.beta = beta

    @torch.no_grad()
    def assign(self, pred_scores, pred_boxes, gt_boxes):
        """
        pred_scores: [N] sigmoid(cls) * sigmoid(obj)
        pred_boxes: [N,4] xyxy
        gt_boxes: [M,4]
        return: matched_gt_idx [N], fg_mask [N]
        """
        N = pred_boxes.size(0)
        M = gt_boxes.size(0)

        if M == 0:
            return torch.full((N,), -1, device=pred_boxes.device), torch.zeros(N, dtype=torch.bool)

        ious = box_iou(pred_boxes, gt_boxes)
        alignment = (pred_scores[:, None] ** self.alpha) * (ious ** self.beta)

        topk = min(self.topk, alignment.size(0))
        _, idx = alignment.topk(topk,  dim=0)

        fg_mask = torch.zeros(N, dtype=torch.bool, device=pred_boxes.device)
        matched_gt = torch.full((N,), -1, device=pred_boxes.device)

        for j in range(M):
            fg_mask[idx[:, j]] = True
            matched_gt[idx[:, j]] = j
        
        return matched_gt, fg_mask

class YOLODFLHead(nn.Module):
    def __init__(self, in_ch, nc=1, reg_max=16):
        super().__init__()
        self.nc = nc
        self.reg_max = reg_max
        
        self.stem = nn.Sequential(
            ConvBNAct(in_ch, in_ch, 3),
            ConvBNAct(in_ch, in_ch, 3),
        )

        self.cls = nn.Conv2d(in_ch, nc, 1)
        self.obj = nn.Conv2d(in_ch, 1, 1)
        self.reg = DFLHead(in_ch, reg_max)
    
    def forward(self, x):
        x = self.stem(x)
        return self.reg(x), self.obj(x), self.cls(x)

'''
YOLOv7-EMA network

Input
├─ Backbone (ELAN + SPPCSPC: 多尺度池化)
├─ Neck (PAN)
├─ EMA Attention Module
└─ Detection Head
'''
class Conv(nn.Module):
    def __init__(self, c1, c2, k=1, s=1, p=None, act=True):
        super().__init__()
        self.conv = nn.Conv2d(c1, c2, k, s, p or k // 2, bias=False)
        self.bn = nn.BatchNorm2d(c2)
        self.act = nn.SiLU() if act else nn.Identity()

    def forward(self, x):
        return self.act(self.bn(self.conv(x)))

class ELANBlock(nn.Module):
    def __init__(self, c1, c2):
        super().__init__()
        c_ = c2 // 2
        self.cv1 = Conv(c1, c_, 1)
        self.cv2 = Conv(c_, c_, 3)
        self.cv3 = Conv(c_, c_, 3)
        self.cv4 = Conv(c_ * 3, c2, 1)
    
    def forward(self, x):
        x1 = self.cv1(x)
        x2 = self.cv2(x1)
        x3 = self.cv3(x2)
        return self.cv4(torch.cat([x1, x2, x3], dim=1))

class SPPCSPC(nn.Module):
    def __init__(self, c1, c2):
        super().__init__()
        c_ = c1 // 2
        self.cv1 = Conv(c1, c_, 1)
        self.cv2 = Conv(c1, c_, 1)
        self.cv3 = Conv(c_, c_, 3)
        self.cv4 = Conv(c_, c_, 1)
        self.pool = nn.ModuleList([nn.MaxPool2d(k, 1, k // 2) for k in (5, 9, 13)])
        self.cv5 = Conv(c_ * 4, c_, 1)
        self.cv6 = Conv(c_, c_, 3)
        self.cv7 = Conv(c_ * 2, c2, 1)
    
    def forward(self, x):
        x1 = self.cv1(x)
        y = [x1] + [p(x1) for p in self.pool]
        y = self.cv5(torch.cat(y, dim=1))
        y = self.cv6(y)
        x2 = self.cv2(x)
        return self.cv7(torch.cat([y, x2], dim=1))

class EMA(nn.Module):
    def __init__(self, channels, groups=8):
        super().__init__()
        assert channels % groups == 0
        self.groups = groups
        self.group_ch = channels // groups

        self.conv1 = nn.Conv2d(self.group_ch, self.group_ch, 1)
        self.conv3 = nn.Conv2d(self.group_ch, self.group_ch, 3, padding=1)
    
    def forward(self, x):
        B, C, H, W = x.shape
        x = x.view(B, self.groups, self.group_ch, H, W)

        # spatial pooling
        x_h = x.mean(dim=4, keepdim=True)
        x_w = x.mean(dim=3, keepdim=True)

        attn = torch.sigmoid(
            self.conv1(x_h.squeeze(-1)) + 
            self.conv1(x_w.squeeze(-2))
        ).unsqueeze(-1).unsqueeze(-1)

        x = x * attn
        x = self.conv3(x.view(B * self.groups, self.group_ch, H, W))
        return x.view(B, C, H, W)

class YOLOv7DetectHead(nn.Module):
    def __init__(self, ch, num_classes):
        super().__init__()
        self.nc = num_classes
        self.no = num_classes + 5  # xywh + obj + cls
        self.conv = nn.ModuleList(
            nn.Conv2d(c, self.no, 1) for c in ch
        )

    def forward(self, x):
        return [self.conv[i](x[i]) for i in range(len(x))]

class YOLOv7_EMA(nn.Module):
    def __init__(self, num_classes=4):
        super().__init__()
        self.nc = num_classes

        # ---- Backbone ----
        self.stem = Conv(3, 64, 3, 1)
        self.stage1 = ELANBlock(64, 128)
        self.stage2 = ELANBlock(128, 256)
        self.stage3 = ELANBlock(256, 512)
        self.spp = SPPCSPC(512, 512)

        # ---- Neck (PAN) ----
        self.upsample = nn.Upsample(scale_factor=2, mode="nearest")
        self.pan1 = Conv(512 + 256, 256, 1)
        self.pan2 = Conv(256 + 128, 128, 1)
        
        # ---- EMA Attention ----
        self.ema1 = EMA(256)
        self.ema2 = EMA(128)

        # ---- Head ----
        self.detect = YOLOv7DetectHead(
            ch=[128, 256, 512], 
            num_classes=num_classes
        )

    def forward(self, x):
        # Backbone
        x = self.stem(x)
        x1 = self.stage1(x)
        x2 = self.stage2(x1)
        x3 = self.stage3(x2)
        x3 = self.spp(x3)

        # Neck
        p4 = self.pan1(torch.cat([self.upsample(x3), x2], dim=1))
        p4 = self.ema1(p4)

        p3 = self.pan2(torch.cat([self.upsample(p4), x1], dim=1))
        p3 = self.ema2(p3)

        return self.detect([p3, p4, x3])

    def forward_train(self, batch):
        return self.forward(batch["image"])
    
    def forward_inference(self, x):
        return self.forward(x)

'''
YOLOv7-EMA Adapter

Process of conversion: ROI -> YOLO -> Unified
Outputs: boxes.xyxy, conf, cls
'''
class YOLOv7LesionAdapter:
    def __init__(self, model, model_id="yolov7ema"):
        self.model = model
        self.model_id = model_id

    @torch.no_grad()
    def infer(self, roi_image: torch.Tensor) -> UnifiedDetection:
        """
        roi_image: Tensor[1,3,H,W] already resized/letterboxed
        """
        preds = self.model(roi_image)[0]

        if preds is None or len(preds) == 0:
            return UnifiedDetection(
                model_id=self.model_id,
                boxes=torch.zeros((0, 4), device=roi_image.device),
                scores=torch.zeros((0,), device=roi_image.device),
                labels=torch.zeros((0,), dtype=torch.long, device=roi_image.device),
                meta={}
            )

        boxes = preds[:, :4]
        scores = preds[:, 4]
        labels = preds[:, 5].long()

        return UnifiedDetection(
            model_id=self.model_id,
            boxes=boxes,
            scores=scores,
            labels=labels,
            meta={
                "num_preds": len(preds)
            }
        )

'''
DINO Adapter 

Process of conversion: ROI -> Transformer -> Unified
Outputs: 
pred_boxes (cxcywh - normalized)
pred_logits (class logits)
'''
class DINOLesionAdapter:
    def __init__(self, model, model_id="dino"):
        self.model = model
        self.model_id = model_id
    
    @torch.no_grad()
    def infer(self, roi_image: torch.Tensor) -> UnifiedDetection:
        """
        roi_image: Tensor[1,3,H,W]
        """
        outputs = self.model(roi_image)

        # logits: [1, num_queries, num_classes]
        logits = outputs["pred_logits"][0]
        probs = logits.softmax(-1)

        scores, labels = probs.max(dim=-1)

        # boxes: [1, num_queries, 4] in cscywh (0~1)
        boxes = outputs["pred_boxes"][0]

        H, W = roi_image.shape[-2:]
        cx, cy, w, h = boxes.unbind(-1)

        x1 = (cx - w / 2) * W
        y1 = (cy - h / 2) * H
        x2 = (cx + w / 2) * W
        y2 = (cy + h / 2) * H

        boxes_xyxy = torch.stack([x1, y1, x2, y2], dim=-1)

        return UnifiedDetection(
            model_id=self.model_id,
            boxes=boxes_xyxy,
            scores=scores,
            labels=labels,
            meta={
                "num_queries": boxes.shape[0]
            }
        )

class DINOLesionInfer:
    """
    Expects model outputs:
      outputs["pred_logits"]: [B, num_queries, num_classes]
      outputs["pred_boxes"]:  [B, num_queries, 4] in cxcywh normalized (0~1)
    """
    def __init__(self, model: nn.Module, model_id: str = "dino_v3", score_threshold: float = 0.01):
        self.model = model
        self.model_id = model_id
        self.score_threshold = float(score_threshold)

    @torch.no_grad()
    def __call__(self, images: torch.Tensor) -> List[UnifiedDetection]:
        self.model.eval()
        outputs = self.model(images)  # must return dict with pred_logits/pred_boxes

        logits = outputs["pred_logits"]   # [B,Q,C]
        boxes = outputs["pred_boxes"]     # [B,Q,4] cxcywh norm

        B, Q, C = logits.shape
        H, W = images.shape[-2], images.shape[-1]

        probs = logits.softmax(dim=-1)
        scores, labels = probs.max(dim=-1)  # [B,Q]

        # cxcywh norm -> xyxy pixel
        cx, cy, bw, bh = boxes.unbind(-1)
        x1 = (cx - bw / 2) * W
        y1 = (cy - bh / 2) * H
        x2 = (cx + bw / 2) * W
        y2 = (cy + bh / 2) * H
        boxes_xyxy = torch.stack([x1, y1, x2, y2], dim=-1)  # [B,Q,4]

        dets: List[UnifiedDetection] = []
        for b in range(B):
            keep = scores[b] >= self.score_threshold
            if keep.sum() == 0:
                dets.append(UnifiedDetection(
                    model_id=self.model_id,
                    boxes=torch.zeros((0, 4), device=images.device),
                    scores=torch.zeros((0,), device=images.device),
                    labels=torch.zeros((0,), dtype=torch.long, device=images.device),
                    meta={"num_queries": int(Q), "kept": 0}
                ))
            else:
                dets.append(UnifiedDetection(
                    model_id=self.model_id,
                    boxes=boxes_xyxy[b][keep],
                    scores=scores[b][keep],
                    labels=labels[b][keep].long(),
                    meta={"num_queries": int(Q), "kept": int(keep.sum().item())}
                ))
        return dets
    
class YOLOv7EMALesionInfer:
    def __init__(
        self,
        model: nn.Module,
        anchors: List[List[float]],
        strides: List[int],
        num_classes: int,
        model_id: str = "yolov7ema",
        score_threshold: float = 0.01
    ):
        self.model = model
        self.model_id = model_id
        self.strides = [int(s) for s in strides]
        self.num_classes = int(num_classes)
        self.score_threshold = float(score_threshold)

        # anchors: list of [[w,h],[w,h]...] per scale
        self.anchors = [torch.tensor(a, dtype=torch.float32) for a in anchors]

    @torch.no_grad()
    def __call__(self, images: torch.Tensor) -> List[UnifiedDetection]:
        self.model.eval()
        outputs = self.model(images)  # list of [B,C,H,W]
        device = images.device
        anchors = [a.to(device) for a in self.anchors]

        decoded = decode_yolov7_outputs(
            outputs=outputs,
            anchors=anchors,
            strides=self.strides,
            num_classes=self.num_classes,
            score_threshold=self.score_threshold
        )

        dets: List[UnifiedDetection] = []
        for d in decoded:
            dets.append(UnifiedDetection(
                model_id=self.model_id,
                boxes=d["boxes"],
                scores=d["scores"],
                labels=d["labels"],
                meta={"decoded": True, "num": int(d["boxes"].size(0))}
            ))
        return dets
    
class LesionExpertRunner:
    def __init__(self, experts: list):
        """
        experts: list of adapters (DINO, YOLO)
        """
        self.experts = experts
    
    @torch.no_grad()
    def run(self, roi_image: torch.Tensor) -> List[UnifiedDetection]:
        """
        roi_image: Tensor[1,3,H,W]
        return: list of UnifiedDetection
        """
        outputs = []
        for expert in self.experts:
            det = expert.infer(roi_image)
            outputs.append(det)
        
        return outputs
    
'''
Calibrator

Function: Map the rao confidence to more reliable values (cal_iou_est)
Class-wise / model-wise calibrated experts:
    key = (model_id + class_id) -> params
Supports:
    - linear: y = a*x + b
    - poly: y = sum_i c[i] * x^i
Output is clamped to [0,1].
'''

class ScoreCalibrator:
    def __init__(self, table: Dict[Tuple[str, int], Dict], default_mode: str = "identity"):
        """
        table example:
          {
            ("dino_v1", 0): {"mode":"poly", "coef":[0.02, 0.95, 0.10]},  # c0 + c1*x + c2*x^2
            ("yolov7ema_v2", 0): {"mode":"linear", "a":1.05, "b":-0.02},
          }
        default_mode:
          - "identity": y=x
          - "global_linear": use global params if provided in self.global_params
        """
        self.table = table
        self.default_mode = default_mode
        self.global_params: Optional[Dict] = None

    def set_global(self, params: Dict):
        """
        Optional global fallback, e.g. {"mode": "linear", "a": 1.0, "b": 0.0}
        """
        self.global_params = params

    @torch.no_grad()
    def __call__(self, model_id: str, labels: torch.Tensor, scores: torch.Tensor) -> torch.Tensor:
        """
        Vectorized per-detection calibration.
        labels: [N] long
        scores: [N] float in [0,1]
        return: [N] calibrated scores
        """
        device = scores.device
        out = scores.clone()

        # Group by class_id for efficiency
        unique_classes = labels.unique()
        for c in unique_classes.tolist():
            mask = labels == c
            if not mask.any():
                continue
            x = scores[mask]

            key = (model_id, int(c))
            params = self.table.get(key, None)

            if params is None:
                if self.default_mode == "identity":
                    y = x
                elif self.default_mode == "global_linear" and self.global_params is not None:
                    y = self._apply_params(x, self.global_params)
                else:
                    y = x
            else:
                y = self._apply_params(x, params)

            out[mask] = y

        return out.clamp(0.0, 1.0)
    
    def _apply_params(self, x: torch.Tensor, params: Dict) -> torch.Tensor:
        mode = params.get("mode", "identity")
        if mode == "identity":
            return x
        if mode == "linear":
            a = float(params["a"])
            b = float(params["b"])
            return a * x + b
        if mode == "poly":
            coef = params["coef"]  # list[float], c0..ck
            y = torch.zeros_like(x)
            # Horner is faster/stable
            for c in reversed(coef):
                y = y * x + float(c)
            return y
        raise ValueError(f"Unknown calibration mode: {mode}")

'''
Calibration + Fusion
'''
class CalibrateFusion:
    def __init__(
        self,
        calibrator: ScoreCalibrator,
        fusion: Literal["nms", "soft_nms", "wbf"] = "nms",
        score_thres: float = 0.05,
        iou_thres: float = 0.55,
        class_agnostic: bool = False
    ):
        self.calibrator = calibrator
        self.fusion = fusion
        self.score_thres = iou_thres
        self.iou_thres = iou_thres
        self.class_agnostic = class_agnostic
    
    @torch.no_grad()
    def run(self, dets: List[UnifiedDetection]) -> UnifiedDetection:
        """
        dets: outputs from Stage B experts, all in ROI-input coords.
        return: fused UnifiedDetection (ROI coords)
        """
        device = dets[0].boxes.device if dets else torch.device("cpu")

        # concat all candidates
        boxes_all = []
        scores_raw_all = []
        scores_cal_all = []
        labels_all = []
        src_mode_all = []

        for d in dets:
            if d.boxes.numel() == 0:
                continue

            # filter low row scores
            raw = d.scores
            lab = d.labels
            cal = self.calibrator(d.model_id, lab, raw)

            # calibrated scores
            keep = cal >= self.score_thres
            if keep.any():
                boxes_all.append(d.boxes[keep])
                scores_raw_all.append(raw[keep])
                scores_cal_all.append(cal[keep])
                labels_all.append(lab[keep])
                src_mode_all.append(torch.full((keep.sum(),), hash(d.model_id) % (10**9), device=device, dtype=torch.long))
        
        if len(boxes_all) == 0:
            return UnifiedDetection(
                model_id="ensemble",
                boxes=torch.zeros((0,4), device=device),
                scores=torch.zeros((0,), device=device),
                labels=torch.zeros((0,), dtype=torch.long, device=device),
                meta={"empty": True}
            )

        boxes = torch.cat(boxes_all, dim=0)
        scores_raw = torch.cat(scores_raw_all, dim=0)
        scores_cal = torch.cat(scores_cal_all, dim=0)
        labels = torch.cat(labels_all, dim=0)
        src_model = torch.cat(src_mode_all, dim=0)

        # fusion
        if self.fusion == "wbf":
            fb, fs, fl = weighted_boxes_fusion(
                boxes=boxes, scores=scores_cal, labels=labels,
                iou_thres=self.iou_thres
            )

            return UnifiedDetection(
                model_id="ensemble_wbf",
                boxes=fb,
                scores=fs,
                labels=fl,
                meta={
                    "fusion": "wbf",
                    "num_in": int(boxes.size(0)),
                    "num_out": int(fb.size(0)),
                }
            )
    
        # NMS / Soft-NMS (class-aware by default)
        kept_indices = []

        if self.class_agnostic:
            if self.fusion == "soft_nms":
                keep = soft_nms_xyxy(boxes, scores_cal, iou_thres=self.iou_thres)
            else:
                keep = nms_xyxy(boxes, scores_cal, iou_thres=self.iou_thres)
            kept_indices = keep
        else:
            # per-class NMS
            for c in labels.unique().tolist():
                m = labels == c
                if not m.any():
                    continue
                b = boxes[m]
                s = scores_cal[m]
                idx = torch.where(m)[0]
                if self.fusion == "soft_nms":
                    keep_local = soft_nms_xyxy(b, s, iou_thres=self.iou_thres)
                else:
                    keep_local = nms_xyxy(b, s, iou_thres=self.iou_thres)
                kept_indices.append(idx[keep_local])

            kept_indices = torch.cat(kept_indices, dim=0) if len(kept_indices) else torch.zeros((0,), dtype=torch.long, device=device)

        # sort kept by calibrated score
        if kept_indices.numel() > 0:
            kept_indices = kept_indices[scores_cal[kept_indices].argsort(descending=True)]

        out_boxes = boxes[kept_indices]
        out_scores = scores_cal[kept_indices]
        out_labels = labels[kept_indices]

        return UnifiedDetection(
            model_id="ensemble",
            boxes=out_boxes,
            scores=out_scores,
            labels=out_labels,
            meta={
                "fusion": self.fusion,
                "class_agnostic": self.class_agnostic,
                "iou_thres": self.iou_thres,
                "score_thres": self.score_thres,
                "num_in": int(boxes.size(0)),
                "num_out": int(out_boxes.size(0)),
                # debug traces
                "scores_raw_kept": scores_raw[kept_indices].detach().cpu(),
                "src_model_hash_kept": src_model[kept_indices].detach().cpu(),
            }
        )

'''
ROI coords -> Original coords

ROI_input_box
  ↓  (1) undo letterbox padding
ROI_resized_box
  ↓  (2) divide by scale
ROI_raw_box
  ↓  (3) add roi_bbox offset
Original_image_box
  ↓  (4) clamp to image boundary
Final box
'''
def undo_letterbox(
    boxes: torch.Tensor,
    pad: tuple
):
    """
    boxes: Tensor[N,4] in ROI-input coords
    pad: (pad_x, pad_y)
    """
    pad_x, pad_y = pad
    boxes = boxes.clone()
    boxes[:, [0, 2]] -= pad_x
    boxes[:, [1, 3]] -= pad_y
    return boxes

def unscale_boxes(
    boxes: torch.Tensor,
    scale: float
):
    """
    boxes: Tensor[N,4] in resized ROI coords
    """
    return boxes / scale

def roi_to_original(
    boxes: torch.Tensor,
    roi_bbox: list
):
    """
    roi_bbox: [rx1, ry1, rx2, ry2] in original image
    """
    rx1, ry1, _, _ = roi_bbox
    boxes = boxes.clone()
    boxes[:, [0, 2]] += rx1
    boxes[:, [1, 3]] += ry1
    return boxes

def clamp_boxes(
    boxes: torch.Tensor,
    img_w: int,
    img_h: int
):
    boxes[:, 0].clamp_(0, img_w - 1)
    boxes[:, 1].clamp_(0, img_h - 1)
    boxes[:, 2].clamp_(0, img_w - 1)
    boxes[:, 3].clamp_(0, img_h - 1)
    return boxes

def map_boxes_to_original(
    det: UnifiedDetection,
    roi_meta: dict,
    transform: dict,
    orig_img_shape: tuple
) -> UnifiedDetection:
    """
    det: UnifiedDetection (ROI-input coords)
    roi_meta: from Stage A
    transform: { "scale": float, "pad": [pad_x, pad_y] }
    orig_img_shape: (H, W)

    return: UnifiedDetection in ORIGINAL image coords
    """
    if det.boxes.numel() == 0:
        return det

    H, W = orig_img_shape

    boxes = det.boxes
    boxes = undo_letterbox(boxes, pad=transform["pad"])
    boxes = unscale_boxes(boxes, scale=transform["scale"])
    boxes = roi_to_original(boxes, roi_bbox=roi_meta["roi_bbox"])
    boxes = clamp_boxes(boxes, img_w=W, img_h=H)

    return UnifiedDetection(
        model_id=det.model_id,
        boxes=boxes,
        scores=det.scores,
        labels=det.labels,
        meta={
            **det.meta,
            "mapped_from_roi": True,
            "roi_status": roi_meta.get("status", "unknown")
        }
    )

def batch_map_boxes_to_original(
    dets: list,
    roi_metas: list,
    transforms: list,
    orig_shapes: list
):
    """
    dets: List[UnifiedDetection]
    roi_metas: List[roi_meta]
    transforms: List[transform]
    orig_shapes: List[(H,W)]
    """
    out = []
    for det, rm, tf, shape in zip(dets, roi_metas, transforms, orig_shapes):
        out.append(
            map_boxes_to_original(det, rm, tf, shape)
        )
    return out

'''
GroundingDINO architecture components
'''

# ==== Image Backbone
class ImageBackbone(nn.Module):
    def __init__(self, out_dim=1024, pretrained=True):
        super().__init__()
        base = resnet50(pretrained=pretrained)

        # C5 feature branch
        self.stem = nn.Sequential(
            base.conv1, base.bn1, base.relu, base.maxpool,
            base.layer1, base.layer2, base.layer3, base.layer4
        )
        self.proj = nn.Conv2d(2048, out_dim, kernel_size=1)

    def forward(self, x):
        f = self.stem(x)                    # [B, 2048, H/32, W/32]
        f = self.proj(f)                    # [B, out_dim, H/32, W/32]
        B, C, H, W = f.shape

        # flatten to tokens (maintain positional information)
        feat = f.flatten(2).transpose(1, 2)                             # [B, HW, C]
        pos = self._pos_encoding(H, W, C).to(feat.device)  # [1, HW, C]
        return feat, pos    # Vision tokens vs. position

    def _pos_encoding(self, H, W, C):
        y, x = torch.meshgrid(torch.arange(H), torch.arange(W), indexing="ij")
        omega_y = torch.arange(C//4) / (C//4)
        omega_x = torch.arange(C//4) / (C//4)
        omega_y = 1. / (10000 ** omega_y)
        omega_x = 1. / (10000 ** omega_x)
        out_y = torch.einsum('ij,k->ijk', y.float(), omega_y)
        out_x = torch.einsum('ij,k->ijk', x.float(), omega_x)
        pos = torch.cat([torch.sin(out_y), torch.cos(out_y),
                         torch.sin(out_x), torch.cos(out_x)], dim=-1)
        pos = pos.view(1, H*W, -1)

        if pos.shape[-1] < C:
            pad = C - pos.shape[-1]
            pos = torch.cat([pos, torch.zeros(1, H*W, pad)], dim=-1)
        
        return pos[:, :, :C]
    
# ==== Text Embedding
class TextBackbone(nn.Module):
    def __init__(self, model_name="HuggingFaceTB/SmolLM-135M-Instruct", out_dim=768):
        super().__init__()
        self.encoder = AutoModel.from_pretrained(model_name)
        self.proj = nn.Linear(self.encoder.config.hidden_size, out_dim)
        self.out_dim = out_dim
    
    def forward(self, input_ids, attention_mask):
        # input_ids / attention_mask: [B, L]
        out = self.encoder(input_ids=input_ids, attention_mask=attention_mask)
        # last hidden state of token
        feats = self.proj(out.last_hidden_state)
        return feats

# ==== Feature Enhancer
class CrossModalEnhancer(nn.Module):
    """
    Bi-directional cross-attention Block
    - image_self_attn
    - text_self_attn
    - image <-cross- text
    - text <-cross- image
    """
    def __init__(self, dim=768, nhead=8):
        super().__init__()
        self.img_self = nn.TransformerEncoderLayer(d_model=dim, nhead=nhead, batch_first=True)
        self.txt_self = nn.TransformerEncoderLayer(d_model=dim, nhead=nhead, batch_first=True)
        self.img_from_txt = nn.MultiheadAttention(dim, nhead, batch_first=True)
        self.txt_from_img = nn.MultiheadAttention(dim, nhead, batch_first=True)
        self.ln_img = nn.LayerNorm(dim)
        self.ln_txt = nn.LayerNorm(dim)
    
    def forward(self, img_feats, img_pos, txt_feats, txt_mask=None):
        i = self.img_self(img_feats + img_pos)     # Vision self-attention 
        t = self.txt_self(txt_feats)                # Text self-attention

        # image <-cross- text
        i2, _ = self.img_from_txt(i, t, t, key_padding_mask=(~txt_mask) if txt_mask is not None else None)
        i = self.ln_img(i + i2)

        # text <-cross- image
        t2, _ = self.txt_from_img(t, i, i)
        t = self.ln_txt(t + t2)

        return i, t # image/text tokens after feature enhancer

# ==== 語言引導的查詢選擇
class QuerySelector(nn.Module):
    def __init__(self, dim=768, num_queries=100):
        super().__init__()
        self.num_queries = num_queries
        self.query_proj = nn.Linear(dim, dim)
    
    def forward(self, img_feats, txt_feats, txt_mask=None):
        # 以 cosine 相似度從 image tokens 中挑出與文字最相關的 top-k 當作 query 初值
        B, Ni, C = img_feats.shape
        Nt = txt_feats.shape[1]
        img_n = F.normalize(img_feats, dim=-1)              # [B,Ni,C]
        txt_n = F.normalize(txt_feats, dim=-1)              # [B,Ni,C]
        sim = torch.einsum('bic,btc->bit', img_n, txt_n)    # [B,Ni,Nt]
        if txt_mask is not None:
            # mask 無效 token 的相似度
            m = (~txt_mask).unsqueeze(1).expand_as(sim)     # [B,1,Nt] -> [B,Ni,Nt]
            sim = sim.masked_fill(m, -1e4)                  # 
        
        score = sim.max(dim=-1).values                      # [B,Ni]
        topk = min(self.num_queries, Ni)                    
        idx = score.topk(topk, dim=-1).indices              # [B,topk]

        # 收集對應 image tokens 作為 queries
        queries = torch.gather(img_feats, 1, idx.unsqueeze(-1).expand(-1, -1, C))
        queries = self.query_proj(queries)
        return queries

# ==== Multi-modal decoder
class CrossModalDecoderLayer(nn.Module):
    def __init__(self, dim=768, nhead=8, mlp_ratio=4.0):
        super().__init__()
        self.self_attn = nn.MultiheadAttention(dim, nhead, batch_first=True)
        self.cross_img = nn.MultiheadAttention(dim, nhead, batch_first=True)
        self.cross_txt = nn.MultiheadAttention(dim, nhead, batch_first=True)
        self.ln1 = nn.LayerNorm(dim)
        self.ln2 = nn.LayerNorm(dim)
        self.ln3 = nn.LayerNorm(dim)
        self.mlp = nn.Sequential(
            nn.Linear(dim, int(dim*mlp_ratio)),
            nn.GELU(),
            nn.Linear(int(dim*mlp_ratio), dim)
        )
        self.ln4 = nn.LayerNorm(dim)
    
    def forward(self, q, img_feats, txt_feats, txt_mask=None):
        q2, _ = self.self_attn(q, q, q)
        q = self.ln1(q + q2)

        qi, _ = self.cross_img(q, img_feats, img_feats)
        q = self.ln2(q + qi)

        qt, _ = self.cross_txt(q, txt_feats, txt_feats,
                               key_padding_mask=(~txt_mask) if txt_mask is not None else None)
        
        q = self.ln3(q + qt)
        q = self.ln4(q + self.mlp(q))
        return q

class CrossModalDecoder(nn.Module):
    def __init__(self, dim=768, nhead=8, depth=6):
        super().__init__()
        self.layers = nn.ModuleList([CrossModalDecoderLayer(dim, nhead) for _ in range(depth)])
    
    def forward(self, queries, img_feats, txt_feats, txt_mask=None):
        q = queries
        
        for layer in self.layers:
            q = layer(q, img_feats, txt_feats, txt_mask=txt_mask)
        
        return q # [B,Q,C] 最終查詢表示
    
# ==== Detection head 
class DetectionHead(nn.Module):
    """
    Output:
    (1) grounding score: 用查詢與文字 token 的相似度作為 "與提示的一致性"
    (2) bbox: 以 MLP 預測 cxcywh (normalized)
    """
    def __init__(self, dim=768, bbox_hidden=256, num_classes=4):
        super().__init__()
        self.bbox_head = nn.Sequential(
            nn.Linear(dim, bbox_hidden), nn.ReLU(),
            nn.Linear(bbox_hidden, 4), nn.Sigmoid()
        )
        self.null_token = nn.Parameter(torch.zeros(1, dim))
        self.cls_head = nn.Linear(dim, num_classes)

    def forward(self, q, txt_feats, txt_mask=None):
        qn = F.normalize(q, dim=-1)
        tn = F.normalize(txt_feats, dim=-1)
        sim = torch.einsum('bqc,btc->bqt', qn, tn)
        if txt_mask is not None:
            sim = sim.masked_fill((~txt_mask).unsqueeze(1), -1e4)

        grounding_score = sim.max(dim=-1).values  # [B,Q]
        # 不拼接 null token（讓 loss 自行處理 background）
        boxes_cxcywh = self.bbox_head(q)
        cls_logits = self.cls_head(q)  # [B, Q, C]
        return grounding_score, boxes_cxcywh, cls_logits

class GroundingDINO(nn.Module):
    def __init__(self, 
                 cfg: GroundDINOConfig):
        super().__init__()
        self.cfg = cfg
        self.image_backbone = ImageBackbone(out_dim=cfg.img_dim)
        self.text_backbone = TextBackbone(out_dim=cfg.txt_dim)
        self.enhancer = CrossModalEnhancer(dim=cfg.img_dim, nhead=cfg.nhead)
        self.selector = QuerySelector(dim=cfg.img_dim, num_queries=cfg.num_queries)
        self.decoder = CrossModalDecoder(dim=cfg.img_dim, nhead=cfg.nhead, depth=cfg.decoder_depth)
        self.head = DetectionHead(dim=cfg.img_dim)

        # ===== Retriever projection =====
        txt_dim = cfg.text_embed_dim
        retriever_dim = cfg.retriever_dim
        self.retriever_proj = nn.Linear(txt_dim, retriever_dim)
    
    def project_for_retriever(self, txt_feat):
        proj = self.retriever_proj(txt_feat)
        return F.normalize(proj, dim=-1)

    def forward(self, images, input_ids, attention_mask):
        # Feature extraction
        img_feats, img_pos = self.image_backbone(images)
        txt_feats = self.text_backbone(input_ids, attention_mask)
        txt_mask = attention_mask.bool() if attention_mask is not None else None

        # Fusion enhancer
        img_enh, txt_enh = self.enhancer(img_feats, img_pos, txt_feats, txt_mask=txt_mask)

        # Query selection (Language-led)
        queries = self.selector(img_enh, txt_enh, txt_mask=txt_mask)            # [B,Q,C]

        # Multi-modal decoder
        q_final = self.decoder(queries, img_enh, txt_enh, txt_mask=txt_mask)    # [B,Q,C]

        # Detection head: grounding score + bbox
        grounding_score, boxes_cxcywh, cls_logits = self.head(q_final, txt_enh, txt_mask=txt_mask)
        
        return { # 這裡怎麼整合 scores 和 cls_logits？
            "scores": grounding_score,  # [B,Q]
            "cls_logits": cls_logits,   # [B,Q,C]
            "boxes": boxes_cxcywh       # [B,Q,4]
        }

class SwinBackbone(nn.Module):
    def __init__(self, model_name, img_size, pretrained):
        super().__init__()
        
        self.model = create_model(
            model_name=model_name, 
            pretrained=pretrained, 
            num_classes=0,
            global_pool="avg"
        )
        
        with torch.no_grad():
            x = torch.randn(1, 3, img_size, img_size)
            feat = self.model(x)
        
        self.out_dim = feat.shape[-1]
        self.proj = nn.Conv2d(self.out_dim, DINOv3Cfg.out_dim, kernel_size=1)

    def forward(self, x):
        return self.proj(self.model.forward_features(x))

class DINOv3ProjectionHead(nn.Module):
    def __init__(self, cfg: DINOv3Cfg):
        super().__init__()
        layers = []
        dim = cfg.in_dim
        for _ in range(cfg.nlayers - 1):
            layers.append(nn.Linear(dim, cfg.hidden_dim))
            layers.append(nn.GELU())
            dim = cfg.hidden_dim
        
        layers.append(nn.Linear(dim, cfg.out_dim))
        if cfg.norm_last:
            layers.append(nn.LayerNorm(cfg.out_dim, eps=1e-6))
        
        self.mlp = nn.Sequential(*layers)

    def forward(self, x):
        return self.mlp(x)

'''
class TextEncoder(nn.Module):
    """DistilBERT backbone for text embedding"""
    def __init__(self, model_name="distilbert-base-uncased"):
        super().__init__()
        self.encoder = AutoModel.from_pretrained(model_name)
        self.out_dim = self.encoder.config.hidden_size

    def forward(self, input_ids, attention_mask):
        out = self.encoder(input_ids=input_ids, attention_mask=attention_mask)
        pooled = out.last_hidden_state.mean(dim=1)  # [B, hidden_size]
        return pooled
'''

class TextEncoder(nn.Module):
    """
    Lightweight encoder-only text backbone for
    - vision-language alignment
    - region-text similarity
    - retriever embedding
    """
    def __init__(self, 
                 model_name="sentence-transformers/all-MiniLM-L6-v2",
                 max_length=128):
        super().__init__()
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.encoder = AutoModel.from_pretrained(model_name)
        self.out_dim = self.encoder.config.hidden_size
        self.max_length = max_length

    def forward(self, texts):
        """
        texts: List[str] or Tuple[str]
        return: [B, D] pooled embedding
        """
        device = next(self.parameters()).device

        enc = self.tokenizer(
            list(texts),
            padding=True,
            truncation=True,
            max_length=self.max_length,
            return_tensors="pt"
        ).to(device)

        out = self.encoder(**enc)
        # Mean pooling
        feat = out.last_hidden_state.mean(dim=1)
        return feat
    
class ImageEncoder(nn.Module):
    """
    Swin Transformer (或其他 timm backbone) 視覺特徵抽取模組。
    自動進行全域平均池化，輸出 [B, C] 向量。
    """
    def __init__(self, model_name="swin_base_patch4_window12_384", pretrained=True):
        super().__init__()
        # 建立 backbone
        self.model = timm.create_model(model_name, pretrained=pretrained, num_classes=0, global_pool="avg")

        # 嘗試一次前向傳遞以確認維度
        with torch.no_grad():
            dummy = torch.randn(1, 3, 384, 384)
            feat = self.model(dummy)
            if feat.ndim == 4:
                feat = feat.mean(dim=[2, 3])  # pool to [B, C]
            self.out_dim = feat.shape[-1]

    def forward(self, x):
        feat = self.model(x)
        # timm 有些模型會輸出 [B, C, H, W]，確保統一為 [B, C]
        if feat.ndim == 4:
            feat = feat.mean(dim=[2, 3])
        return feat

class SegmentationHeadDINOv3(nn.Module):
    """
    Simple segmentation head for DINOv3.
    Input: img_feats [B, N, C] (flattened patch features)
    Output: seg_logits [B, num_classes, H, W]
    """

    def __init__(self, dim=1024, num_classes=4, img_size=384, patch_size=4, num_queries=100):
        super().__init__()

        self.num_queries = num_queries
        self.img_size = img_size
        self.patch_size = patch_size
        self.num_patches_per_side = img_size // patch_size

        self.query_embed = nn.Parameter(torch.randn(num_queries, dim))

        # classification (instance class)
        self.cls_head = nn.Sequential(
            nn.Linear(dim, dim),
            nn.ReLU(),
            nn.Linear(dim, num_classes)
        )

        # mask embedding
        self.mask_embed = nn.Sequential(
            nn.Linear(dim, dim),
            nn.ReLU(),
            nn.Linear(dim, dim)
        )

    def forward(self, img_feats):
        """
        img_feats: [B, C, H, W] or [B, N, C] or [B, C]
        """
        if img_feats.ndim == 4:
            # [B, C, H, W] → [B, N, C]
            B, C, H, W = img_feats.shape
            img_feats = img_feats.view(B, C, H * W).transpose(1, 2)
            print(f"[WARN] img_feats reshaped to {img_feats.shape}")
        elif img_feats.ndim == 2:
            # [B, C] → [B, 1, C]
            img_feats = img_feats.unsqueeze(1)
            print(f"[WARN] img_feats reshaped to {img_feats.shape}")

        B, N, C = img_feats.shape

        queries = self.query_embed.unsqueeze(0).expand(B, -1, -1)  # [B, Q, C]

        # simple global pooling for conditioning
        img_context = img_feats.mean(dim=1, keepdim=True)          # [B, 1, C]
        fused = queries + img_context                              # [B, Q, C]

        cls_logits = self.cls_head(fused)                          # [B, Q, num_classes]
        mask_embeds = self.mask_embed(fused)                       # [B, Q, C]

        # compute masks
        masks = torch.einsum(
            'bqc,bnc->bqn',
            mask_embeds,
            img_feats
        )                                                           # [B, Q, N]

        H = W = self.num_patches_per_side
        mask_logits = masks.view(B, self.num_queries, H, W)              # [B, Q, H, W]

        return {
            "pred_logits": cls_logits,
            "pred_masks": mask_logits
        }

class DetectionHeadDINOv3BBox(nn.Module):
    """
    Image-only DINOv3 detection head (DETR-style)
    """

    def __init__(self, dim=1024, num_classes=4, num_queries=100):
        super().__init__()

        self.num_queries = num_queries
        self.query_embed = nn.Parameter(torch.randn(num_queries, dim))

        # bbox regression
        self.bbox_head = nn.Sequential(
            nn.Linear(dim, dim),
            nn.ReLU(),
            nn.Linear(dim, 4),
            nn.Sigmoid()
        )

        # classification head
        self.cls_head = nn.Sequential(
            nn.Linear(dim, dim),
            nn.ReLU(),
            nn.Linear(dim, num_classes)
        )

    def forward(self, img_feats):
        """
        img_feats: [B, N, C] or [B, C]
        """
        if img_feats.ndim == 2:
            img_feats = img_feats.unsqueeze(1)

        B, N, C = img_feats.shape

        queries = self.query_embed.unsqueeze(0).expand(B, -1, -1)  # [B, Q, C]

        # simple global pooling for conditioning
        img_context = img_feats.mean(dim=1, keepdim=True)          # [B, 1, C]
        fused = queries + img_context                              # [B, Q, C]

        boxes = self.bbox_head(fused)                               # [B, Q, 4]
        cls_logits = self.cls_head(fused)                           # [B, Q, num_classes]

        return {
            "pred_boxes": boxes,
            "pred_logits": cls_logits
        }
        
class DetectionHeadDINOv3(nn.Module):
    """
    Vision-Language detection head for DINOv3.
    Input: 
        img_feats [B, N, C] (flattened patch features)
        txt_feats [B, C] (pooled text feature)
    Output: 
        {
            "boxes": [B, Q, 4],              # (cx, cy, w, h)
            "grounding": [B, Q],             # grounding score
            "cls_logits": [B, Q, num_classes],
            "region_emb": [B, N, C],         # region-level embeddings
            "region_text_sim": [B]           # mean region-text alignment
        }
    """

    def __init__(self, dim=1024, num_classes=4, num_queries=100, txt_dim=1024):
        super().__init__()

        self.num_queries = num_queries
        self.query_embed = nn.Parameter(torch.randn(num_queries, dim))

        # align text to vision dimension
        self.text_proj = nn.Linear(txt_dim, dim)

        # bbox regression
        self.bbox_head = nn.Sequential(
            nn.Linear(dim, dim),
            nn.ReLU(),
            nn.Linear(dim, 4),
            nn.Sigmoid()
        )

        # region projection branch
        self.region_proj = nn.Sequential(
            nn.Linear(dim, dim * 2),
            nn.GELU(),
            nn.Linear(dim * 2, dim),
            nn.LayerNorm(dim)
        )

        # grounding score head
        self.ground_head = nn.Sequential(
            nn.Linear(dim, dim // 2),
            nn.ReLU(),
            nn.Linear(dim // 2, 1)
        )

        # classification head
        self.cls_head = nn.Sequential(
            nn.Linear(dim, dim),
            nn.ReLU(),
            nn.Linear(dim, num_classes)
        )

        # 🔹 region-text projection (lazy init)
        self.region_text_proj = None

    def forward(self, img_feats, txt_feats):
        """
        img_feats: [B, N, C] or [B, C]
        txt_feats: [B, C]
        """
        # --- Auto reshape ---
        if img_feats.ndim == 2:
            # [B, C] → [B, 1, C]
            img_feats = img_feats.unsqueeze(1)
            print(f"[WARN] img_feats reshaped to {img_feats.shape}")

        B, N, C = img_feats.shape

        txt_feats = self.text_proj(txt_feats)                      # [B, dim]
        queries = self.query_embed.unsqueeze(0).expand(B, -1, -1)  # [B, Q, dim]

        # Cross-modal interaction
        attn = torch.einsum(
            'bqc,bc->bq',
            F.normalize(queries, dim=-1),
            F.normalize(txt_feats, dim=-1)
        ).unsqueeze(-1)                                            # [B, Q, 1]
        fused = queries + attn * txt_feats.unsqueeze(1)            # [B, Q, dim]

        # === Heads ===
        boxes = self.bbox_head(fused)                              # [B, Q, 4]
        grounding_score = self.ground_head(fused).squeeze(-1)      # [B, Q]
        cls_logits = self.cls_head(fused)                          # [B, Q, num_classes]
        region_emb = self.region_proj(img_feats)                   # [B, N, dim]

        # === Region-text alignment branch ===
        region_mean = region_emb.mean(1)                           # [B, dim]
        if region_mean.ndim == 1:
            region_mean = region_mean.unsqueeze(0)                 # [1, D] 防呆
        txt_norm = F.normalize(txt_feats, dim=-1)
        region_norm = F.normalize(region_mean, dim=-1)

        if region_norm.shape[1] != txt_norm.shape[1]:
            # auto-projection layer (initialize once)
            if self.region_text_proj is None:
                print(f"[INIT] Auto-projection from {region_norm.shape[1]} → {txt_norm.shape[1]}")
                self.region_text_proj = nn.Linear(
                    region_norm.shape[1], txt_norm.shape[1]
                ).to(region_norm.device)
            region_norm = self.region_text_proj(region_norm)

        region_text_sim = F.cosine_similarity(region_norm, txt_norm, dim=-1)
        loss_region = 1 - region_text_sim.mean()

        if self.training and torch.rand(1).item() < 0.01:
            print(f"[DEBUG] region_emb={region_emb.shape}, txt_feats={txt_feats.shape}, sim={region_text_sim.mean().item():.4f}")

        return {
            "boxes": boxes,
            "grounding": grounding_score,
            "cls_logits": cls_logits,
            "region_emb": region_emb,
            "region_text_sim": region_text_sim,
            "loss_region": loss_region
        }

class OralDINOv3(nn.Module):
    def __init__(self, cfg: DINOv3Cfg):
        super().__init__()
        self.cfg = cfg

        # ===== Backbone =====
        self.img_enc = ImageEncoder(cfg.model_name)
        self.text_enc = TextEncoder(cfg.text_model_name)

        # 自動偵測 backbone 的輸出維度
        img_out_dim = self.img_enc.out_dim        # Swin-Base: 1024
        txt_out_dim = self.text_enc.out_dim       # DistilBERT: 768

        # ===== Projection heads (用對應維度初始化) =====
        self.img_head = DINOv3ProjectionHead(
            DINOv3Cfg(
                in_dim=img_out_dim,
                hidden_dim=cfg.hidden_dim,
                out_dim=cfg.out_dim,
                nlayers=cfg.nlayers,
                norm_last=cfg.norm_last
            )
        )

        self.text_head = DINOv3ProjectionHead(
            DINOv3Cfg(
                in_dim=txt_out_dim,
                hidden_dim=cfg.hidden_dim,
                out_dim=cfg.out_dim,
                nlayers=cfg.nlayers,
                norm_last=cfg.norm_last
            )
        )

        # ===== Momentum Teacher =====
        self.img_teacher = copy.deepcopy(self.img_enc)
        self.txt_teacher = copy.deepcopy(self.text_enc)
        self.img_head_teacher = copy.deepcopy(self.img_head)
        self.txt_head_teacher = copy.deepcopy(self.text_head)

        for m in [
            self.img_teacher, self.txt_teacher,
            self.img_head_teacher, self.txt_head_teacher
        ]:
            for p in m.parameters():
                p.requires_grad = False

        self.det_head = DetectionHeadDINOv3(
            dim=cfg.out_dim,
            num_classes=cfg.num_classes,
            num_queries=cfg.num_queries
        )

        # ===== Center buffer =====
        self.register_buffer("center", torch.zeros(1, cfg.out_dim))

        # ===== Distillation =====
        self.retriever_proj = nn.Linear(cfg.txt_dim, cfg.retriever_dim)
    
    def project_for_retriever(self, txt_feat):
        proj = self.retriever_proj(txt_feat)
        return F.normalize(proj, dim=-1)

    def student_forward(self, x):
        feat = self.student_backbone(x)
        out = self.student_head(feat)
        return out

    @torch.no_grad()
    def teacher_forward(self, x):
        f = self.teacher_backbone(x)
        o = self.teacher_head(f)
        return f, o
    
    @torch.no_grad()
    def update_teacher(self, epoch: int, total_epochs: int):
        m = cosine_schedule(self.cfg.momentum_base, self.cfg.momentum_end, total_epochs, epoch)
        # ema_update(self.student_backbone, self.teacher_backbone, m)
        # ema_update(self.student_head, self.teacher_head, m)
        ema_update(self.img_teacher, self.img_enc, m)
        ema_update(self.txt_teacher, self.text_enc, m)
        ema_update(self.img_head_teacher, self.img_head, m)
        ema_update(self.txt_head_teacher, self.text_head, m)
    
    def forward_train(self, batch, epoch):
        images = batch["image"]
        input_ids = batch["input_ids"]
        attn_mask = batch["attn_mask"]

        # ----- image backbone -----
        img_feat = self.img_enc(images)                # [B, 1024]
        
        # if img_feat.ndim == 4:
        #     img_feat = img_feat.mean(dim=[2, 3])  # [B, C]
        # elif img_feat.ndim == 3:
        #     img_feat = img_feat.mean(dim=1)       # [B, D]

        # ----- text backbone -----
        txt_feat = self.text_enc(input_ids, attn_mask) # [B, 768]
        
        # ----- projection heads (shared latent space) -----
        s_img_out = self.img_head(img_feat)
        s_txt_out = self.text_head(txt_feat)

        print("[forward_train] img_feat.shape:", img_feat.shape)

        assert s_img_out.shape[-1] == s_txt_out.shape[-1], \
            f"Mismatch: img_proj={s_img_out.shape[-1]}, txt_proj={s_txt_out.shape[-1]}"
        
        # ----- teacher (no grad) -----
        with torch.no_grad():
            self._momentum_update(epoch)
            t_img_feat = self.img_teacher(images)
            if t_img_feat.dim() == 4:
                B, H, W, C = t_img_feat.shape
                t_img_feat = t_img_feat.view(B, H * W, C)
            t_img_out = self.img_head_teacher(t_img_feat)
            t_txt_feat = self.txt_teacher(input_ids, attn_mask)
            t_txt_out = self.txt_head_teacher(t_txt_feat)
        
        det_outs = self.det_head(img_feat, s_txt_out)
        
        region_feat = det_outs["region_emb"].mean(1)

        print("region_feat.shape:", region_feat.shape)
        print("s_txt_out.shape:", s_txt_out.shape)

        if region_feat.shape[1] != s_txt_out.shape[1]:
            # 自動補 projection (線性投影到相同維度)
            proj = nn.Linear(region_feat.shape[1])
            region_feat = proj(region_feat)
        
        det_outs["region_feat"] = region_feat

        return s_img_out, s_txt_out, t_img_out, t_txt_out, self.center, det_outs

    @torch.no_grad()
    def update_center(self, teacher_prob):
        """
        teacher_prob: tensor of shape [B, D]
        表示 teacher softmax 後的輸出分布。
        """
        batch_center = teacher_prob.mean(dim=0, keepdim=True)  # [1, D]
        self.center = self.center * self.center_momentum + batch_center * (1 - self.center_momentum)
        
    @torch.no_grad()
    def extract(self, batch):
        imgs = batch["image"].to(next(self.parameters()).device)
        ids = batch["input_ids"].to(next(self.parameters()).device)
        mask = batch["attn_mask"].to(next(self.parameters()).device)
        f = self.img_enc(imgs)
        o = self.text_enc(ids, mask)
        return f, o

    @torch.no_grad()
    def _momentum_update(self, epoch):
        """EMA momentum update of teacher network"""
        m = self._get_teacher_momentum(epoch)
        for student, teacher in zip(
            [self.img_enc, self.text_enc, self.img_head, self.text_head],
            [self.img_teacher, self.txt_teacher, self.img_head_teacher, self.txt_head_teacher]
        ):
            for ps, pt in zip(student.parameters(), teacher.parameters()):
                pt.data = pt.data * m + ps.data * (1. - m)

    @torch.no_grad()
    def encode_text(self, text_list, tokenizer, device="cuda"):
        enc = tokenizer(
            text_list,
            return_tensors="pt",
            padding="max_length",
            truncation=True,
            max_length=32
        )
        feat = self.text_enc(enc["input_ids"], enc["attention_mask"])
        emb = F.normalize(self.text_head(feat), dim=-1)
        return emb.cpu().numpy()

    def _get_teacher_momentum(self, epoch):
        base, end = self.cfg.momentum_base, self.cfg.momentum_end
        progress = epoch / max(1, getattr(self.cfg, "total_epochs", 100))
        return end - (end - base) * (1. + torch.cos(torch.tensor(progress * 3.14159))) / 2

class DINOv3ToLLMAdapter(nn.Module):
    def __init__(self, llm_hidden_dim):
        super().__init__()
        self.proj = nn.Sequential(
            nn.LazyLinear(llm_hidden_dim),
            nn.GELU(),
            nn.LayerNorm(llm_hidden_dim)
        )

    def forward(self, x):
        return self.proj(x)

class OralDINOv3BBox(nn.Module): 
    def __init__(self, cfg: DINOv3Cfg): 
        super().__init__() 
        self.cfg = cfg 
        # ===== Image Backbone ===== 
        self.img_enc = ImageEncoder(cfg.model_name) 
        img_out_dim = self.img_enc.out_dim 
        
        # ===== Projection Head (DINO latent) ===== 
        self.img_head = DINOv3ProjectionHead( 
            DINOv3Cfg( 
                in_dim=img_out_dim, 
                hidden_dim=cfg.hidden_dim, 
                out_dim=cfg.out_dim, 
                nlayers=cfg.nlayers, 
                norm_last=cfg.norm_last 
            ) 
        ) 
        
        # ===== Momentum Teacher ===== 
        self.img_teacher = copy.deepcopy(self.img_enc) 
        self.img_head_teacher = copy.deepcopy(self.img_head) 
        
        for m in [self.img_teacher, self.img_head_teacher]: 
            for p in m.parameters(): 
                p.requires_grad = False 
        
        # ===== Detection Head ===== 
        self.det_head = DetectionHeadDINOv3BBox( 
            dim=cfg.out_dim, 
            num_classes=cfg.num_classes, 
            num_queries=cfg.num_queries 
        ) 
        
        # ===== Center buffer ===== 
        self.register_buffer("center", torch.zeros(1, cfg.out_dim)) 

    @torch.no_grad() 
    def update_teacher(self, epoch: int, total_epochs: int = None): 
        """ Public API for EMA teacher update. Kept for compatibility with training loop. """ 
        if total_epochs is not None: 
            # 讓 cfg 知道總 epoch（給 momentum schedule 用） 
            self.cfg.total_epochs = total_epochs 
            self._momentum_update(epoch) 
    
    @torch.no_grad() 
    def _momentum_update(self, epoch: int): 
        """ EMA momentum update of teacher network (image-only). """ 
        # ===== cosine momentum schedule ===== 
        base = self.cfg.momentum_base 
        end = self.cfg.momentum_end 
        total_epochs = getattr(self.cfg, "total_epochs", 100) 
        progress = epoch / max(1, total_epochs) 
        m = end - (end - base) * (1. + torch.cos(torch.tensor(progress * 3.1415926))) / 2. 
        
        # ===== EMA update: backbone ===== 
        for ps, pt in zip(self.img_enc.parameters(), self.img_teacher.parameters()): 
            pt.data.mul_(m).add_(ps.data, alpha=1. - m) 
        
        # ===== EMA update: projection head ===== 
        for ps, pt in zip(self.img_head.parameters(), self.img_head_teacher.parameters()): 
            pt.data.mul_(m).add_(ps.data, alpha=1. - m) 
    
    def forward_train(self, batch, epoch, phase): 
        images = batch["image"] 

        # ===== Student =====
        img_feat = self.img_enc(images) # [B, C] or [B, HW, C]
        s_img_out = self.img_head(img_feat) # [B, D]

        # ===== Teacher (EMA) =====
        if phase == "train":
            with torch.no_grad():
                self._momentum_update(epoch)

        t_img_feat = self.img_teacher(images)
        t_img_out = self.img_head_teacher(t_img_feat)

        # ===== Detection =====
        det_outs = self.det_head(img_feat)

        return {
            "s_img_out": s_img_out,
            "t_img_out": t_img_out,
            "center": self.center,
            "det_outs": det_outs
        }

    @torch.no_grad()
    def forward_inference(self, images):
        img_feat = self.img_enc(images)
        outputs = self.det_head(img_feat)
        return outputs

class OralDINOv3Seg(nn.Module):
    def __init__(self, cfg: DINOv3Cfg):
        super().__init__()
        self.cfg = cfg

        # ===== Image Backbone =====
        self.img_enc = ImageEncoder(cfg.model_name)
        img_out_dim = self.img_enc.out_dim

        # ===== Projection Head (DINO latent) =====
        self.img_head = DINOv3ProjectionHead(
            DINOv3Cfg(
                in_dim=img_out_dim,
                hidden_dim=cfg.hidden_dim,
                out_dim=cfg.out_dim,
                nlayers=cfg.nlayers,
                norm_last=cfg.norm_last
            )
        )

        # ===== Teacher model =====
        self.img_teacher = copy.deepcopy(self.img_enc)
        self.img_head_teacher = copy.deepcopy(self.img_head)

        for m in [self.img_teacher, self.img_head_teacher]: 
            for p in m.parameters(): 
                p.requires_grad = False 

        self.seg_head = SegmentationHeadDINOv3(
            dim=img_out_dim,
            num_classes=cfg.num_classes,
            num_queries=cfg.num_queries
        )

        self.register_buffer("center", torch.zeros(1, cfg.out_dim))
    
    @torch.no_grad() 
    def _momentum_update(self, epoch: int): 
        """ EMA momentum update of teacher network (image-only). """ 
        # ===== cosine momentum schedule ===== 
        base = self.cfg.momentum_base 
        end = self.cfg.momentum_end 
        total_epochs = getattr(self.cfg, "total_epochs", 100) 
        progress = epoch / max(1, total_epochs) 
        m = end - (end - base) * (1. + torch.cos(torch.tensor(progress * 3.1415926))) / 2. 
        
        # ===== EMA update: backbone ===== 
        for ps, pt in zip(self.img_enc.parameters(), self.img_teacher.parameters()): 
            pt.data.mul_(m).add_(ps.data, alpha=1. - m) 
        
        # ===== EMA update: projection head ===== 
        for ps, pt in zip(self.img_head.parameters(), self.img_head_teacher.parameters()): 
            pt.data.mul_(m).add_(ps.data, alpha=1. - m) 
    
    @torch.no_grad()
    def update_center(self, teacher_prob):
        """
        teacher_prob: tensor of shape [B, D]
        表示 teacher softmax 後的輸出分布。
        """
        batch_center = teacher_prob.mean(dim=0, keepdim=True)  # [1, D]
        self.center = self.center * self.center_momentum + batch_center * (1 - self.center_momentum)

    def forward(self, batch, epoch, phase="train"):
        images = batch["image"]

        # ===== Student =====
        img_feat = self.img_enc(images) # [B, C] or [B, HW, C]
        s_img_out = self.img_head(img_feat) # [B, D]

        # ===== Teacher (EMA) =====
        # Teacher 是「穩定的學習目標（Target Network）」
        #   * self-supervised 有效收斂
        #   * 表徵才不會 collapse（全部變成常數）
        # Student 去「追隨」它，而不是反過來。
        if phase == "train":
            with torch.no_grad():
                self._momentum_update(epoch)

        t_img_feat = self.img_teacher(images)
        t_img_out = self.img_head_teacher(t_img_feat)

        # ===== Segmentation =====
        seg_outs = self.seg_head(img_feat)

        return {
            "s_img_out": s_img_out,
            "t_img_out": t_img_out,
            "center": self.center,
            "seg_outs": seg_outs
        }

    @torch.no_grad()
    def forward_inference(self, images):
        """
        Inference forward for segmentation
        """
        # backbone
        img_feat = self.img_enc(images)

        # mask head (你 training 時用的那個)
        mask_outs = self.mask_head(img_feat)

        return {
            "mask_outs": mask_outs
        }
    
# ------ MLflow version ------
class OralDINOv3BBoxPyFunc(mlflow.pyfunc.PythonModel):

    def __init__(self, model, device, score_thresh=0.3):
        self.model = model
        self.device = device
        self.score_thresh = score_thresh

    def load_context(self, context):
        self.model.to(self.device)
        self.model.eval()

    @torch.no_grad()
    def predict(self, inputs):
        images = torch.from_numpy(inputs).to(self.device)
        outputs = self.model.forward_inference(images)

        pred_boxes = outputs["pred_boxes"]
        pred_logits = outputs["pred_logits"]
        return {"pred_boxes": pred_boxes, "pred_logits": pred_logits}
    
class InferenceBundle(mlflow.pyfunc.PythonModel):

    def __init__(self):
        super().__init__()
        self.device: Optional[torch.device] = None
        
        # models / runners
        self.dino_model: Optional[nn.Module] = None
        self.yolo_model: Optional[nn.Module] = None
        self.runner: Optional[nn.Module] = None
        self.stage_c: Optional[nn.Module] = None

        # config
        self.cfg: Dict[str, Any] = {}
    
    def load_context(self, context):
        """
        Expected artifacts:
            - "bundle_config": JSON file (anchors/strides/num_classes/thresholds/fusion settings)
            - "dino_weights": .pth
            - "yolo_weights": .pth
            - "calibrator_table": .json
        """
        # ---- Load config ----
        cfg_path = context.artifacts.get("bundle_config", None)
        if cfg_path is None:
            raise ValueError("Missing artifact: bundle_config")
        
        with open(cfg_path, "r", encoding="utf-8") as f:
            self.cfg = json.load(f)
        
        device_str = self.cfg.get("device", "cuda" if torch.cuda.is_available() else "cpu")
        self.device = torch.device(device_str)

        self.dino_model = OralDINOv3BBox(self.cfg.get("dino_cfg", {}))
        self.yolo_model = YOLOv7_EMA(num_classes=self.cfg.num_classes)

        # ---- load weights ----
        dino_w = context.artifacts.get("dino_weights", None)
        yolo_w = context.artifacts.get("yolo_weights", None)
        if dino_w is None or yolo_w is None:
            raise ValueError("Missing artifacts: dino_weights / yolo_weights")
        
        self.dino_model.load_state_dict(torch.load(dino_w, map_location="cpu"))
        self.yolo_model.load_state_dict(torch.load(yolo_w, map_location="cpu"))

        self.dino_model.to(self.device).eval()
        self.yolo_model.to(self.device).eval()

        # ---- load calibrator table ----
        cal_path = context.artifacts.get("calibrator_table", None)
        table: Dict[Tuple[str, int], Dict] = {}
        if cal_path is not None:
            with open(cal_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            
            # keys should be in form of (model_id, class_id)
            for k, v in raw.items():
                if isinstance(k, str) and k.startswith("(") and k.endswith(")"):
                    kk = k.strip("()")
                    parts = kk.split(",")
                    model_id = parts[0].strip().strip("'").strip('"')
                    class_id = int(parts[1].strip())
                    table[(model_id, class_id)] = v
                else:
                    try:
                        model_id, class_id = k
                        table[(str(model_id), int(class_id))] = v
                    except Exception:
                        pass
        
        calibrator = ScoreCalibrator(table=table, default_mode=self.cfg.get("calib_default_mode", "identity"))

        # ---- build Stage C ----
        self.stage_c = CalibrateFusion(
            calibrator=calibrator,
            fusion=self.cfg.get("fusion", "soft_nms"),
            score_thres=float(self.cfg.get("score_thres", 0.05)),
            iou_thres=float(self.cfg.get("iou_thres", 0.55)),
            class_agnostic=bool(self.cfg.get("class_agnostic", False)),
        )

        # ---- build Stage B runner ----
        dino_score_th = float(self.cfg.get("dino_score_thres", 0.01))
        yolo_score_th = float(self.cfg.get("yolo_score_thres", 0.01))

        self.runner = LesionExpertRunner(
            dino_infer=DINOLesionInfer(
                self.dino_model, 
                model_id=self.cfg.get("dino_model_id", "dinov3"),
                score_threshold=dino_score_th
            ),
            yolo_info=YOLOv7EMALesionInfer(
                self.yolo_model,
                anchors=self.cfg["yolo_anchors"],
                strides=self.cfg["yolo_strides"],
                num_classes=self.cfg.get("num_classes", 4),
                model_id=self.cfg.get("yolo_model_id", "yolov7ema"),
                score_threshold=yolo_score_th
            )
        )
    
    @torch.no_grad()
    def prefict(self, context, model_input):
        """
        model_input supports:
            - dict:
                {
                    "roi_images": np.ndarray [B,3,H,W] float32
                    "toi_meta": List[dist] (optional)
                    "roi_transform": List[dict] (optional)
                    "orig_shape": List[(H,W)] (optional)
                }
            - pandas.DataFrame with columns roi_images, roi_meta, roi_transform, orig_shape
        Output:
            pandas.DataFrame with columns: boxes, scores, labels, coord_space, meta
            where boxes/scores/labels are python lists 
        """
        if self.runner is None or self.stage_c is None or self.device is None:
            raise RuntimeError("Model not initialized. Did load_context run successfully?")
        
        roi_images_np, roi_meta_list, roi_transform_list, orig_shapes_list = _parse_pyfunc_inputs(model_input)
        images = _to_torch_images(roi_images_np, device=self.device)  # [B,3,H,W]

        # ---- Stage B ----
        per_image_expert_dets = self.runner.run(images)

        # ---- Stage C ----
        fused_per_image: List[UnifiedDetection] = []
        for dets in per_image_expert_dets:
            fused_per_image.append(self.stage_c.run(dets))

        # ----  Stage D ----
        out_rows = []
        for i, fused in enumerate(fused_per_image):
            cooid_space = "roi"
            dinal_det = fused

            if (roi_meta_list is not None) and \
               (roi_transform_list is not None) and \
               (orig_shapes_list is not None):
                try:
                    final_det = map_boxes_to_original(
                        det=fused,
                        roi_meta=roi_meta_list[i],
                        transform=roi_transform_list[i],
                        orig_img_shape=tuple(orig_shapes_list[i])
                    )
                    coord_space = "original"
                except Exception as e:
                    final_det = UnifiedDetection(
                        model_id=fused.model_id,
                        boxes=fused.boxes,
                        scores=fused.scores,
                        labels=fused.labels,
                        meta={**fused.meta, "stage_d_error": str(e)}
                    )
                    coord_space = "roi"
            
            out_rows.append({
                "boxes": final_det.boxes.detach().cpu().numpy().tolist(),
                "scores": final_det.scores.detach().cpu().numpy().tolist(),
                "labels": final_det.labels.detach().cpu().numpy().tolist(),
                "coord_space": coord_space,
                "meta": final_det.meta
            })
        
        return pd.DataFrame(out_rows)