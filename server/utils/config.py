import torch
from dataclasses import dataclass, field
from typing import List, Tuple, Dict, Optional

@dataclass
class UnifiedDetection:
    model_id: str           # "dino_v1", "yolov7ema"
    boxes: torch.Tensor     # [N, 4] xyxy
    scores: torch.Tensor    # [N] row confidence (0~1)
    labels: torch.Tensor    # [N] class id
    meta: Dict              # model-specific debug info

@dataclass
class MouthDetConfig:
    img_size: int = 640
    nc: int = 1
    base: int = 32
    neck_ch: int = 128
    strides: Tuple[int, int, int] = (8, 16, 32)

    # loss weights
    box_weight: float = 7.5
    obj_weight: float = 1.0
    cls_weight: float = 0.3

    # assignment
    center_radius: float = 2.5
    min_iou_pos: float = 0.2

@dataclass
class GroundDINOConfig:
    img_dim: int = 768
    txt_dim: int = 768
    num_queries: int = 100
    decoder_depth: int = 6
    nhead: int = 8
    text_embed_dim: int = 768
    retriever_dim: int = 384

@dataclass
class DINOv3Cfg:
    # backbone
    model_name: str = "swin_base_patch4_window12_384"
    text_model_name: str = "HuggingFaceTB/SmolLM-135M-Instruct"
    img_size: int = 384
    num_classes: int = 4  # 包含背景
    update_teacher: int = 10
    color_label_map: dict = field(
        default_factory=lambda: {
            0: (255, 0, 255), # None
            1: (0, 255, 0),     # Green
            2: (0, 255, 255),   # Yellow
            3: (0, 0, 255),     # Red
        }
    )

    # hyperparameters
    lr: float = 1e-4
    weight_decay: float = 1e-4

    # projection head
    in_dim: int = 768       # ✅ 修這裡
    llm_hidden_dim: int = 1024,
    out_dim: int = 1024
    hidden_dim: int = 4096
    nlayers: int = 3
    norm_last: bool = True

    # teacher momentum (cos schedhule)
    momentum_base: float = 0.996
    momentum_end: float = 0.995

    # loss / temperature
    teacher_temp_base: float = 0.04
    teacher_temp_final: float = 0.04
    student_temp: float = 0.1
    center_momentum: float = 0.9

    # detection head
    num_queries: int = 100

    # distillation
    txt_dim: int = 768
    retriever_dim: int = 384

def cosine_schedule(base: float, final: float, total_steps: int, step: int) -> float:
    """Cosine schedule from base to final over total_steps at step."""
    import math

    if total_steps <= 1:
        return final
    
    t = min(max(step, 0), total_steps - 1)
    cos_out = math.cos(math.pi * t / (total_steps - 1)) + 1
    return final + 0.5 * (base - final) * cos_out

def ema_update(teacher, student, momentum: float):
    """Exponential Moving Average (EMA) update of model parameters."""
    for param, ema_param in zip(teacher.parameters(), student.parameters()):
        ema_param.data.mul_(momentum).add_(param.data, alpha=1 - momentum)
