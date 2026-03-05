# /frontend-setup

Initialize a new React + TypeScript + Tailwind v4 + Shadcn/UI frontend project.

## Steps to Execute:
1. **Initialize Vite**:
   `npx -y create-vite@latest frontend --template react-ts`
2. **Install Tailwind v4**:
   `pnpm add tailwindcss @tailwindcss/vite postcss autoprefixer`
3. **Setup Vite Plugin**:
   Add `tailwindcss()` to `vite.config.ts`.
4. **Setup Path Aliases**:
   - `vite.config.ts`: Add `alias: { "@": path.resolve(__dirname, "./src") }`.
   - `tsconfig.app.json`: Add `paths: { "@/*": ["./src/*"] }`.
5. **Configure CSS**:
   Replace `src/index.css` with Tailwind v4 `@import "tailwindcss";` and shadcn theme variables.
6. **Install UI Libs**:
   `pnpm add lucide-react clsx tailwind-merge tailwindcss-animate class-variance-authority @radix-ui/react-slot`
7. **Create Utils**:
   Create `src/lib/utils.ts` for the `cn` function.

## Important Notes:
- Avoid `shadcn init` on paths with spaces; use manual setup.
- Tailwind v4 uses `@theme` in CSS instead of `tailwind.config.js`.
