// Secret names are declared separately so Wrangler type generation never needs their values.
interface Env {
  TWITTER_BEARER_TOKEN: string;
  GITHUB_ACCESS_TOKEN: string;
  SENTRY_DSN: string;
  LTA_DATAMALL_ACCOUNT_KEY: string;
}
