.PHONY: help dev build clean logs deploy doks-setup doks-push doks-deploy doks-status doks-loadtest doks-reset doks-teardown destroy

.DEFAULT_GOAL := help

# Load environment variables from .env file if it exists
-include .env
export

IMAGE_NAME ?= onitama-web
CONTAINER_NAME ?= onitama-web-container
PORT ?= 3000
GCP_PROJECT ?=
GCP_REGION ?=

# ── DigitalOcean / DOKS configuration ────────────────────────────────────────
DO_REGISTRY ?= onitama
DO_CLUSTER_NAME ?= onitama-cluster
DO_REGION ?= sfo3
DO_NODE_SIZE ?= s-2vcpu-2gb
DO_NODE_COUNT ?= 2
DO_NODE_MAX ?= 4
HELM_RELEASE ?= onitama
K8S_NAMESPACE ?= onitama

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

dev: ## Run development environment (app + Postgres + Redis)
	@echo "Starting services with Docker Compose..."
	docker compose up --build -d
	@echo "Onitama is running at http://localhost:3000"
	@echo "Use 'make logs' to view logs"

build: ## Build Docker image
	@echo "Building Docker image..."
	docker build -t $(IMAGE_NAME) .
	@echo "Build complete!"

clean: ## Stop and remove containers and images
	@echo "Stopping services..."
	docker compose down --rmi local --volumes --remove-orphans 2>/dev/null || true
	@echo "Cleanup complete!"

logs: ## View container logs
	docker compose logs -f

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

# ── DigitalOcean Kubernetes (DOKS) targets ───────────────────────────────────

doks-setup: ## Create DOKS cluster and container registry
	@echo "Creating container registry $(DO_REGISTRY)..."
	-doctl registry create $(DO_REGISTRY) --subscription-tier starter 2>/dev/null || true
	@echo "Creating DOKS cluster $(DO_CLUSTER_NAME) in $(DO_REGION)..."
	doctl kubernetes cluster create $(DO_CLUSTER_NAME) \
		--region $(DO_REGION) \
		--auto-upgrade \
		--node-pool "name=default;size=$(DO_NODE_SIZE);count=$(DO_NODE_COUNT);auto-scale=true;min-nodes=$(DO_NODE_COUNT);max-nodes=$(DO_NODE_MAX)"
	@echo "Connecting registry to cluster..."
	doctl registry kubernetes-manifest | kubectl apply -f -
	@echo "Installing metrics-server for HPA..."
	doctl kubernetes 1-click install $$(doctl kubernetes cluster list --format ID --no-header) --1-clicks metrics-server
	@echo ""
	@echo "Cluster ready! Run 'make doks-push' next."

doks-push: ## Build and push images to DigitalOcean Container Registry
	@echo "Logging into registry..."
	doctl registry login
	@echo "Building and pushing app image..."
	docker build --platform linux/amd64 -t registry.digitalocean.com/$(DO_REGISTRY)/onitama:web .
	docker push registry.digitalocean.com/$(DO_REGISTRY)/onitama:web
	@echo "Building and pushing load generator image..."
	docker build --platform linux/amd64 -t registry.digitalocean.com/$(DO_REGISTRY)/onitama:loadgen ./loadgenerator
	docker push registry.digitalocean.com/$(DO_REGISTRY)/onitama:loadgen
	@echo ""
	@echo "Images pushed! Run 'make doks-deploy' next."

doks-deploy: ## Deploy to DOKS via Helm
	@echo "Creating namespace $(K8S_NAMESPACE)..."
	kubectl create namespace $(K8S_NAMESPACE) 2>/dev/null || true
	@echo "Copying registry credentials to namespace..."
	doctl registry kubernetes-manifest | sed 's/namespace: kube-system/namespace: $(K8S_NAMESPACE)/' | kubectl apply -n $(K8S_NAMESPACE) -f -
	@echo "Deploying with Helm..."
	helm upgrade --install $(HELM_RELEASE) ./chart/onitama \
		--namespace $(K8S_NAMESPACE) \
		--set secrets.jwtSecret=$$(openssl rand -base64 32) \
		--set secrets.loadTestKey=$$(openssl rand -base64 16) \
		--set image.repository=registry.digitalocean.com/$(DO_REGISTRY)/onitama \
		--set image.tag=web \
		--set loadgenerator.image.repository=registry.digitalocean.com/$(DO_REGISTRY)/onitama \
		--set loadgenerator.image.tag=loadgen \
		--wait --timeout 5m
	@echo ""
	@echo "Deployment complete!"
	@echo "Waiting for Load Balancer IP..."
	@kubectl get svc -n $(K8S_NAMESPACE) onitama -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null; echo ""
	@echo "App available at: http://$$(kubectl get svc -n $(K8S_NAMESPACE) onitama -o jsonpath='{.status.loadBalancer.ingress[0].ip}')"

doks-status: ## Show cluster status (pods, services, HPA)
	@echo "=== Pods ==="
	kubectl get pods -n $(K8S_NAMESPACE) -o wide
	@echo ""
	@echo "=== Services ==="
	kubectl get svc -n $(K8S_NAMESPACE)
	@echo ""
	@echo "=== HPA ==="
	kubectl get hpa -n $(K8S_NAMESPACE)
	@echo ""
	@echo "=== Nodes ==="
	kubectl get nodes

doks-loadtest: ## Enable the load generator to simulate traffic
	@echo "Enabling load generator (50 concurrent users)..."
	helm upgrade $(HELM_RELEASE) ./chart/onitama \
		--namespace $(K8S_NAMESPACE) \
		--reuse-values \
		--set loadgenerator.enabled=true \
		--set loadgenerator.concurrentUsers=50 \
		--set loadgenerator.rampUpSeconds=120
	@echo ""
	@echo "Load generator deployed. Watch autoscaling with:"
	@echo "  kubectl get hpa -w"

doks-reset: ## Disable load generator and reset scaling to defaults
	@echo "Disabling load generator and resetting scaling..."
	helm upgrade $(HELM_RELEASE) ./chart/onitama \
		--namespace $(K8S_NAMESPACE) \
		--reuse-values \
		--set loadgenerator.enabled=false
	@echo ""
	@echo "Load generator disabled. Pods will scale down after stabilization window (5m)."

doks-teardown: ## Delete DOKS cluster and registry to stop billing
	@echo "Uninstalling Helm release..."
	-helm uninstall $(HELM_RELEASE) --namespace $(K8S_NAMESPACE) 2>/dev/null || true
	@echo "Deleting cluster $(DO_CLUSTER_NAME)..."
	-doctl kubernetes cluster delete $(DO_CLUSTER_NAME) --force 2>/dev/null || true
	@echo "Deleting registry $(DO_REGISTRY)..."
	-doctl registry delete --force 2>/dev/null || true
	@echo ""
	@echo "Teardown complete. All cloud resources removed."

destroy: doks-teardown ## Alias for doks-teardown — removes all DO resources
