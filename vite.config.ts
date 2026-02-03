import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// https://vite.dev/config/
export default defineConfig({
    base: process.env.GITHUB_ACTIONS
      ? `/${process.env.GITHUB_REPOSITORY?.split('/')[1]}/`
      : '/',
    plugins: [react()],
});
