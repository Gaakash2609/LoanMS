# ── LoanMS API — Production Dockerfile (multi-stage) ───────────────────────
# Matches docker-compose.yml expectations: internal port 8080, /health endpoint

# ── Stage 1: Build React frontend ────────────────────────────────────────────
# Always builds fresh from frontend/src so the deployed bundle can never go
# stale (previously wwwroot/react was a manually pre-built, easy-to-forget copy).
FROM node:22-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# vite.config.ts sets outDir: '../LoanMS.API/wwwroot/react' (relative to /frontend),
# which resolves to the absolute path /LoanMS.API/wwwroot/react in this stage.
RUN npm run build

# ── Stage 2: Build .NET API ─────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy csproj files first (layer caching for faster rebuilds)
COPY LoanMS.Domain/LoanMS.Domain.csproj LoanMS.Domain/
COPY LoanMS.Application/LoanMS.Application.csproj LoanMS.Application/
COPY LoanMS.Infrastructure/LoanMS.Infrastructure.csproj LoanMS.Infrastructure/
COPY LoanMS.API/LoanMS.API.csproj LoanMS.API/
RUN dotnet restore LoanMS.API/LoanMS.API.csproj

# Copy everything else and build
COPY LoanMS.Domain/ LoanMS.Domain/
COPY LoanMS.Application/ LoanMS.Application/
COPY LoanMS.Infrastructure/ LoanMS.Infrastructure/
COPY LoanMS.API/ LoanMS.API/

RUN dotnet publish LoanMS.API/LoanMS.API.csproj -c Release -o /app/publish --no-restore

# Overwrite the stale wwwroot/react (if any was checked in) with the fresh frontend build
RUN rm -rf /app/publish/wwwroot/react
COPY --from=frontend-build /LoanMS.API/wwwroot/react /app/publish/wwwroot/react

# ── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# curl needed for docker-compose healthcheck; libgssapi required by Npgsql on Debian runtime
RUN apt-get update && apt-get install -y --no-install-recommends curl libgssapi-krb5-2 \
	&& rm -rf /var/lib/apt/lists/*

# Non-root user (ECS/Fargate best practice)
RUN groupadd -r loanms && useradd -r -g loanms loanms

COPY --from=build /app/publish .

# Writable dirs used by the app (mounted as volumes locally; on ECS use EFS or leave ephemeral)
RUN mkdir -p /app/data /app/logs /app/secure_uploads \
	&& chown -R loanms:loanms /app

USER loanms

ENV ASPNETCORE_URLS=http://+:8080 \
	ASPNETCORE_ENVIRONMENT=Production \
	DOTNET_RUNNING_IN_CONTAINER=true

EXPOSE 8080

ENTRYPOINT ["dotnet", "LoanMS.API.dll"]
