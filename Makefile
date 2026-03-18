.PHONY: help dev build clean logs deploy doks-setup doks-setup-dev doks-setup-prod doks-push doks-deploy doks-deploy-dev doks-deploy-prod doks-status doks-loadtest doks-reset doks-teardown destroy

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

# Environment selector for DOKS targets: dev|prod
ENV ?= dev

# Managed services (prod) configuration
DO_DB_PG_NAME ?= $(HELM_RELEASE)-pg
DO_DB_REDIS_NAME ?= $(HELM_RELEASE)-redis
DO_DB_REGION ?= $(DO_REGION)
DO_PG_SIZE ?= db-s-1vcpu-1gb
DO_PG_NODES ?= 1
DO_REDIS_SIZE ?= db-s-1vcpu-1gb
DO_REDIS_NODES ?= 1

# Production Secret (stored in cluster; not committed)
PROD_SECRET_NAME ?= $(HELM_RELEASE)-prod-secrets
PROD_JWT_SECRET ?=
PROD_DATABASE_URL ?=
PROD_REDIS_URL ?=

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@grep -h -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

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

doks-setup: ## Setup DOKS resources (ENV=dev|prod)
	@$(MAKE) doks-setup-$(ENV)

doks-setup-dev: ## Create DOKS cluster and container registry (dev)
	@echo "Creating container registry $(DO_REGISTRY)..."
	-doctl registry create $(DO_REGISTRY) --subscription-tier starter 2>/dev/null || true
	@echo "Creating DOKS cluster $(DO_CLUSTER_NAME) in $(DO_REGION)..."
	-doctl kubernetes cluster create $(DO_CLUSTER_NAME) \
		--region $(DO_REGION) \
		--auto-upgrade \
		--node-pool "name=default;size=$(DO_NODE_SIZE);count=$(DO_NODE_COUNT);auto-scale=true;min-nodes=$(DO_NODE_COUNT);max-nodes=$(DO_NODE_MAX)" 2>/dev/null || true
	@echo "Saving kubeconfig for $(DO_CLUSTER_NAME)..."
	doctl kubernetes cluster kubeconfig save $(DO_CLUSTER_NAME) --set-current-context
	@echo "Connecting registry to cluster..."
	doctl registry kubernetes-manifest | kubectl apply -f -
	@echo "Installing metrics-server for HPA..."
	-doctl kubernetes 1-click install $$(doctl kubernetes cluster list --format ID --no-header) --1-clicks metrics-server 2>/dev/null || true
	@echo ""
	@echo "Cluster ready! Run 'make doks-push' next."

doks-setup-prod: ## Create DOKS cluster/registry + managed Postgres/Redis and persist URLs in a K8s Secret
	@$(MAKE) doks-setup-dev
	@# If prod secret already exists, skip resolving connection strings again.
	@if kubectl get secret -n $(K8S_NAMESPACE) $(PROD_SECRET_NAME) >/dev/null 2>&1; then \
		echo "Prod secret $(PROD_SECRET_NAME) already exists in namespace $(K8S_NAMESPACE); skipping managed DB/Redis URI resolution."; \
		exit 0; \
	fi
	@echo ""
	@echo "Creating managed PostgreSQL/Valkey and extracting URIs..."
	@PG_URI=$$(doctl databases create $(DO_DB_PG_NAME) \
		--engine pg \
		--region $(DO_DB_REGION) \
		--size $(DO_PG_SIZE) \
		--num-nodes $(DO_PG_NODES) \
		--wait 2>&1 | python3 -c 'import sys,re; s=sys.stdin.read(); m=re.search(r\"postgresql://\\S+\", s); print(m.group(0) if m else \"\", end=\"\")' ) ; \
	REDIS_URI=$$(doctl databases create $(DO_DB_REDIS_NAME) \
		--engine valkey \
		--region $(DO_DB_REGION) \
		--size $(DO_REDIS_SIZE) \
		--num-nodes $(DO_REDIS_NODES) \
		--wait 2>&1 | python3 -c 'import sys,re; s=sys.stdin.read(); m=re.search(r\"(rediss|redis)://\\S+\", s); print(m.group(0) if m else \"\", end=\"\")' ) ; \
	if [ -z "$$PG_URI" ] || [ -z "$$REDIS_URI" ]; then \
		if [ -n "$(PROD_DATABASE_URL)" ] && [ -n "$(PROD_REDIS_URL)" ]; then \
			PG_URI="$(PROD_DATABASE_URL)"; \
			REDIS_URI="$(PROD_REDIS_URL)"; \
		else \
			echo "Error: could not extract managed connection URIs from doctl create output."; \
			echo "Provide them explicitly to proceed:"; \
			echo "  make doks-setup ENV=prod PROD_DATABASE_URL=\"...\" PROD_REDIS_URL=\"...\""; \
			echo "Skipping prod Secret creation; doks-deploy ENV=prod will fall back to in-cluster DB/Redis."; \
			exit 0; \
		fi; \
	fi; \
	JWT_SECRET="$(PROD_JWT_SECRET)"; \
	if [ -z "$$JWT_SECRET" ]; then \
		JWT_SECRET=$$(openssl rand -base64 32); \
		echo "Generated PROD JWT secret (stored in K8s Secret)."; \
	fi; \
	LOAD_TEST_KEY=$$(openssl rand -base64 16); \
	echo "Creating/updating K8s Secret $(PROD_SECRET_NAME) in namespace $(K8S_NAMESPACE)..."; \
	kubectl create namespace $(K8S_NAMESPACE) 2>/dev/null || true; \
	kubectl delete secret -n $(K8S_NAMESPACE) $(PROD_SECRET_NAME) 2>/dev/null || true; \
	kubectl create secret generic -n $(K8S_NAMESPACE) $(PROD_SECRET_NAME) \
		--from-literal=JWT_SECRET="$$JWT_SECRET" \
		--from-literal=DATABASE_URL="$$PG_URI" \
		--from-literal=REDIS_URL="$$REDIS_URI" \
		--from-literal=LOAD_TEST_KEY="$$LOAD_TEST_KEY"
	@echo ""
	@echo "Prod resources ready."
	@echo "Next: make doks-deploy ENV=prod"

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

doks-deploy: ## Deploy to DOKS via Helm (ENV=dev|prod)
	@$(MAKE) doks-deploy-$(ENV)

doks-deploy-dev: ## Deploy to DOKS via Helm (dev)
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

doks-deploy-prod: ## Deploy to DOKS via Helm (prod values; prefer managed DB/Redis, fall back to in-cluster)
	@HAS_PROD_SECRET=$$(kubectl get secret -n $(K8S_NAMESPACE) $(PROD_SECRET_NAME) >/dev/null 2>&1 && echo 1 || echo 0); \
	echo "Prod Secret present: $$HAS_PROD_SECRET"; \
	@echo "Creating namespace $(K8S_NAMESPACE)..."
	kubectl create namespace $(K8S_NAMESPACE) 2>/dev/null || true
	@echo "Copying registry credentials to namespace..."
	doctl registry kubernetes-manifest | sed 's/namespace: kube-system/namespace: $(K8S_NAMESPACE)/' | kubectl apply -n $(K8S_NAMESPACE) -f -
	@if [ "$$HAS_PROD_SECRET" = "1" ]; then \
		echo "Deploying with Helm (production values + existing prod Secret)..."; \
		helm upgrade --install $(HELM_RELEASE) ./chart/onitama \
			--namespace $(K8S_NAMESPACE) \
			-f ./chart/onitama/values-production.yaml \
			--set existingSecretName="$(PROD_SECRET_NAME)" \
			--set image.repository=registry.digitalocean.com/$(DO_REGISTRY)/onitama \
			--set image.tag=web \
			--set loadgenerator.image.repository=registry.digitalocean.com/$(DO_REGISTRY)/onitama \
			--set loadgenerator.image.tag=loadgen \
			--wait --timeout 7m; \
	else \
		echo "Managed DB/Redis Secret missing; deploying with in-cluster DB/Redis fallback..."; \
		helm upgrade --install $(HELM_RELEASE) ./chart/onitama \
			--namespace $(K8S_NAMESPACE) \
			-f ./chart/onitama/values-production.yaml \
			--set existingSecretName="" \
			--set postgresql.internal=true \
			--set redis.internal=true \
			--set secrets.jwtSecret=$$(openssl rand -base64 32) \
			--set secrets.loadTestKey=$$(openssl rand -base64 16) \
			--set image.repository=registry.digitalocean.com/$(DO_REGISTRY)/onitama \
			--set image.tag=web \
			--set loadgenerator.image.repository=registry.digitalocean.com/$(DO_REGISTRY)/onitama \
			--set loadgenerator.image.tag=loadgen \
			--wait --timeout 7m; \
	fi
	@echo ""
	@echo "Production deployment complete!"
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

doks-teardown: ## Teardown DOKS resources (ENV=dev|prod)
	@$(MAKE) doks-teardown-$(ENV)

doks-teardown-dev: ## Delete DOKS cluster and registry to stop billing (dev)
	@echo "Uninstalling Helm release..."
	-helm uninstall $(HELM_RELEASE) --namespace $(K8S_NAMESPACE) 2>/dev/null || true
	@echo "Deleting cluster $(DO_CLUSTER_NAME)..."
	-doctl kubernetes cluster delete $(DO_CLUSTER_NAME) --force 2>/dev/null || true
	@echo "Deleting registry $(DO_REGISTRY)..."
	-doctl registry delete --force 2>/dev/null || true
	@echo ""
	@echo "Teardown complete. All cloud resources removed."

doks-teardown-prod: ## Delete DOKS cluster/registry AND managed databases (prod)
	@echo "Uninstalling Helm release..."
	-helm uninstall $(HELM_RELEASE) --namespace $(K8S_NAMESPACE) 2>/dev/null || true
	@echo "Deleting K8s Secret $(PROD_SECRET_NAME) (if present)..."
	-kubectl delete secret -n $(K8S_NAMESPACE) $(PROD_SECRET_NAME) 2>/dev/null || true
	@echo "Deleting managed PostgreSQL $(DO_DB_PG_NAME)..."
	-doctl databases delete $(DO_DB_PG_NAME) --force 2>/dev/null || true
	@echo "Deleting managed Redis $(DO_DB_REDIS_NAME)..."
	-doctl databases delete $(DO_DB_REDIS_NAME) --force 2>/dev/null || true
	@echo "Deleting cluster $(DO_CLUSTER_NAME)..."
	-doctl kubernetes cluster delete $(DO_CLUSTER_NAME) --force 2>/dev/null || true
	@echo "Deleting registry $(DO_REGISTRY)..."
	-doctl registry delete --force 2>/dev/null || true
	@echo ""
	@echo "Teardown complete. All cloud resources removed."

destroy: doks-teardown ## Alias for doks-teardown — removes all DO resources
