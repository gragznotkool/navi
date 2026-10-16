import type { RepairStatus, ReturnStatus, WorkflowStatus } from "@opshub/contracts";

/**
 * Explicit, typed transition tables. Deterministic and deliberately simple: the platform does
 * not interpret arbitrary configuration as a workflow engine. Site workflowDefinitions are
 * validated by the compiler for consistency but domain services enforce these tables.
 */
export const requestTransitions: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "rejected", "cancelled"],
  approved: ["assigned"],
  rejected: [],
  assigned: ["fulfilled"],
  fulfilled: [],
  cancelled: [],
};

export const repairTransitions: Record<RepairStatus, readonly RepairStatus[]> = {
  received: ["diagnosing"],
  diagnosing: ["repairing", "scrapped"],
  repairing: ["testing"],
  testing: ["completed", "repairing"],
  completed: [],
  scrapped: [],
};

export const returnTransitions: Record<ReturnStatus, readonly ReturnStatus[]> = {
  initiated: ["inspected", "rejected"],
  inspected: ["restocked", "rejected"],
  restocked: [],
  rejected: [],
};

export function canTransition<S extends string>(table: Record<S, readonly S[]>, from: S, to: S): boolean {
  return table[from].includes(to);
}
