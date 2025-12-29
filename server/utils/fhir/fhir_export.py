import uuid
from datetime import datetime
import base64

def _uuid():
    return str(uuid.uuid4())

def dino_bbox_to_observation(
    patient_id,
    media_id,
    box_pixel,
    label,
    score
):
    return {
        "resourceType": "Observation",
        "id": _uuid(),
        "status": "final",
        "category": [{
            "coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                "code": "imaging"
            }]
        }],
        "code": {
            "coding": [{
                "system": "urn:oralai:dino",
                "code": "lesion-bbox",
                "display": "AI detected oral lesion"
            }]
        },
        "subject": {
            "reference": f"Patient/{patient_id}"
        },
        "derivedFrom": [{
            "reference": f"Media/{media_id}"
        }],
        "component": [
            {
                "code": {"text": "x_min"},
                "valueQuantity": {"value": box_pixel["x_min"], "unit": "px"}
            },
            {
                "code": {"text": "y_min"},
                "valueQuantity": {"value": box_pixel["y_min"], "unit": "px"}
            },
            {
                "code": {"text": "x_max"},
                "valueQuantity": {"value": box_pixel["x_max"], "unit": "px"}
            },
            {
                "code": {"text": "y_max"},
                "valueQuantity": {"value": box_pixel["y_max"], "unit": "px"}
            },
            {
                "code": {"text": "risk_level"},
                "valueCodeableConcept": {
                    "text": label
                }
            },
            {
                "code": {"text": "confidence"},
                "valueQuantity": {
                    "value": score,
                    "unit": "probability"
                }
            }
        ]
    }

def yolo_to_pixel(box, img_w, img_h):
    cx, cy, w, h = box
    x_min = max(0, (cx - w / 2) * img_w)
    y_min = max(0, (cy - h / 2) * img_h)
    x_max = min(img_w, (cx + w / 2) * img_w)
    y_max = min(img_h, (cy + h / 2) * img_h)

    return {
        "x_min": round(x_min, 2),
        "y_min": round(y_min, 2),
        "x_max": round(x_max, 2),
        "y_max": round(y_max, 2)
    }

def results_to_fhir_bundle(results, organization_name="OralAI"):
    """
    Convert inference results to a FHIR Bundle (R4).

    Args:
        results: List[dict] from dinov3_student_inference
        organization_name: Name of AI system / org

    Returns:
        dict: FHIR Bundle JSON
    """

    bundle = {
        "resourceType": "Bundle",
        "type": "collection",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "entry": []
    }

    for r in results:
        # ----------------------------
        # IDs
        # ----------------------------
        patient_id = _uuid()
        report_id = _uuid()
        obs_id = _uuid()
        media_id = _uuid()

        # ----------------------------
        # Patient (minimal, de-identified)
        # ----------------------------
        patient = {
            "resourceType": "Patient",
            "id": patient_id,
            "identifier": [{
                "system": "urn:oralai:sample-id",
                "value": r.get("sample_id", "unknown")
            }]
        }

        # ----------------------------
        # Media (oral image)
        # ----------------------------
        media = {
            "resourceType": "Media",
            "id": media_id,
            "status": "completed",
            "type": {
                "coding": [{
                    "system": "http://terminology.hl7.org/CodeSystem/media-type",
                    "code": "image"
                }]
            },
            "subject": {
                "reference": f"Patient/{patient_id}"
            },
            "content": {
                "url": r.get("image_uri", "")
            }
        }

        # ----------------------------
        # Observation (patient + doctor text)
        # ----------------------------
        observation = {
            "resourceType": "Observation",
            "id": obs_id,
            "status": "final",
            "category": [{
                "coding": [{
                    "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                    "code": "clinical-note"
                }]
            }],
            "code": {
                "text": "Patient statement and clinician note"
            },
            "subject": {
                "reference": f"Patient/{patient_id}"
            },
            "valueString": (
                "[Patient Statement] "
                + r["input"]["patient_statement"]
                + "\n[Doctor's Note] "
                + r["input"]["doctor_note"]
            )
        }

        encoded = base64.b64encode(
            r["output"]["generated_report"].encode("utf-8")
        ).decode("utf-8")

        # ----------------------------
        # DiagnosticReport (AI output)
        # ----------------------------
        diagnostic_report = {
            "resourceType": "DiagnosticReport",
            "id": report_id,
            "status": "final",
            "category": [{
                "coding": [{
                    "system": "http://terminology.hl7.org/CodeSystem/v2-0074",
                    "code": "PAT"
                }]
            }],
            "code": {
                "coding": [{
                    "system": "http://loinc.org",
                    "code": "33747-0",
                    "display": "Oral pathology report"
                }]
            },
            "subject": {
                "reference": f"Patient/{patient_id}"
            },
            "media": [{
                "reference": f"Media/{media_id}"
            }],
            "conclusion": r["output"]["generated_report"],
            "presentedForm": [{
                "contentType": "text/plain",
                "data": encoded
            }]
        }

        # ----------------------------
        # (Optional) Confidence as Observation
        # ----------------------------
        if "confidence" in r.get("output", {}):
            conf_obs = {
                "resourceType": "Observation",
                "id": _uuid(),
                "status": "final",
                "code": {
                    "text": "AI confidence score"
                },
                "valueQuantity": {
                    "value": r["output"]["confidence"],
                    "unit": "probability"
                },
                "subject": {
                    "reference": f"Patient/{patient_id}"
                }
            }
            bundle["entry"].append({"resource": conf_obs})

        bbox_obs = []

        for box, label, score in zip(
                r["dino"]["boxes"],
                r["dino"]["labels"],
                r["dino"]["scores"]
            ):
            box_px = yolo_to_pixel(box, 512, 384)

            bbox_ob = dino_bbox_to_observation(
                patient_id=patient_id,
                media_id=media_id,
                box_pixel=box_px,
                label=label,
                score=score
            )

            bbox_obs.append(bbox_ob)

        for bbox_ob in bbox_obs:
            bundle["entry"].append({"resource": bbox_ob})

        # ----------------------------
        # Add to bundle
        # ----------------------------
        bundle["entry"].extend([
            {"resource": patient},
            {"resource": media},
            {"resource": observation},
            {"resource": diagnostic_report},
            {"resource": bbox_obs}
        ])

    return bundle
