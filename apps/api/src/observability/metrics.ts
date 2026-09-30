/**
 * Minimal in-process metrics registry, exported in the Prometheus text
 * format at GET /api/v1/metrics. Labels are low-cardinality and never carry
 * personal data: route templates (not URLs), methods, status classes and
 * enum values only (docs/adr/0025).
 */
type Labels = Record<string, string>;

const LABEL_VALUE = /^[\w:/{}.-]{0,120}$/;

function key(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k]}"`)
    .join(',');
}

function assertSafe(labels: Labels): void {
  for (const [k, v] of Object.entries(labels)) {
    if (!/^[a-z_]+$/.test(k) || !LABEL_VALUE.test(v)) {
      throw new Error(`Unsafe metric label ${k}`);
    }
  }
}

class Counter {
  private readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  inc(labels: Labels = {}, by = 1): void {
    assertSafe(labels);
    const k = key(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  get(labels: Labels = {}): number {
    return this.values.get(key(labels)) ?? 0;
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [k, v] of this.values) lines.push(`${this.name}${k ? `{${k}}` : ''} ${v}`);
    return lines.join('\n');
  }
}

class Gauge {
  private readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  set(value: number, labels: Labels = {}): void {
    assertSafe(labels);
    this.values.set(key(labels), value);
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const [k, v] of this.values) lines.push(`${this.name}${k ? `{${k}}` : ''} ${v}`);
    return lines.join('\n');
  }
}

const BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

class Histogram {
  private readonly series = new Map<string, { counts: number[]; sum: number; count: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  observe(seconds: number, labels: Labels = {}): void {
    assertSafe(labels);
    const k = key(labels);
    const s = this.series.get(k) ?? { counts: BUCKETS.map(() => 0), sum: 0, count: 0 };
    BUCKETS.forEach((b, i) => {
      if (seconds <= b) s.counts[i] = (s.counts[i] ?? 0) + 1;
    });
    s.sum += seconds;
    s.count += 1;
    this.series.set(k, s);
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [k, s] of this.series) {
      const prefix = k ? `${k},` : '';
      BUCKETS.forEach((b, i) =>
        lines.push(`${this.name}_bucket{${prefix}le="${b}"} ${s.counts[i] ?? 0}`),
      );
      lines.push(`${this.name}_bucket{${prefix}le="+Inf"} ${s.count}`);
      lines.push(`${this.name}_sum${k ? `{${k}}` : ''} ${s.sum}`);
      lines.push(`${this.name}_count${k ? `{${k}}` : ''} ${s.count}`);
    }
    return lines.join('\n');
  }
}

export class MetricsRegistry {
  readonly httpRequests = new Counter('ustago_http_requests_total', 'HTTP requests by route');
  readonly httpDuration = new Histogram(
    'ustago_http_request_duration_seconds',
    'HTTP request duration',
  );
  readonly domainEvents = new Counter('ustago_domain_events_total', 'Domain events by type');
  readonly workerRuns = new Counter('ustago_worker_runs_total', 'Worker runs by outcome');
  readonly gauges = new Gauge('ustago_gauge', 'Operational gauges (backlog, open alerts)');
  // Faz 7 marketplace (labels: enum values only; never ids, queries or regions).
  readonly marketplaceEvents = new Counter(
    'ustago_marketplace_events_total',
    'Marketplace funnel events by type',
  );
  readonly matchingDuration = new Histogram(
    'ustago_matching_duration_seconds',
    'Candidate selection and scoring duration by operation',
  );
  readonly dispatchedProviders = new Counter(
    'ustago_dispatched_providers_total',
    'Providers reached by dispatch, by wave and notify mode',
  );
  readonly chatMessages = new Counter('ustago_chat_messages_total', 'Chat messages by type');
  readonly searchRequests = new Counter(
    'ustago_search_requests_total',
    'Searches by outcome (hit, fuzzy, no_result)',
  );

  render(): string {
    return (
      [
        this.httpRequests,
        this.httpDuration,
        this.domainEvents,
        this.workerRuns,
        this.gauges,
        this.marketplaceEvents,
        this.matchingDuration,
        this.dispatchedProviders,
        this.chatMessages,
        this.searchRequests,
      ]
        .map((m) => m.render())
        .join('\n') + '\n'
    );
  }
}

/** Process-wide registry; request handlers and workers share it. */
export const metrics = new MetricsRegistry();
