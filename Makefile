.PHONY: help dev build clean logs deploy

.DEFAULT_GOAL := help

# Load environment variables from .env file if it exists
-include .env
export

IMAGE_NAME ?= onitama-web
CONTAINER_NAME ?= onitama-web-container
PORT ?= 3000
GCP_PROJECT ?=
GCP_REGION ?=

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

deploy: ## Deploy to GCP Cloud Run (publicly accessible)
	@if [ -z "$(GCP_PROJECT)" ]; then \
		echo "Error: GCP_PROJECT is not set. Please create a .env file (see .env.example)."; \
		exit 1; \
	fi
	@if [ -z "$(GCP_REGION)" ]; then \
		echo "Error: GCP_REGION is not set. Please create a .env file (see .env.example)."; \
		exit 1; \
	fi
	@echo "Deploying to Cloud Run..."
	@echo "Project: $(GCP_PROJECT)"
	@echo "Region: $(GCP_REGION)"
	@echo ""
	@echo "Note: This will create a publicly accessible URL."
	@echo "Data will reset on each deployment (file-based storage)."
	@echo ""
	gcloud run deploy $(IMAGE_NAME) \
		--source . \
		--region $(GCP_REGION) \
		--project $(GCP_PROJECT) \
		--allow-unauthenticated \
		--timeout=3600 \
		--max-instances=1 \
		--min-instances=0 \
		--concurrency=80 \
		--set-env-vars JWT_SECRET=$$(openssl rand -base64 32)
	@echo ""
	@echo "Deployment complete! Your app is publicly accessible at the URL above."
