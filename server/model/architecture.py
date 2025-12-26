import math
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision.models import resnet50
from transformers import AutoModel, AutoTokenizer
# from utils.func import box_iou
import timm
from utils.config import GroundDINOConfig, DINOv3Cfg, cosine_schedule, ema_update
from timm import create_model
import copy
from transformers import AutoModelForCausalLM

# **** GroundingDINO architecture components ****

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