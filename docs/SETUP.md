# Frontend Setup

This project uses **React** with **TypeScript**, **Tailwind CSS v4**, and **shadcn/ui**.

## Tech Stack
- **Framework**: [Vite](https://vite.dev/)
- **Library**: [React 19](https://react.dev/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/blog/tailwindcss-v4-beta) (CSS-first engine)
- **Components**: [shadcn/ui](https://ui.shadcn.com/) (manual & automated components)
- **Icons**: [Lucide React](https://lucide.dev/)

## Available Scripts

- `pnpm dev`: Runs the development server.
- `pnpm build`: Builds the project for production.
- `pnpm preview`: Previews the production build.

## Project Structure
- `src/components/ui`: Common UI components (shadcn pattern).
- `src/lib`: Core utility functions (e.g., `cn`).
- `src/hooks`: Custom React hooks.
- `src/index.css`: Tailwind v4 configuration and global styles.

## Adding New Shadcn Components
Since Tailwind v4 is used with a custom setup, you can manually add shadcn components to `src/components/ui`.
1. Copy the component code from [shadcn/ui documentation](https://ui.shadcn.com/).
2. Adjust the imports to `@/lib/utils`.
3. Ensure `@radix-ui` dependencies are installed via `pnpm add`.

## Environment & Troubleshooting

### pnpm not found
If you encounter `bash: line 1: pnpm: command not found`, it's likely because `nvm` hasn't initialized the path. Use this command prefix:
```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && pnpm ...
```

### Path with Spaces
The workspace path `/home/santhoshmk/EDUCATION CONTENT/` contains a space. Always wrap paths in quotes and avoid tools that don't support spaces (like `shadcn-ui` init in some versions).
