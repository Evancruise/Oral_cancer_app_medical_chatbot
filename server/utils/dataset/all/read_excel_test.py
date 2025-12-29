import pandas as pd

excel_path = "oralCa_FHIR.xlsx"

df = pd.read_excel(excel_path)

cases = {}

for _, row in df.iterrows():
    record_id = str(row["record_id"])   # e.g. 000004_02
    print("record_id:", record_id)

    if "_" not in record_id:
        continue

    case_id, suffix = record_id.split("_")

    if case_id not in cases:
        cases[case_id] = {
            "main": None,       # _00
            "lesions": []       # _01 ~ _0x
        }
    if suffix == "00":
        cases[case_id]["main"] = row
    else:
        cases[case_id]["lesions"].append(row)

print("cases:", cases)

