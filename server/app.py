import os

from utils.config import DINOv3Cfg
from flask import Flask
from server.api.service import infer_bp, init_bbox_model
# from api.infer import infer_bp, init_seg_model

# Cloud Run Job 我們剛剛設計是用「一個 JSON 字串當 args[0]」
print("Initializing app")
app = Flask(__name__)

# ---- load model once ----
print("Import cfg")
cfg = DINOv3Cfg()

print("Initialize model")
init_bbox_model(cfg)
# init_seg_model(cfg, "checkpoints/dinov3_seg_best.pth")

print("App blueprint registration")
app.register_blueprint(infer_bp)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)
