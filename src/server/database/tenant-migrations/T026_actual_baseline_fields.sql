-- T026: Add actual dates and task-level baseline fields (MPP parity)
ALTER TABLE tasks
  ADD COLUMN actual_start_date DATE DEFAULT NULL AFTER end_date,
  ADD COLUMN actual_end_date DATE DEFAULT NULL AFTER actual_start_date,
  ADD COLUMN baseline_start_date DATE DEFAULT NULL AFTER actual_end_date,
  ADD COLUMN baseline_finish_date DATE DEFAULT NULL AFTER baseline_start_date,
  ADD COLUMN baseline_duration_days DECIMAL(10,2) DEFAULT NULL AFTER baseline_finish_date,
  ADD COLUMN baseline_cost DECIMAL(12,2) DEFAULT NULL AFTER baseline_duration_days;
