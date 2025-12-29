import pandas as pd
import json
import base64
from datetime import datetime

# === Setup ===
EXCEL_PATH = "oralCa_with_patient_statements_english.xlsx"
OUTPUT_JSON = "oral_cancer_fhir_bundle.json"

# === image base URL ===
IMAGE_BASE_URL = "https://example.org/images"

# === basic information ===
GENDER_MAP = {
    "M": "male",
    "F": "female",
    "Male": "male",
    "Female": "female",
    "男": "male",
    "女": "female"
}

def normalize_gender(value):
    if pd.isna(value):
        return "unknown"
    
    v = str(value).strip()
    return GENDER_MAP.get(v, "unknown")

def normalize_date(value):
    if pd.isna(value):
        return None

    # if datetime, convert to ISO format
    if isinstance(value, datetime):
        return value.date().isoformat()
    
    try:
        return pd.to_datetime(value).date().isoformat()
    except Exception:
        return str(value)

def main():
    df = pd.read_excel(EXCEL_PATH)

    # 去掉欄位名的空白 / 換行
    df.columns = df.columns.str.strip()

    print("Columns:", df.columns.tolist())

    patients = {}
    encounters = {}
    media_list = []
    observations = []
    conditions = []
    documents = []

    for idx, row in df.iterrows():
        # ---------- Patient ----------
        pid = str(row.get("PID"))
        if pid not in patients:
            patient = {
                "resourceType": "Patient",
                "id": pid,
                "identifier": [{
                    "system": "http://example.org/fhir/pid",
                    "value": pid
                }],
                "gender": normalize_gender(row.get("sex\n")),
            }
            patients[pid] = patient
        
        # ---------- Encounter ----------
        encounter_date = normalize_date(row.get("date"))
        enc_key = (pid, encounter_date)

        if enc_key not in encounters:
            enc_id = f"enc-{pid}-{encounter_date}" if encounter_date else f"enc-{pid}-{idx}"
            encounter = {
                "resourceType": "Encounter",
                "id": enc_id,
                "subject": {"reference": f"Patient/{pid}"},
                "period": {}
            }

            if encounter_date:
                encounter["peroid"]["start"] = encounter_date
            
            encounters[enc_key] = encounter
        else:
            enc_id = encounters[enc_key]["id"]
        
        # ---------- Media ----------
        pk_l = str(row.get("PK_L"))
        media_id = pk_l

        media = {
            "resourceType": "Media",
            "id": media_id,
            "type": "image",
            "subject": {"reference": f"Patient/{pid}"},
            "encounter": {"reference": f"Encounter/{enc_id}"},
            "content": {
                "url": f"{IMAGE_BASE_URL}/{pk_l}.jpg"
            }
        }

        view = row.get("view")
        if not pd.isna(view):
            media["view"] = {"text": str(view)}

        location = row.get("location")
        if not pd.isna(location):
            media["bodySite"] = {"text": str(location)}

        media_list.append(media)

        # ---------- Observation ----------
        obs_id = f"obs-{pk_l}"

        gross_path = row.get("gross pathology")
        doctor_note = row.get("Doctor's Note")
        patient_statement = row.get("Patient Statement")

        observation = {
            "resourceType": "Observation",
            "id": obs_id,
            "status": "final",
            "subject": {"reference": f"Patient/{pid}"},
            "encounter": {"reference": f"Encounter/{enc_id}"},
            "derivedFrom": [{"reference": f"Media/{media_id}"}],
            "code": {
                "coding": [{
                    "system": "http://loinc.org",
                    "code": "57852-6",
                    "display": "Oral mucosal lesion observation"
                }],
                "text": "Oral lesion clinical observation"
            }
        }

        # ----------- Gross Pathology ----------
        if not pd.isna(gross_path):
            observation["valueString"] = str(gross_path)
        
        # ---------- note: Doctor suggestion and label details ----------
        notes = []

        if not pd.isna(doctor_note):
            notes.append({"text": f"Doctor's Note: {doctor_note}"})
        
        # ---------- Data Quality Check ----------
        need_fix = row.get("需修正")
        fixed_flag = row.get("修正與否")
        excluded = row.get("先排除")
        case_note = row.get("病例報告")

        if not pd.isna(need_fix):
            notes.append({"text": f"需修正: {need_fix}"})
        if not pd.isna(fixed_flag):
            notes.append({"text": f"修正與否: {fixed_flag}"})
        if not pd.isna(excluded):
            notes.append({"text": f"先排除: {excluded}"})
        if not pd.isna(case_note):
            notes.append({"text": f"病例報告: {case_note}"})
        
        if notes:
            observation["note"] = notes

        # ---------- Patient Statement ----------
        if not pd.isna(patient_statement):
            observation.setdefault("component", []).append({
                "code": {
                    "text": "Patient Statement"
                },
                "valueString": str(patient_statement)
            })

        observations.append(observation)

        # ---------- Condition (Diagnosis) ----------
        histopath = row.get("histopathology")
        path_report = row.get("Pathology Report")

        if (not pd.isna(histopath)) or (not pd.isna(path_report)):
            cond_id = f"cond-{pk_l}"
        
            # text for ICD-10 / SNOMED code 
            code_text_parts = []

            if not pd.isna(histopath):
                code_text_parts.append(str(histopath))
            if not pd.isna(path_report):
                code_text_parts.append(str(path_report))
            
            condition = {
                "resourceType": "Condition",
                "id": cond_id,
                "subject": {"reference": f"Patient/{pid}"},
                "encounter": {"reference": f"Encounter/{enc_id}"},
                "code": {
                    "text": " | ".join(code_text_parts)
                }
            }

            conditions.append(condition)
        
        # ---------- DocumentReference (Pathology Report) ----------
        if not pd.isna(path_report):
            doc_id = f"doc-{pk_l}"
            text_str = str(path_report)
            data_encoded = base64.b64encode(text_str.encode("utf-8")).decode("utf-8")

            document = {
                "resourceType": "DocumentReference",
                "id": doc_id,
                "status": "current",
                "subject": {"reference": f"Patient/{pid}"},
                "content": [{
                    "attachment": {
                        "contentType": "text/plain",
                        "data": data_encoded
                    }
                }],
                "description": "Pathology Report"
            }

            documents.append(document)
    
    # ---------- FHIR bundle ---------
    all_resources = (
        list(patients.values())
        + list(encounters.values())
        + media_list
        + observations
        + conditions
        + documents
    )

    bundle = {
        "resourceType": "Bundle",
        "type": "collection",
        "entry": [{"resource": r} for r in all_resources]
    }

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False, indent=2)
    
    print(f"FHIR Bundle 已輸出到: {OUTPUT_JSON}")
    print(f"Patients: {len(patients)}, Encounters: {len(encounters)}, "
          f"Media: {len(media_list)}, Observations: {len(observations)}, "
          f"Conditions: {len(conditions)}, Documents: {len(documents)}")

if __name__ == "__main__":
    main()

