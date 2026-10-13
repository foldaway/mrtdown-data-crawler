export interface Dataset {
  kind: string;
  endpoint: string;
  extension: string;
  downloadHosts: readonly string[];
  maxBytes: number;
  validate: (bytes: ArrayBuffer) => void;
}
