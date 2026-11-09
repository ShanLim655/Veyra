/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HCAPTCHA_SITE_KEY: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
