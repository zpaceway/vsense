VSENSE_MCP_HOST ?= 0.0.0.0
VSENSE_PORT ?= 32516
VSENSE_API_KEY ?= f18df8637d0240b7a2aba2ea4dba93d5
VSENSE_MCP_BASE_URL ?= http://localhost:32516

export VSENSE_MCP_HOST VSENSE_PORT VSENSE_API_KEY VSENSE_MCP_BASE_URL

.PHONY: format check test dev run docker logs build-push deploy

format:
	@echo "Formatting TypeScript code..."
	bunx prettier --write index.ts src

check:
	@echo "Checking TypeScript code..."
	bunx prettier --check index.ts src
	bunx tsc --noEmit

test:
	@echo "No tests configured."

dev:
	@echo "Starting development server..."
	bun --watch index.ts

run:
	@echo "Starting production server..."
	bun index.ts

docker:
	@echo "Building Docker image..."
	docker compose down --remove-orphans
	docker compose up -d --build

logs:
	@echo "Viewing Docker logs..."
	docker compose logs -f vsense-mcp

build-push:
	@echo "Building and pushing Docker image..."
	docker build -t harbor.zpaceway.com/zpaceway/vsense-mcp:latest .
	docker push harbor.zpaceway.com/zpaceway/vsense-mcp:latest

deploy:
	@echo "Deploying to Kubernetes..."
	$(MAKE) build-push
	kubectl rollout restart deployment/vsense-mcp --namespace=vsense-mcp
