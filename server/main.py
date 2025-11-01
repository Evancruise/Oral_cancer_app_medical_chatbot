import os
import torch
import json
from torch.utils.data import DataLoader
from model.architecture import GroundingDINO, OralDINOv3 as DINOv3, DINOv3ToLLMAdapter
from utils.config import GroundDINOConfig, DINOv3Cfg
from utils.func import build_retriever_index
from transformers import AutoModelForCausalLM, AutoTokenizer, AutoModel
from utils.dataset import ReferenceDataset
from model.train import grounddino_train_val, dinov3_train_val
from model.inference import grounddino_inference, dinov3_inference
import argparse

# from utils.dataset import GroundJsonlDataset, collate_fn
# from utils.func import preprocess
# from model.load import load_grounding_dino, set_trainable_backbone
from utils.dataset import OralDataset, collate_fn

if __name__ == "__main__":

    parser = argparse.ArgumentParser(description="argparse example + __main__")
    parser.add_argument("--num_epochs", type=int, default=5, help="Number of training epochs")
    parser.add_argument("--phase", type=str, default="train", help="Phase (train or inference)")
    parser.add_argument("--model", type=str, default="DINOv3", help="Model type to use")
    parser.add_argument("--checkpoint_path", type=str, default="checkpoints/dinov3_best_model.pth", help="Path to model checkpoint for testing")
    parser.add_argument("--optimizer_type", type=str, default="AdamW", help="Type of optimizer to use")
    parser.add_argument("--lr", type=float, default=1e-4, help="Learning rate")
    parser.add_argument("--weight_decay", type=float, default=1e-4, help="Weight decay for optimizer")
    args = parser.parse_args()

    # CFG_PATH = "GroundingDINO_Swin_OGC.cfg.py"
    # CKPT_PATH = "weights/GroundingDINO_Swim_ODC.pth"
    ANNOT_PATH_TRAIN = "./utils/dataset/all/annotations_normalized.json"
    ANNOT_PATH_VAL = "./utils/dataset/all/annotations_normalized_val.json"

    num_epochs = args.num_epochs
    phase = args.phase  # "train" or "test"
    model = args.model
    checkpoint_path = args.checkpoint_path
    optimizer_type = args.optimizer_type
    lr = args.lr
    weight_decay = args.weight_decay

    os.makedirs("checkpoints", exist_ok=True)

    # 讀取標註
    with open(ANNOT_PATH_TRAIN, "r") as f:
        train_data_list = json.load(f)

    with open(ANNOT_PATH_VAL, "r") as f:
        val_data_list = json.load(f)

    # 建立 dataset
    train_dataset = OralDataset(train_data_list, augmentation=True)
    val_dataset = OralDataset(val_data_list, augmentation=False) if val_data_list else None
    test_dataset = OralDataset(val_data_list, augmentation=False) if val_data_list else None

    print(f"Train Dataset size: {len(train_dataset)} samples")
    print(f"Val Dataset size: {len(val_dataset)} samples")

    # 建立 dataloader
    train_loader = DataLoader(train_dataset, batch_size=2, shuffle=True, num_workers=1, collate_fn=collate_fn)
    val_loader = DataLoader(val_dataset, batch_size=2, shuffle=True, num_workers=1, collate_fn=collate_fn)

    # 初始化模型
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Using device: {device}")

    best_val_loss = float("inf")

    if model == "GroundingDINO":
        cfg = GroundDINOConfig()
        model = GroundingDINO(cfg).to(device)

        if phase == "train":
            
            if optimizer_type == "AdamW_partial":
                optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=lr, weight_decay=weight_decay)
            else:
                optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)

            grounddino_train_val(model, train_loader, val_loader, optimizer, num_epochs, device)
        
        elif phase == "inference":
            test_loader = DataLoader(test_dataset, batch_size=2, shuffle=False)
            grounddino_inference(model, test_loader, checkpoint_path="checkpoints/groundingdino_best_model.pth", device=device)

    if model == "DINOv3":
        cfg = DINOv3Cfg()
        model = DINOv3(cfg).to(device)

        # For retrieval & embedding alignment
        enc_tokenizer = AutoTokenizer.from_pretrained("sentence-transformers/all-MiniLM-L6-v2")
        enc_model = AutoModel.from_pretrained("sentence-transformers/all-MiniLM-L6-v2").to(device)

        # For report generation
        llm_tokenizer = AutoTokenizer.from_pretrained("HuggingFaceTB/SmolLM-135M-Instruct") # sentence-transformers/all-MiniLM-L6-v2
        llm = AutoModelForCausalLM.from_pretrained(
            "HuggingFaceTB/SmolLM-135M-Instruct",
            torch_dtype=torch.float16,
            device_map="auto"
        )

        if llm_tokenizer.pad_token is None:
            llm_tokenizer.pad_token = llm_tokenizer.eos_token

        # llm.resize_token_embeddings(len(llm_tokenizer))

        adapter = DINOv3ToLLMAdapter(llm_hidden_dim=llm.config.hidden_size)

        if phase == "train":
            
            # 建立 retriever index
            reference_dataloader = ReferenceDataset(train_data_list, tokenizer_name=cfg.text_model_name, image_size=cfg.img_size) # fetch "notes" in train_data_list
            
            teacher_index, teacher_meta = build_retriever_index(enc_model, enc_tokenizer, reference_dataloader, device)

            if optimizer_type == "AdamW_partial":
                optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=lr, weight_decay=weight_decay)
            else:
                optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)

            dinov3_train_val(model, llm, llm_tokenizer, adapter, train_loader, val_loader, optimizer, num_epochs, device, teacher_index, teacher_meta)
        
        elif phase == "inference":
            test_loader = DataLoader(test_dataset, batch_size=2, shuffle=False)
            dinov3_inference(model, test_loader, checkpoint_path="checkpoints/dinov3_best_model.pth", device=device)
    # else:
    #     model.load_state_dict(torch.load(checkpoint_path, map_location=device))
