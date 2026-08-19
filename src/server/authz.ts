// The single authorization authority. Both the UI (to pick a render mode) and
// every Server Action (as a hard guard) call into this module, so the two can
// never drift apart. Never trust a client-supplied mode.

import { Role } from "@prisma/client";

export type SessionUser = {
  id: string;
  role: Role;
  /** Lab memberships; isManager grants custody over the whole lab. */
  memberships: { labId: string; isManager: boolean }[];
};

export type ContainerForAuthz = {
  id: string;
  labId: string;
  custodianId: string | null;
  isControlled: boolean; // from substance.isControlled
};

export type ContainerAction =
  | "view"
  | "deduct"
  | "add"
  | "correct"
  | "transfer"
  | "dispose"
  | "approve_transfer";

export type GlobalAction =
  | "check_in"
  | "start_stocktake"
  | "sign_off_stocktake"
  | "edit_ghs"
  | "manage_users"
  | "manage_labs"
  | "view_audit"
  | "run_reports"
  | "manage_alert_rules"
  | "resolve_import_fixup";

/**
 * Render mode for a container-scoped control, mirroring the design deck:
 *  - editable:     full control (own custody, or global grant)
 *  - request-only: visible, disabled control, "Request transfer" offered
 *  - read-only:    visible, no actions at all (e.g. VIEWER)
 *  - restricted:   controlled substance the user may not handle
 *  - denied:       action structurally unavailable to this role
 */
export type AccessMode = "editable" | "request-only" | "read-only" | "restricted" | "denied";

/** ✓ anywhere / ◐ own custody only / ✕ never — exactly the deck's matrix. */
export type MatrixCell = "ALLOW" | "OWN" | "DENY";

const ROLES: Role[] = ["VIEWER", "LAB_USER", "CUSTODIAN", "LAB_MANAGER", "EHS_OFFICER", "ADMIN"];

/**
 * Container-action permission matrix (rendered read-only in the admin UI).
 * Rows follow the design review deck, slide "Roles & permission scope".
 */
export const CONTAINER_MATRIX: Record<ContainerAction, Record<Role, MatrixCell>> = {
  view: rowOf("ALLOW", "ALLOW", "ALLOW", "ALLOW", "ALLOW", "ALLOW"),
  deduct: rowOf("DENY", "OWN", "OWN", "OWN", "DENY", "OWN"),
  add: rowOf("DENY", "DENY", "OWN", "OWN", "DENY", "ALLOW"),
  correct: rowOf("DENY", "DENY", "OWN", "OWN", "DENY", "OWN"),
  transfer: rowOf("DENY", "DENY", "OWN", "ALLOW", "DENY", "ALLOW"),
  dispose: rowOf("DENY", "DENY", "OWN", "OWN", "ALLOW", "ALLOW"),
  approve_transfer: rowOf("DENY", "DENY", "OWN", "ALLOW", "DENY", "ALLOW"),
};

/**
 * Who may handle controlled/licensed substances at all. Deliberate separation
 * of duties: ADMIN configures the system but can NEVER dispense scheduled
 * material — that permission belongs to the EHS Officer (deck, note 2).
 */
export const CONTROLLED_HANDLING: Record<Role, MatrixCell> = {
  VIEWER: "DENY",
  LAB_USER: "DENY",
  CUSTODIAN: "OWN",
  LAB_MANAGER: "OWN",
  EHS_OFFICER: "ALLOW",
  ADMIN: "DENY",
};

export const GLOBAL_MATRIX: Record<GlobalAction, Record<Role, MatrixCell>> = {
  check_in: rowOf("DENY", "DENY", "OWN", "OWN", "DENY", "ALLOW"),
  start_stocktake: rowOf("DENY", "DENY", "OWN", "OWN", "ALLOW", "ALLOW"),
  sign_off_stocktake: rowOf("DENY", "DENY", "DENY", "OWN", "ALLOW", "ALLOW"),
  edit_ghs: rowOf("DENY", "DENY", "DENY", "DENY", "ALLOW", "ALLOW"),
  manage_users: rowOf("DENY", "DENY", "DENY", "DENY", "DENY", "ALLOW"),
  manage_labs: rowOf("DENY", "DENY", "DENY", "DENY", "DENY", "ALLOW"),
  view_audit: rowOf("DENY", "DENY", "DENY", "OWN", "ALLOW", "ALLOW"),
  run_reports: rowOf("ALLOW", "ALLOW", "ALLOW", "ALLOW", "ALLOW", "ALLOW"),
  manage_alert_rules: rowOf("DENY", "DENY", "DENY", "OWN", "ALLOW", "ALLOW"),
  resolve_import_fixup: rowOf("DENY", "DENY", "DENY", "OWN", "ALLOW", "ALLOW"),
};

function rowOf(
  viewer: MatrixCell,
  labUser: MatrixCell,
  custodian: MatrixCell,
  labManager: MatrixCell,
  ehs: MatrixCell,
  admin: MatrixCell,
): Record<Role, MatrixCell> {
  return {
    VIEWER: viewer,
    LAB_USER: labUser,
    CUSTODIAN: custodian,
    LAB_MANAGER: labManager,
    EHS_OFFICER: ehs,
    ADMIN: admin,
  };
}

/**
 * The custody rule, stated in the deck in plain language: a user's editable
 * set = containers where they are the named custodian, plus all containers in
 * labs where they hold the manager flag.
 */
export function isInCustody(user: SessionUser, container: ContainerForAuthz): boolean {
  if (container.custodianId === user.id) return true;
  return user.memberships.some((m) => m.labId === container.labId && m.isManager);
}

/** Is the user a member (any flag) of the lab owning this container? */
export function isLabMember(user: SessionUser, labId: string): boolean {
  return user.memberships.some((m) => m.labId === labId);
}

export function authorizeContainer(
  user: SessionUser,
  action: ContainerAction,
  container: ContainerForAuthz,
): AccessMode {
  if (action === "view") return "editable"; // everyone signed-in sees the estate

  // Controlled substances gate everything else. ADMIN is deliberately denied.
  if (container.isControlled) {
    const handling = CONTROLLED_HANDLING[user.role];
    if (handling === "DENY") return "restricted";
    if (handling === "OWN" && !isInCustody(user, container)) return "restricted";
  }

  const cell = CONTAINER_MATRIX[action][user.role];
  if (cell === "ALLOW") return "editable";
  if (cell === "OWN") {
    return isInCustody(user, container) ? "editable" : requestFallback(user.role);
  }
  // DENY: viewers get plain read-only; roles that could hold custody see the
  // request path so out-of-scope stock is never invisible (deck, note 2).
  return user.role === "VIEWER" ? "read-only" : requestFallback(user.role);
}

function requestFallback(role: Role): AccessMode {
  return role === "VIEWER" ? "read-only" : "request-only";
}

export function can(user: SessionUser, action: GlobalAction, labId?: string): boolean {
  const cell = GLOBAL_MATRIX[action][user.role];
  if (cell === "ALLOW") return true;
  if (cell === "DENY") return false;
  // OWN for a global action = scoped to labs the user manages.
  if (!labId) return user.memberships.some((m) => m.isManager);
  return user.memberships.some((m) => m.labId === labId && m.isManager);
}

/** Error thrown by Server Actions when authorization fails. */
export class AuthzError extends Error {
  constructor(
    public readonly mode: AccessMode,
    public readonly action: string,
  ) {
    super(`Not authorized: ${action} (${mode})`);
    this.name = "AuthzError";
  }
}

export const ALL_ROLES = ROLES;
