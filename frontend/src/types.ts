export interface Site {
  id: number;
  code: string;
  name: string;
  timezone: string;
  diff_threshold_pct: string;
}

export interface Bill {
  id: number;
  bill_no: string;
  site_id: number;
  job_id: number;
  master_total_kwh: string;
  charging_kwh: string;
  estimated_kwh: string;
  pending_kwh: string;
  pending_order_count: number;
  public_kwh: string;
  unexplained_kwh: string;
  suspended_kwh: string;
  charging_amount: string;
  public_amount: string;
  status: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
}

export interface Job {
  id: number;
  site_id: number;
  cycle_start_local: string;
  cycle_end_local: string;
  status: string;
  threshold_pct: string;
  rerun_of_job_id: number | null;
  message: string | null;
}

export interface Interval {
  id: number;
  start_ts_local: string;
  end_ts_local: string;
  master_reading_start: string | null;
  master_reading_end: string | null;
  master_energy_kwh: string | null;
  device_meter_kwh: string;
  charging_kwh: string;
  estimated_kwh: string;
  public_kwh: string;
  unexplained_kwh: string;
  order_meter_diff_kwh: string;
  basis_status: string;
  note: string | null;
}

export interface Split {
  id: number;
  order_id: number;
  start_ts_local: string;
  end_ts_local: string;
  segment_name: string;
  price_per_kwh: string;
  energy_kwh: string | null;
  amount: string | null;
  basis_status: string;
  note: string | null;
}

export interface ReviewTask {
  id: number;
  site_id: number;
  job_id: number | null;
  task_kind: string;
  title: string;
  detail: string;
  assignee: string;
  status: string;
  response: string | null;
  responded_by: string | null;
}

export interface Conflict {
  id: number;
  site_id: number;
  device_id: string;
  order_a_id: number;
  order_b_id: number;
  status: string;
  resolved_order_id: number | null;
  resolution_note: string | null;
}

export interface ImportFile {
  id: number;
  site_id: number;
  source_type: string;
  original_name: string;
  sha256: string;
  row_count: number;
  imported_by: string;
  imported_at: string;
}

export interface ImportRow {
  id: number;
  line_no: number;
  raw_line: string;
  outcome: string;
  source_record_no: string | null;
  note: string | null;
}

export interface Adjustment {
  id: number;
  component: string;
  original_value: string;
  corrected_value: string;
  delta: string;
  reason: string;
  created_by: string;
  created_at: string;
}
