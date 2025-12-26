import os
import random
import shutil
from pathlib import Path
import pandas as pd

# ==================
#       Config
# ==================

SRC_ROOT = Path("all")
JSON_SRC = SRC_ROOT / "annotations_fhir_json"
IMG_SRC = SRC_ROOT / "annotations_fhir_images"
EXCEL_PATH = "oralCa_FHIR.xlsx"
OUTPUT_EXCEL_PATH = "oralCa_FHIR_split.xlsx"

DST_ROOT = Path(".")
# OUTPUT_DIR = Path("xlsx_split")

SPLIT_RATIO = {
    "train": 0.7,
    "val": 0.15,
    "test": 0.15
}

IMAGE_EXTS = [".png", ".jpg", ".jpeg"]

RANDOM_SEED = 42
COPY_FILES = True

# ===================
#       Utils
# ===================
def find_json(image_name: str):
    stem = Path(image_name).stem
    json_path = JSON_SRC / f"{stem}.json"
    if json_path.exists():
        return json_path
    return None

def find_image(json_name: str):
    stem = Path(json_name).stem
    for ext in IMAGE_EXTS:
        img_path = IMG_SRC / f"{stem}{ext}"
        if img_path.exists():
            return img_path
    return None

# ===================
#       Main
# ===================
def main():
    random.seed(RANDOM_SEED)

    # ==== Load excel ====
    df = pd.read_excel(EXCEL_PATH)
    print(f"Loaded Excel rows: {len(df)}")

    # ==== Load IMG files ====
    img_files = sorted([f for f in os.listdir(IMG_SRC) if f.endswith(".png")])
    print(f"Loaded IMG files: {len(img_files)}")

    # ===== shuffle =====
    random.shuffle(img_files)

    n_total = len(img_files)
    n_train = int(n_total * SPLIT_RATIO["train"])
    n_val = int(n_total * SPLIT_RATIO["val"])

    split_ids = {
        "train": set(img_files[:n_train]),
        "val": set(img_files[n_train:n_train+n_val]),
        "test": set(img_files[n_train+n_val:])
    }

    print("split_ids:", split_ids)

    # ---- helper ----
    def extract_stem(x):
        if pd.isna(x):
            return None
        return Path(str(x)).name.split(".")[0] + ".png"

    # 用暫時變數，不寫回 excel
    df["_stem"] = df["media_url"].apply(extract_stem)
    print(f"df[\"_stem\"]:", df["_stem"].head())

    # ---- write to multiple sheets ----
    with pd.ExcelWriter(OUTPUT_EXCEL_PATH, engine="openpyxl") as writer:
        for split, id_set in split_ids.items():
            df_split = df[df["_stem"].isin(id_set)].copy()
            print(f"[{split}] copy rows: {len(df_split)}")

            if len(df_split) == 0:
                raise RuntimeError(f"{split} sheet is empty – check split key mapping")

            df_split.drop(columns="_stem", inplace=True)
            df_split.to_excel(writer, sheet_name=split, index=False)

    print(f"\nExcel saved as: {OUTPUT_EXCEL_PATH}")

    '''
    split_ids = {
        "train": set(json_files[:n_train]),
        "val": set(json_files[n_train:n_train+n_val]),
        "test": set(json_files[n_train+n_val:])
    }

    # OUTPUT_DIR.mkdir(exist_ok=True)

    # ===== helper: extract stem ====
    def extract_stem(json_name: str):
        return Path(json_name).stem
    
    # ===== add stem column =====
    df["_stem"] = df["image_name"].astype(str)

    # ===== create dirs =====
    for split in split_ids:
        (DST_ROOT / split / "annotations_fhir_json").mkdir(parents=True, exist_ok=True)
        (DST_ROOT / split / "annotations_fhir_images").mkdir(parents=True, exist_ok=True)

    # ===== split and save =====
    for split, id_set in split_ids.items():
        df_split = df[df["_stem"].isin(id_set)].drop(columns="_stem")
        out_path = DST_ROOT / split / f"oralCa_FHIR_{split}.xlsx"
        df_split.to_excel(out_path, index=False)
        print(f"[{split.upper()}] Saved {len(df_split)} rows to {out_path}")
    
    print("\nExcel split completed.")
    '''

    # ===== Verify (Split sanity check) =====
    for split, id_set in split_ids.items():
        matched = df["_stem"].isin(id_set).sum()
        if matched == 0:
            raise RuntimeError(f"No rows matched for split: {split}")

    # ===== Copy / move =====
    for split, files in split_ids.items():
        print(f"\n[{split.upper()}] {len(files)} samples")
        delete_flag = False
    
        for img_name in files:
            json_src = find_json(img_name)
            img_src = IMG_SRC / img_name

            if json_src is None:
                print(f"Missing JSON for {img_name}")
                continue
                
            json_dst = DST_ROOT / split / "annotations_fhir_json"
            img_dst = DST_ROOT / split / "annotations_fhir_images"

            if (json_dst.exists() or img_dst.exists()) and not delete_flag:
                files = list(json_dst.iterdir())
                if files:
                    print(f"[CLEAN] Removing {len(files)} files from {json_dst}")
                    for f in files:
                        if f.is_file():
                            f.unlink()
                else:
                    print(f"[OK] {json_dst} exists but empty")

                img_files = list(img_dst.iterdir())
                if img_files:
                    print(f"[CLEAN] Removing {len(img_files)} files from {img_dst}")
                    for f in img_files:
                        if f.is_file():
                            f.unlink()
                else:
                    print(f"[OK] {img_dst} exists but empty")
                
                delete_flag = True
            else:
                json_dst.mkdir(parents=True, exist_ok=True)
                print(f"[CREATE] {json_dst}")

                img_dst.mkdir(parents=True, exist_ok=True)
                print(f"[CREATE] {img_dst}")

            if COPY_FILES:
                shutil.copy2(json_src, json_dst / json_src.name)
                shutil.copy2(img_src, img_dst / img_src.name)
                print(f"[COPY] {json_src} and image copied to {split} set")
            else:
                shutil.move(json_src, json_dst / json_src.name)
                shutil.move(img_src, img_dst / img_src.name)
                print(f"[MOVE] {json_src} and image moved to {split} set")

    print("\nDataset split completed.")
    
if __name__ == "__main__":
    main()