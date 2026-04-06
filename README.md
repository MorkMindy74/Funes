# Funes

<p align="center">
  <img src="funes-borges.png" alt="Borges illustration — Ireneo Funes" width="700"/>
</p>

> *"His memory, sir, is like a garbage heap."*
> — Jorge Luis Borges, [Funes, His Memory](https://it.wikipedia.org/wiki/Funes,_o_della_memoria) (1942)

**The memory and context engine for AI. Impossibly fast. Impossibly thorough.**
Like Ireneo Funes, who forgot nothing — your AI will forget nothing either.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/MorkMindy74/Funes/blob/main/LICENSE)
[![Last Commit](https://img.shields.io/github/last-commit/MorkMindy74/Funes)](https://github.com/MorkMindy74/Funes/commits/main)
[![CI Status](https://img.shields.io/github/actions/workflow/status/MorkMindy74/Funes/ci.yml?branch=main&label=CI)](https://github.com/MorkMindy74/Funes/actions)
![Security Hardened](https://img.shields.io/badge/security-hardened-green)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript)
![Built with Claude](https://img.shields.io/badge/built%20with-Claude%20Opus%204.6-blueviolet?logo=anthropic)

[Quick Start](#-quick-start) · [What's New](#-whats-new) · [Self-Hosting](#-self-hosting) · [Tribute](#-tribute)

---

## What is Funes?

Funes is a **production-grade memory and context layer** for AI agents and applications. It automatically extracts facts from conversations, builds persistent user profiles, resolves contradictions, handles temporal forgetting, and delivers the right context at exactly the right moment.

**Your AI forgets everything between conversations. Funes fixes that.**

| Capability | What it does |
|---|---|
| Memory Engine | Extracts facts, tracks updates, resolves contradictions, auto-forgets expired info |
| User Profiles | Auto-maintained static facts + dynamic context. One call, ~50ms |
| Hybrid Search | RAG + Memory in a single query |
| Multi-modal | PDFs, images (OCR), videos, code via MarkItDown |
| Self-hosted | Full Docker Compose setup. One command to run |
| MCP Server | Native MCP support for Claude Desktop, Cursor, Windsurf, VS Code and more |

---

## Quick Start

Prerequisites: Docker and Docker Compose

    git clone https://github.com/MorkMindy74/Funes.git
    cd Funes
    cp .env.example .env
    docker compose up --build

Services:

- Web UI: http://localhost:3000
- API: http://localhost:3001
- MCP Server: http://localhost:3002

Optional profiles:

    docker compose --profile with-firecrawl up --build
    docker compose --profile with-leann up --build
    docker compose --profile with-ollama up --build

---

## What's New

This fork goes significantly beyond the original Supermemory foundation. Every improvement listed here has been shipped and is present in the codebase.

### Phase 1 — Security Hardening
