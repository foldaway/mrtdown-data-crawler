import type { Bucket } from './storage/bucket';

/** Runtime inputs shared by the platform-independent collection pipelines. */
export interface Env {
  TWITTER_BEARER_TOKEN: string;
  GITHUB_ACCESS_TOKEN: string;
  LTA_DATAMALL_ACCOUNT_KEY: string;
  COLLECTION_ENABLED: string;
  GTFS_PUBLICATION_ENABLED: string;
  GTFS_NOTIFICATION_ENABLED: string;
  SNAPSHOTS: Bucket;
  GTFS_PUBLIC: Bucket;
}
