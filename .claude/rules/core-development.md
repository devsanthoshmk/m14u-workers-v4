# Core Development Rules

- **Package Manager**: Always use `pnpm` instead of `npm`. If `pnpm` is not found, prepend commands with:
  `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" &&`
- **Documentation**: Update documentation files in `backend/docs` or `frontend/docs` regularly for any changes made to the codebase.
- **Experimental Mindset**: This is an experimental/exploration space. Focus on high performance and trying new approaches, but prioritize robust, optimized, and readable code.
- **Continuous Improvement**: If you discover a new workflow or a complex pattern that takes multiple steps/searches, update the workspace rules or create a new command for future reference.
- **UX First**: Prioritize user experience, smoothness, and visual excellence in all implementations.
- **Code Quality**: Ensure code is robust, optimized for performance, highly readable, and free of code smells.
- **Context**: Backend documentation is located in `backend/docs`.
