<#
.SYNOPSIS
  Provisions the Azure resources Crosscheck needs for the Foundry IQ integration
  and uploads the synthetic corpus to Blob Storage.

  After this runs, finish in the Foundry portal (ai.azure.com -> Build ->
  Knowledge) by creating a knowledge base over the uploaded blob container —
  see infra/README.md. The knowledge-base creation step is portal-driven in the
  current preview.

.PREREQUISITES
  - Azure CLI (`winget install -e --id Microsoft.AzureCLI`) and `az login`
  - A region that supports Azure AI Search agentic retrieval (e.g. eastus2,
    swedencentral). Verify in the portal's Knowledge tab.

.EXAMPLE
  ./infra/setup_foundry_iq.ps1 -ResourceGroup crosscheck-rg -Location eastus2
#>
param(
  [string]$ResourceGroup = "crosscheck-rg",
  [string]$Location = "eastus2",
  [string]$SearchName = "crosscheck-search-$((Get-Random -Maximum 9999))",
  [string]$SearchSku = "free",
  [string]$StorageName = "crosscheckstg$((Get-Random -Maximum 9999))",
  [string]$Container = "corpus"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  Write-Error "Azure CLI not found. Install with: winget install -e --id Microsoft.AzureCLI"
}

Write-Host "==> Resource group: $ResourceGroup ($Location)" -ForegroundColor Cyan
az group create --name $ResourceGroup --location $Location --output none

Write-Host "==> Azure AI Search ($SearchSku): $SearchName" -ForegroundColor Cyan
az search service create --name $SearchName --resource-group $ResourceGroup `
  --sku $SearchSku --location $Location --output none

Write-Host "==> Storage account: $StorageName" -ForegroundColor Cyan
az storage account create --name $StorageName --resource-group $ResourceGroup `
  --location $Location --sku Standard_LRS --output none

$conn = az storage account show-connection-string --name $StorageName `
  --resource-group $ResourceGroup --query connectionString --output tsv

Write-Host "==> Blob container: $Container (uploading corpus/)" -ForegroundColor Cyan
az storage container create --name $Container --connection-string $conn --output none
$corpus = Join-Path $PSScriptRoot ".." | Join-Path -ChildPath "corpus"
az storage blob upload-batch --destination $Container --source $corpus `
  --connection-string $conn --pattern "*.md" --output none

$searchEndpoint = "https://$SearchName.search.windows.net"
$searchKey = az search admin-key show --service-name $SearchName `
  --resource-group $ResourceGroup --query primaryKey --output tsv

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " Provisioned. Add these to your .env:" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "PROVIDER=foundry"
Write-Host "AZURE_SEARCH_ENDPOINT=$searchEndpoint"
Write-Host "AZURE_SEARCH_API_KEY=$searchKey"
Write-Host "AZURE_SEARCH_KNOWLEDGE_BASE=crosscheck-kb"
Write-Host ""
Write-Host "Next (portal): ai.azure.com -> Build -> Knowledge ->" -ForegroundColor Yellow
Write-Host "  1. Connect this Search service ($SearchName)." -ForegroundColor Yellow
Write-Host "  2. Create a knowledge base named 'crosscheck-kb'." -ForegroundColor Yellow
Write-Host "  3. Add an Azure Blob knowledge source -> account $StorageName, container '$Container'." -ForegroundColor Yellow
Write-Host "  4. Let it index, then copy the retrieve URL into AZURE_SEARCH_RETRIEVE_URL if it differs." -ForegroundColor Yellow
Write-Host "Then: set PROVIDER=foundry in .env and restart the app." -ForegroundColor Yellow
