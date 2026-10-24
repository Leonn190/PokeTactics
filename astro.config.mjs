import { defineConfig } from 'astro/config';

const [owner, repository] = (process.env.GITHUB_REPOSITORY || '').split('/');
const rootRepository = !!owner && repository?.toLowerCase() === `${owner.toLowerCase()}.github.io`;
const base = process.env.PUBLIC_BASE_PATH || (repository && !rootRepository ? `/${repository}/` : '/');

export default defineConfig({
  output: 'static',
  site: owner ? `https://${owner}.github.io` : 'https://example.com',
  base,
  build: { inlineStylesheets: 'auto' }
});
