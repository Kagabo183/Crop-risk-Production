# Makefile for Crop Risk Platform

.PHONY: help build up down restart logs shell db-shell clean test migrate

help: ## Show this help message
	@echo "Crop Risk Platform - Docker Commands"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

build: ## Build all Docker containers
	docker-compose build

up: ## Start all services
	docker-compose up -d

down: ## Stop all services
	docker-compose down

restart: ## Restart all services
	docker-compose restart

logs: ## View logs from all services
	docker-compose logs -f

logs-backend: ## View backend logs
	docker-compose logs -f web

logs-worker: ## View worker logs
	docker-compose logs -f worker

logs-frontend: ## View frontend logs
	docker-compose logs -f frontend

shell: ## Open shell in backend container
	docker-compose exec web bash

db-shell: ## Open PostgreSQL shell
	docker-compose exec db psql -U postgres -d crop_risk_db

redis-shell: ## Open Redis CLI
	docker-compose exec redis redis-cli

clean: ## Stop and remove all containers, networks, and volumes
	docker-compose down -v
	docker system prune -f

rebuild: ## Rebuild and restart all services
	docker-compose down
	docker-compose build
	docker-compose up -d

status: ## Show status of all containers
	docker-compose ps

migrate: ## Run database migrations
	docker-compose exec web alembic upgrade head

test: ## Run tests
	docker-compose exec web pytest

backup-db: ## Backup database
	docker-compose exec db pg_dump -U postgres crop_risk_db > backup_$(shell date +%Y%m%d_%H%M%S).sql

restore-db: ## Restore database (usage: make restore-db FILE=backup.sql)
	cat $(FILE) | docker-compose exec -T db psql -U postgres crop_risk_db

health: ## Check health of all services
	@echo "Backend Health:"
	@curl -s http://localhost:8000/api/v1/health || echo "Backend not responding"
	@echo "\nFrontend Health:"
	@curl -s http://localhost:3000 > /dev/null && echo "Frontend OK" || echo "Frontend not responding"
	@echo "\nDatabase Health:"
	@docker-compose exec db pg_isready -U postgres
	@echo "Redis Health:"
	@docker-compose exec redis redis-cli ping

dev: ## Start development environment
	docker-compose up

prod: ## Start production environment
	docker-compose -f docker-compose.prod.yml up -d

install: ## Initial setup (build, start, migrate)
	docker-compose build
	docker-compose up -d
	sleep 10
	docker-compose exec web alembic upgrade head
	@echo "Setup complete! Access:"
	@echo "  Frontend: http://localhost:3000"
	@echo "  Backend:  http://localhost:8000"
	@echo "  API Docs: http://localhost:8000/docs"
