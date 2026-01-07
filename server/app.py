import os
from utils.config import DINOv3Cfg
from utils.func import download_from_gcs
from flask import Flask
from api.infer import infer_bp, init_bbox_model
# from api.infer import infer_bp, init_seg_model

# Cloud Run Job 我們剛剛設計是用「一個 JSON 字串當 args[0]」
app = Flask(__name__)

# ---- load model once ----
cfg = DINOv3Cfg()

'''
MODEL_DIR = "/tmp/models"   # Cloud Run 可寫
BUCKET = "oral-dino-assets"
BBOX_MODEL = "models/dinov3_bbox_best.pth"

download_from_gcs(BUCKET, BBOX_MODEL, f"{MODEL_DIR}/bbox.pth")
init_bbox_model(cfg)
'''

init_bbox_model(cfg)
# init_seg_model(cfg, "checkpoints/dinov3_seg_best.pth")

app.register_blueprint(infer_bp)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)