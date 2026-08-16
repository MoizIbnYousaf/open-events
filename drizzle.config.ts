import { defineConfig } from 'drizzle-kit'

// Drizzle Kit config for generating migrations from src/db/schema.ts.
// Migrations are applied to D1 with wrangler (local-only in M1).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
})
