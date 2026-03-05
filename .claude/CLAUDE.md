# CLAUDE.md

## Project: M14U-js
A modern Music/Radio application with "Listen Along" capabilities using WebRTC and React.

## Build and Development Commands
- **Install Dependencies**: `pnpm install` (in both `backend` and `frontend`)
- **Backend Development**: `cd backend && pnpm run dev` (starts index.js with nodemon)
- **Frontend Development**: `cd frontend && pnpm run dev` (starts Vite)
- **Frontend Build**: `cd frontend && pnpm run build`
- **Linting**: `cd frontend && pnpm run lint`

## Converted Rules and Commands
- **Rules**: Check `.claude/rules/` for design and development guidelines.
- **Slash Commands**: 
  - `/frontend-setup`: Steps to bootstrap a new React + TS + Tailwind v4 project.
  - `/listen-along-mobile`: Reference for mobile fixes and WebRTC architecture patterns.

## Code Style & Guidelines
- **Language**: TypeScript (Frontend), JavaScript (Backend - using ESM).
- **Styling**: Tailwind CSS v4, Framer Motion for animations.
- **State Management**: Zustand.
- **Real-time**: WebRTC for peer-to-peer sync, HTTP polling for signaling.
- **Naming**: Use camelCase for functions/variables, PascalCase for components.
- **Performance**: Optimize for high performance and smooth UX. Avoid "code smells".
- **Documentation**: Keep `backend/docs/API.md` and `frontend/docs/ARCHITECTURE.md` updated.

## Key Documentation
- [Backend API Docs](file:///home/santhoshmk/EDUCATION%20CONTENT/Projects/M14U-js/backend/docs/API.md)
- [Frontend Architecture](file:///home/santhoshmk/EDUCATION%20CONTENT/Projects/M14U-js/frontend/docs/ARCHITECTURE.md)
- [Frontend Setup](file:///home/santhoshmk/EDUCATION%20CONTENT/Projects/M14U-js/frontend/docs/SETUP.md)
