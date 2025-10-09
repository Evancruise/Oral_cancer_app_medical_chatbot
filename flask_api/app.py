# app.py
from flask import Flask, request, jsonify
from PIL import Image
from transformers import AutoModel, AutoProcessor
from langchain import LLMChain, PromptTemplate
import threading, time, uuid
import os

app = Flask(__name__)

model = AutoModel.from_pretrained("facebook/dinov2-base")
processor = AutoProcessor.from_pretrained("facebook/dinov2-base")
tasks_list = {}

def run_inference(task_id, images_path_list):
    '''
    inputs = processor(images=image, return_tensors="pt")
    features = model(**inputs).last_hidden_state.mean(dim=1)

    prompt = PromptTemplate.from_template(
        "Describe possible oral lesion findings from this embedding vector."
    )
    llm_chain = LLMChain(llm=..., prompt=prompt)
    report = llm_chain.run(features.tolist())

    return jsonify({
        "risk_level": "moderate",
        "report": report
    })
    '''

    stages = [
        ("Loading model weights...", 10),
        ("Extracting DINOv2 features...", 40),
        ("Analyzing lesion patterns...", 70),
        ("Generating LangChain report...", 100)
    ]

    tasks_list[task_id] = {"status": "running", "progress": 0, "stage": "Starting..."}

    try:
        for stage, progress in stages:
            tasks_list[task_id]["stage"] = stage
            for i in range(tasks_list[task_id]["progress"], progress, 5):
                tasks_list[task_id]["progress"] = i
                time.sleep(0.6)
        tasks_list[task_id]["progress"] = 100
        tasks_list[task_id]["stage"] = "Completed"
        tasks_list[task_id]["status"] = "completed"
        tasks_list[task_id]["result"] = {
            "risk_level": "moderate",
            "report": "Lesion detected on right buccal mucosa."
        }
    except Exception as e:
        tasks_list[task_id]["status"] = "failed"
        tasks_list[task_id]["error"] = str(e)

@app.route("/api/predict", methods=["POST"])
def predict():
    form = request.form

    print("------ [Flask] Headers ------")
    print(dict(request.headers), flush=True)
    
    print("------ [Flask] Form Keys ------")
    print(list(request.form.keys()), flush=True)
    
    print("------ [Flask] File Keys ------")
    print(list(request.files.keys()), flush=True)

    print("------ [Flask] Form Data ------", form, flush=True)
    for key, value in request.form.items():
        print(f"{key}: {value}", flush=True)

    images_path_list = []

    for i in range(1, 9):
        if f"pic{i}" in request.files:
            f = request.files[f"pic{i}"]
            save_path = os.path.join("uploads", f.filename)
            images_path_list.append(save_path)
        elif f"pic{i}" in request.form:
            images_path_list.append(request.form[f"pic{i}"])
        else:
            images_path_list.append(None)
    
    print("------ [Flask] images_path_list ------", images_path_list, flush=True)

    task_id = str(uuid.uuid4())

    print("------ [Flask] task_id ------", task_id, flush=True)
    
    threading.Thread(target=run_inference, args=(task_id, images_path_list)).start()
    # run_inference(task_id, images_path_list)
    return jsonify({ "status": "ok", "task_id": task_id })

@app.route("/api/status/<task_id>", methods=["GET"])
def status(task_id):
    task = tasks_list.get(task_id, {"status": "not_found"})
    return jsonify(task)

if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True, port=5001)