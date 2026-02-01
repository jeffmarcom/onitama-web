.PHONY: help dev build clean logs prod-deploy

.DEFAULT_GOAL := help

IMAGE_NAME = onitama-web
CONTAINER_NAME = onitama-web-container
PORT = 3000

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

dev: ## Run development environment locally with Docker
	@echo "Building Docker image..."
	docker build -t $(IMAGE_NAME) .
	@echo "Stopping any existing container..."
	-docker stop $(CONTAINER_NAME) 2>/dev/null || true
	-docker rm $(CONTAINER_NAME) 2>/dev/null || true
	@echo "Starting container..."
	docker run -d \
		--name $(CONTAINER_NAME) \
		-p $(PORT):3000 \
		-e JWT_SECRET=dev-local-secret-change-in-production \
		-v $(PWD)/data:/app/data \
		$(IMAGE_NAME)
	@echo "Onitama is running at http://localhost:$(PORT)"
	@echo "Use 'make logs' to view logs"

build: ## Build Docker image
	@echo "Building Docker image..."
	docker build -t $(IMAGE_NAME) .
	@echo "Build complete!"

clean: ## Stop and remove containers and images
	@echo "Stopping container..."
	-docker stop $(CONTAINER_NAME) 2>/dev/null || true
	@echo "Removing container..."
	-docker rm $(CONTAINER_NAME) 2>/dev/null || true
	@echo "Removing image..."
	-docker rmi $(IMAGE_NAME) 2>/dev/null || true
	@echo "Cleanup complete!"

logs: ## View container logs
	docker logs -f $(CONTAINER_NAME)

prod-deploy: ## TODO: Deploy to GCP Cloud Run
	@echo "TODO: Implement GCP Cloud Run deployment"
	@echo ""
	@echo "Steps to implement:"
	@echo "  1. Authenticate with GCP: gcloud auth login"
	@echo "  2. Set project: gcloud config set project YOUR_PROJECT_ID"
	@echo "  3. Build and push to Container Registry:"
	@echo "     docker build -t gcr.io/YOUR_PROJECT_ID/$(IMAGE_NAME) ."
	@echo "     docker push gcr.io/YOUR_PROJECT_ID/$(IMAGE_NAME)"
	@echo "  4. Deploy to Cloud Run:"
	@echo "     gcloud run deploy $(IMAGE_NAME) \\"
	@echo "       --image gcr.io/YOUR_PROJECT_ID/$(IMAGE_NAME) \\"
	@echo "       --platform managed \\"
	@echo "       --region us-central1 \\"
	@echo "       --allow-unauthenticated"
	@echo ""
	@echo "Note: Requires persistent storage solution (e.g., Cloud Storage or Cloud SQL)"
