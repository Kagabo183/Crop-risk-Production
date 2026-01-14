.PHONY: build up down logs shell migrate

build:
	docker compose build

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

shell:
	docker compose exec web /bin/bash
