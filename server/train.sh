#!/bin/bash

# ====== PROJECT SETTINGS ========
PROJECT_ID="Oral-cancer-ai"
REGION="asia-east1"
REPO_NAME="oral-models"
IMAGE_NAME="dinov3"
TAG="v1"

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${IMAGE_NAME}:${TAG}"

echo "=== Launching Vertex AI Training Job ==="

JOB_NAME="dinov3-train-${date +%Y%m%d-%H%M%S}"

gcloud ai custom-jobs create \
    --region=$REGION \
    --display-name=$JOB_NAME \
    --worker-pool-spec=machine-type=g2-standard-8,accelerator-type=nvidia-14,accelerator-count=1,container-image-uri=$IMAGE_URI \
    --args="--phase=train,--num_epochs=10"

echo "=== DONE: Job Submitted ==="