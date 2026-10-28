/**
 * Cloudflare Free plan limits shown on the Overview page and used by the usage alerts.
 * Source: developers.cloudflare.com (Workers limits + pricing, Durable Objects pricing). Daily limits reset at 00:00 UTC.
 */
export const FREE = {
  workerRequestsDay: 100000,
  burstPerMinute: 1000,
  cpuMs: 10,
  subrequests: 50,
  doRequestsDay: 100000,
  doRowsWrittenDay: 100000,
  doRowsReadDay: 5000000,
  doStorageGB: 5,
  memoryMB: 128,
  scriptMB: 3,
};
