import json
import os
import pandas as pd

phase = "."

ANNOT_DIR_JSON = f"{phase}/annotations_json"
OUTPUT_DIR_JSON = f"{phase}/annotations_fhir_json"
FHIR_XLSX = "../oralCa_FHIR.xlsx"

os.makedirs(OUTPUT_DIR_JSON, exist_ok=True)

class_dict = {"Green": 1, "Yellow": 2, "Red": 3}

def load_fhir_table(xlsx_path):
    """
    Docstring for load_fhir_table
    
    :param xlsx_path: Description
    """
    df = pd.read_excel(xlsx_path)
    df["media_id"] = df["media_id"].astype(str)
    df = df.set_index("media_id")
    return df

def save_single_dataset_from_fhir(
    json_path,
    fhir_df,
    output_shape=(384, 512),
):
    dataset = {
        "image_name": "",
        "pathology_report": [],
        "boxes": [],
        "labels": [],
        "masks": [],
        "doctor_note": [],
        "patient_statement": []
    }

    image_id = os.path.splitext(os.path.basename(json_path))[0]

    if image_id not in fhir_df.index:
        print(f"[WARN] media_id {image_id} not found in excel, skipped")
        return None
    
    row = fhir_df.loc[image_id]

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    dataset["image_name"] = f"gs://oral-dinov3-data/annotations_fhir_images/{image_id}.png"

    print(f"[OK] {image_id} | polygons={len(data['polygons'])}")

    for poly, bbox in zip(data["polygons"], data["bboxes"]):

        label = class_dict.get(poly["label"], 0)
        mask = poly["points"]

        x_min, y_min, x_max, y_max = bbox["box"]
        H, W = output_shape

        cx = (x_min + x_max) / 2 / W
        cy = (y_min + y_max) / 2 / H
        w = (x_max - x_min) / W
        h = (y_max - y_min) / H

        dataset["labels"].append(label)
        dataset["boxes"].append([cx, cy, w, h])
        dataset["masks"].append(mask)

        dataset["doctor_note"].append(
            "" if pd.isna(row["doctor_note"]) else str(row["doctor_note"])
        )
        dataset["patient_statement"].append(
            "" if pd.isna(row["patient_statement"]) else str(row["patient_statement"])
        )
        dataset["pathology_report"].append(
            "" if pd.isna(row["pathology_report"]) else str(row["pathology_report"])
        )

    # no lesion fallback
    if len(dataset["labels"]) == 0:
        dataset["labels"].append(0)
        dataset["patient_statement"].append("no lesion")
    
    return dataset

if __name__ == "__main__":

    print("Loading FHIR Excel...")
    fhir_df = load_fhir_table(FHIR_XLSX)

    print("Start generating per-image dataset JSON...")
    for json_file in sorted(os.listdir(ANNOT_DIR_JSON)):
        if not json_file.endswith(".json"):
            continue

        json_path = os.path.join(ANNOT_DIR_JSON, json_file)

        dataset_json = save_single_dataset_from_fhir(
            json_path=json_path,
            fhir_df=fhir_df,
            output_shape=(384, 512)
        )

        if dataset_json is None:
            continue

        output_path = os.path.join(
            OUTPUT_DIR_JSON,
            json_file
        )

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(dataset_json, f, indent=2, ensure_ascii=False)

    print("Done. FHIR-based per-image dataset generated.")





