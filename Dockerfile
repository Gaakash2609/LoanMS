FROM --platform=linux/amd64 node:22-alpine AS frontend-build
WORKDIR /src/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM --platform=linux/amd64 mcr.microsoft.com/dotnet/sdk:10.0 AS backend-build
WORKDIR /src

COPY LoanMS.API/LoanMS.API.csproj LoanMS.API/
COPY LoanMS.Application/LoanMS.Application.csproj LoanMS.Application/
COPY LoanMS.Domain/LoanMS.Domain.csproj LoanMS.Domain/
COPY LoanMS.Infrastructure/LoanMS.Infrastructure.csproj LoanMS.Infrastructure/

RUN dotnet restore LoanMS.API/LoanMS.API.csproj

COPY . .
RUN dotnet publish LoanMS.API/LoanMS.API.csproj -c Release -o /app/publish /p:UseAppHost=false

COPY --from=frontend-build /src/LoanMS.API/wwwroot/react /app/publish/wwwroot/react

FROM --platform=linux/amd64 mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

COPY --from=backend-build /app/publish .

ENTRYPOINT ["dotnet", "LoanMS.API.dll"]
