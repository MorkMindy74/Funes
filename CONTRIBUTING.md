# Contributing to Funes

Thank you for your interest in contributing to Funes! We welcome contributions from developers of all skill levels. This guide will help you get started with contributing to the production-grade AI memory engine.

## 🚀 Quick Start

### Prerequisites

Before you begin, ensure you have the following installed:

- **Bun** (>= 1.2.17) - Our preferred package manager
- **Git** for version control

### Setting Up the Development Environment

1. **Fork and Clone the Repository**

   ```bash
   git clone https://github.com/MorkMindy74/Funes.git
   cd Funes
   ```

2. **Install Dependencies**

   ```bash
   bun install
   ```

3. **Set Up Environment Variables**

   ```bash
   cp apps/web/.env.example apps/web/.env
   ```

   Edit `.env` with your configuration.

4. **Start Development Servers**

   ```bash
   bun run dev
   ```

## 📝 Making Changes

### Branch Naming Convention

- `feat/` - New features
- `fix/` - Bug fixes
- `refactor/` - Code refactoring
- `docs/` - Documentation updates
- `chore/` - Maintenance tasks

### Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add streaming profile endpoint
fix: resolve CSRF token validation edge case
refactor: use MarkItDown as primary content extractor
docs: update architecture documentation
```

### Pull Request Guidelines

1. Keep PRs focused on a single concern
2. Write tests for new functionality
3. Ensure all existing tests pass: `bun test`
4. Run type checking: `bun run check-types`
5. Format and lint: `bun run format-lint`

## 🛡️ Security Contributions

If your PR touches:
- Memory engine or extraction pipeline
- Sanitization or prompt injection prevention
- Authentication or authorization
- Any connector or webhook

Please include tests and describe the security impact in the PR description.

## 🐛 Bug Reports

Open an issue at [github.com/MorkMindy74/Funes/issues](https://github.com/MorkMindy74/Funes/issues) with:

1. A clear description of the bug
2. Steps to reproduce
3. Expected vs. actual behavior
4. Environment details (OS, Bun version, etc.)

## 💡 Feature Requests

Open a GitHub Discussion or issue with:

1. The problem you're trying to solve
2. Your proposed solution
3. Alternatives you've considered

## 🧑‍💻 Code Standards

- **TypeScript**: Strict mode, no `any`
- **Linting**: Biome (`bun run format-lint`)
- **Testing**: Bun test runner (`bun test`)
- **Error handling**: Use `ApiResult` discriminated unions from the DAL
- **Security**: All user content must be sanitized via `sanitizeForLLM()` before LLM use

## 📧 Questions?

Open an issue on GitHub: [github.com/MorkMindy74/Funes/issues](https://github.com/MorkMindy74/Funes/issues)

---

*Funes is a fork of [supermemory](https://github.com/supermemoryai/supermemory) by Sidhant Srivastava. See [README.md](README.md) for the full tribute.*
