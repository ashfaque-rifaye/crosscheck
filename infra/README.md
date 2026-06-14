# Foundry IQ setup — the real Microsoft IQ integration

Crosscheck runs on the bundled **mock corpus** out of the box. To run it on a real
**Foundry IQ** knowledge base (Azure AI Search agentic retrieval), follow either path
below, then flip `PROVIDER=foundry` in `.env`.

> Cost note: Microsoft supports a **free Azure AI Search tier** and a **free token
> allocation for agentic retrieval** for proof-of-concept use, so this is low/no cost.

---

## Prerequisites (Step 0 access check)

1. **Azure CLI**: `winget install -e --id Microsoft.AzureCLI`, then `az login`, then
   `az account show` (should list your subscription).
2. **Region** that supports agentic retrieval (e.g. `eastus2`, `swedencentral`) —
   confirm in the Foundry portal's **Build → Knowledge** tab.
3. **Azure OpenAI / Foundry Models**: deploy a chat model (e.g. `gpt-4o-mini`) for the
   reasoning engine and set `AZURE_OPENAI_*` in `.env`. (This is the most common access
   gate — verify early.)

---

## Path A — scripted resources + portal knowledge base (recommended)

```powershell
./infra/setup_foundry_iq.ps1 -ResourceGroup crosscheck-rg -Location eastus2
```

This creates a resource group, a **free** Azure AI Search service, a storage account +
`corpus` container, and uploads `corpus/*.md`. It prints the `.env` values to paste.

Then finish in the portal (knowledge-base creation is portal-driven in the current preview):

1. Open **https://ai.azure.com** with the **New Foundry** toggle ON; open/create a project.
2. **Build → Knowledge**:
   - Connect the Azure AI Search service the script created.
   - Create a **knowledge base** named `crosscheck-kb`.
   - Add an **Azure Blob** knowledge source pointing at the storage account + `corpus`
     container. Let indexing finish (chunking + embeddings are automatic).
3. Copy the knowledge base's **retrieve URL** into `AZURE_SEARCH_RETRIEVE_URL` if it
   differs from the default the provider builds.

## Path B — fully portal

Skip the script: upload `corpus/*.md` to any Blob container, then do the same
**Build → Knowledge** steps above to create `crosscheck-kb` over that container.

---

## Configure `.env` and run

```dotenv
PROVIDER=foundry
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
AZURE_SEARCH_ENDPOINT=https://<search>.search.windows.net
AZURE_SEARCH_API_KEY=<admin key>
AZURE_SEARCH_KNOWLEDGE_BASE=crosscheck-kb
# AZURE_SEARCH_RETRIEVE_URL=   # only if the portal shows a different path/version
```

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --port 8000
```

Open http://127.0.0.1:8000 — the provider badge should read **Foundry IQ**, and
conflict citations now resolve to your knowledge base documents.

### Verify retrieval directly

`GET /api/health` lists the sources the provider can see. If it returns `degraded`
with an error, check the endpoint/key and that indexing finished. The app also falls
back to the cached report if a live call fails, so the demo never hard-crashes.
