type Filter = { column: string; op: string; value: unknown };
type QueryResult = { data: unknown; error: { message: string } | null; count: number | null };
type QueryPayload = {
  table: string;
  operation: string;
  columns: string;
  filters: Filter[];
  order: Array<{ column: string; ascending?: boolean }>;
  limit: number;
  offset: number;
  values?: unknown;
  single?: boolean;
  or?: string;
  count?: string;
  head?: boolean;
  returning?: boolean;
};

async function request(body: Record<string, unknown>): Promise<QueryResult> {
  const { data: { session } } = await authClient.auth.getSession();
  if (!session?.access_token) return { data: null, error: { message: 'You are signed out.' }, count: null };
  try {
    const response = await fetch('/api/data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
    const result = await response.json() as { data?: unknown; error?: string; count?: number | null };
    if (!response.ok) return { data: null, error: { message: result.error || 'Database request failed.' }, count: null };
    return { data: result.data ?? null, error: null, count: result.count ?? null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : 'Database request failed.' }, count: null };
  }
}

export class MariaQuery implements PromiseLike<QueryResult> {
  private payload: QueryPayload;
  private resolved?: Promise<QueryResult>;

  constructor(table: string) {
    this.payload = { table, operation: 'select', columns: '*', filters: [], order: [], limit: 1000, offset: 0 };
  }

  select(columns = '*', options: { count?: string; head?: boolean } = {}) {
    this.payload.columns = columns || '*';
    if (this.payload.operation !== 'select') this.payload.returning = true;
    if (options.count) this.payload.count = options.count;
    if (options.head) this.payload.head = true;
    return this;
  }

  insert(values: unknown) { this.payload.operation = 'insert'; this.payload.values = values; return this; }
  upsert(values: unknown) { this.payload.operation = 'upsert'; this.payload.values = values; return this; }
  update(values: unknown) { this.payload.operation = 'update'; this.payload.values = values; return this; }
  delete() { this.payload.operation = 'delete'; return this; }

  eq(column: string, value: unknown) { return this.filter(column, 'eq', value); }
  neq(column: string, value: unknown) { return this.filter(column, 'neq', value); }
  gt(column: string, value: unknown) { return this.filter(column, 'gt', value); }
  gte(column: string, value: unknown) { return this.filter(column, 'gte', value); }
  lt(column: string, value: unknown) { return this.filter(column, 'lt', value); }
  lte(column: string, value: unknown) { return this.filter(column, 'lte', value); }
  ilike(column: string, value: unknown) { return this.filter(column, 'ilike', value); }
  in(column: string, value: unknown[]) { return this.filter(column, 'in', value); }
  is(column: string, value: unknown) { return this.filter(column, 'is', value); }
  or(value: string) { this.payload.or = value; return this; }
  order(column: string, options: { ascending?: boolean } = {}) { this.payload.order.push({ column, ascending: options.ascending }); return this; }
  limit(value: number) { this.payload.limit = value; return this; }
  range(from: number, to: number) { this.payload.offset = from; this.payload.limit = Math.max(0, to - from + 1); return this; }
  single() { this.payload.single = true; return this; }
  maybeSingle() { this.payload.single = true; return this; }

  private filter(column: string, op: string, value: unknown) {
    (this.payload.filters as Filter[]).push({ column, op, value });
    return this;
  }

  private run() { return this.resolved ||= request(this.payload); }
  then<TResult1 = QueryResult, TResult2 = never>(onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return this.run().then(onfulfilled, onrejected);
  }
}

export function fromMariaDB(table: string) { return new MariaQuery(table); }

export async function rpcMariaDB(name: string, args?: Record<string, unknown>) {
  const { data: { session } } = await authClient.auth.getSession();
  if (!session?.access_token) return { data: null, error: { message: 'You are signed out.' } };
  try {
    const response = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ name, args: args || {} }),
    });
    const result = await response.json();
    return response.ok ? { data: result.data ?? null, error: null } : { data: null, error: { message: result.error || 'Database action failed.' } };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : 'Database action failed.' } };
  }
}

// Inject the real Supabase Auth client so the database transport can pass its
// current access token without exposing MariaDB credentials to the browser.
import { authClient } from './client-core';
