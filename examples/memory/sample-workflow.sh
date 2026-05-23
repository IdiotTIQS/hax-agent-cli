#!/usr/bin/env bash
# -----------------------------------------------------------------------
# sample-workflow.sh — Realistic memory workflow for a project
#
# Demonstrates:
#   1. Writing memories with namespaces and tags
#   2. Listing memories filtered by namespace and tag
#   3. Searching across namespaces
#   4. Reading individual memories
#   5. Deleting a memory
#
# This script uses the HaxAgent CLI. Adjust HAX_AGENT to point to your
# installation if needed (e.g. "./bin/hax-agent" or "node src/cli.js").
# -----------------------------------------------------------------------

set -euo pipefail

HAX_AGENT="${HAX_AGENT:-hax-agent}"

echo "================================================="
echo "  HaxAgent Memory System — Workflow Demo"
echo "================================================="
echo ""

# -----------------------------------------------------------------------
# 1. Write project-related memories in the "my-project" namespace.
#    Each memory gets one or more descriptive tags.
# -----------------------------------------------------------------------

echo "--- Step 1: Writing memories ---"

# Architecture decisions
$HAX_AGENT memory write \
  --namespace my-project \
  --tag architecture \
  arch-decisions \
  "We use a modular monolith with in-process event bus. Each module owns its data."

# Technology choices tagged as "decision"
$HAX_AGENT memory write \
  --namespace my-project \
  --tag decision \
  tech-stack \
  "Backend: Node.js + Express. Database: PostgreSQL. Cache: Redis. Queue: RabbitMQ."

# A TODO item
$HAX_AGENT memory write \
  --namespace my-project \
  --tag todo \
  migrate-users \
  "Migrate user service from REST to gRPC. Estimate: 3 sprints. Owner: @backend-team."

# Meeting notes tagged with "meeting-notes"
$HAX_AGENT memory write \
  --namespace my-project \
  --tag meeting-notes \
  sprint-retro-may21 \
  "Retro 2026-05-21: CI pipeline is too slow (agreed to parallelize tests). \
DB migrations need better rollback support. Kudos to Alice for the auth fix."

# Onboarding reference (different tags: "reference" + "onboarding")
$HAX_AGENT memory write \
  --namespace my-project \
  --tag reference \
  dev-setup \
  "1. Clone repo. 2. Run 'npm install'. 3. Copy .env.example to .env. \
4. Run 'docker compose up' for dependencies. 5. Run 'npm run dev'."

# A cross-project reference in a different namespace
$HAX_AGENT memory write \
  --namespace shared \
  --tag reference \
  coding-standards \
  "Use ESLint config from the shared-config repo. Line width: 100 chars. \
Prefer async/await over raw promises. JSDoc on all public exports."

echo ""

# -----------------------------------------------------------------------
# 2. List all memories in "my-project" namespace.
#    Then filter further to show only "decision" entries.
# -----------------------------------------------------------------------

echo "--- Step 2: Listing memories ---"

echo ""
echo ">> All memories in my-project:"
$HAX_AGENT memory list --namespace my-project

echo ""
echo ">> Only decisions in my-project:"
$HAX_AGENT memory list --namespace my-project --tag decision

# -----------------------------------------------------------------------
# 3. Search across namespaces for a keyword.
#    Then search within a specific namespace with a tag filter.
# -----------------------------------------------------------------------

echo ""
echo "--- Step 3: Searching memories ---"

echo ""
echo ">> Search for 'PostgreSQL' across all namespaces:"
$HAX_AGENT memory search PostgreSQL

echo ""
echo ">> Search for 'migrate' within my-project, tagged as 'todo':"
$HAX_AGENT memory search --namespace my-project --tag todo migrate

# -----------------------------------------------------------------------
# 4. Read a specific memory in full.
# -----------------------------------------------------------------------

echo ""
echo "--- Step 4: Reading a memory ---"

echo ""
echo ">> Full content of 'arch-decisions':"
$HAX_AGENT memory read arch-decisions

# -----------------------------------------------------------------------
# 5. List all namespaces and their memory counts (using list + shell)
# -----------------------------------------------------------------------

echo "--- Step 5: Namespace summary ---"

echo ""
echo ">> Listing all memories and grouping by namespace:"
$HAX_AGENT memory list

# -----------------------------------------------------------------------
# 6. Delete a memory that is no longer needed.
# -----------------------------------------------------------------------

echo ""
echo "--- Step 6: Deleting a memory ---"

echo ""
echo ">> Deleting 'dev-setup' (it was moved to the team wiki):"
$HAX_AGENT memory delete dev-setup

echo ""
echo ">> Confirming deletion — remaining memories in my-project:"
$HAX_AGENT memory list --namespace my-project

echo ""
echo "================================================="
echo "  Workflow complete."
echo "================================================="
