export interface Blob {
  blob_id: string;
  size_bytes: number;
  mime_type: string | null;
  created_at: Date;
}

export interface Item {
  item_id: string;
  type: string;
  title: string | null;
  source_type: string;
  source_id: string;
  external_ref: string | null;
  canonical_uri: string | null;
  content_sha256: string | null;
  observed_at: Date | null;
  tags: string[];
  sensitivity: 'private' | 'public' | 'secret' | 'restricted';
  blob_id: string | null;
  text_content: string | null;
  meta: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface Edge {
  edge_id: string;
  from_item_id: string;
  to_item_id: string;
  rel: string;
  meta: Record<string, unknown>;
  created_at: Date;
}

export interface Run {
  run_id: string;
  parent_run_id: string | null;
  kind: 'cli' | 'agent' | 'workflow' | 'trigger';
  actor: string | null;
  tool_name: string | null;
  tool_version: string | null;
  idempotency_key: string | null;
  status: 'running' | 'succeeded' | 'failed' | 'canceled';
  started_at: Date;
  finished_at: Date | null;
  error: string | null;
  metrics: Record<string, unknown>;
}

export interface Task {
  task_id: string;
  run_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  status: 'queued' | 'leased' | 'running' | 'succeeded' | 'failed' | 'dead';
  priority: number;
  due_at: Date;
  attempts: number;
  max_attempts: number;
  locked_until: Date | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}
