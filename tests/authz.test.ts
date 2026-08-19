import { describe, expect, it } from "vitest";
import {
  authorizeContainer,
  can,
  isInCustody,
  type ContainerForAuthz,
  type SessionUser,
} from "@/server/authz";
import { Role } from "@prisma/client";

const LAB_A = "lab-a";
const LAB_B = "lab-b";

function user(role: Role, opts?: { memberOf?: string[]; managerOf?: string[] }): SessionUser {
  const memberships = [
    ...(opts?.memberOf ?? []).map((labId) => ({ labId, isManager: false })),
    ...(opts?.managerOf ?? []).map((labId) => ({ labId, isManager: true })),
  ];
  return { id: "u1", role, memberships };
}

function container(opts?: Partial<ContainerForAuthz>): ContainerForAuthz {
  return { id: "c1", labId: LAB_A, custodianId: null, isControlled: false, ...opts };
}

describe("custody resolution", () => {
  it("named custodian is in custody", () => {
    expect(isInCustody(user("LAB_USER"), container({ custodianId: "u1" }))).toBe(true);
  });
  it("lab manager of the owning lab is in custody", () => {
    expect(isInCustody(user("LAB_MANAGER", { managerOf: [LAB_A] }), container({ custodianId: "other" }))).toBe(true);
  });
  it("manager of a different lab is NOT in custody", () => {
    expect(isInCustody(user("LAB_MANAGER", { managerOf: [LAB_B] }), container({ custodianId: "other" }))).toBe(false);
  });
  it("plain member of the owning lab is NOT in custody", () => {
    expect(isInCustody(user("LAB_USER", { memberOf: [LAB_A] }), container({ custodianId: "other" }))).toBe(false);
  });
});

describe("container action matrix", () => {
  it("everyone signed-in can view", () => {
    for (const role of Object.values(Role)) {
      expect(authorizeContainer(user(role), "view", container())).toBe("editable");
    }
  });

  it("deduct: own custody → editable; someone else's → request-only", () => {
    const u = user("LAB_USER");
    expect(authorizeContainer(u, "deduct", container({ custodianId: "u1" }))).toBe("editable");
    expect(authorizeContainer(u, "deduct", container({ custodianId: "other" }))).toBe("request-only");
  });

  it("viewer never edits and never sees request affordances", () => {
    const u = user("VIEWER");
    expect(authorizeContainer(u, "deduct", container({ custodianId: "u1" }))).toBe("read-only");
    expect(authorizeContainer(u, "dispose", container())).toBe("read-only");
  });

  it("lab user cannot add stock even in own custody", () => {
    expect(authorizeContainer(user("LAB_USER"), "add", container({ custodianId: "u1" }))).toBe("request-only");
  });

  it("custodian role can add within custody", () => {
    expect(authorizeContainer(user("CUSTODIAN"), "add", container({ custodianId: "u1" }))).toBe("editable");
  });

  it("lab manager can transfer anywhere; custodian only within custody", () => {
    expect(authorizeContainer(user("LAB_MANAGER"), "transfer", container({ custodianId: "x" }))).toBe("editable");
    expect(authorizeContainer(user("CUSTODIAN"), "transfer", container({ custodianId: "x" }))).toBe("request-only");
  });

  it("EHS officer can dispose anywhere but cannot deduct", () => {
    const u = user("EHS_OFFICER");
    expect(authorizeContainer(u, "dispose", container())).toBe("editable");
    expect(authorizeContainer(u, "deduct", container({ custodianId: "u1" }))).toBe("request-only");
  });
});

describe("controlled substances — separation of duties", () => {
  const controlled = (custodianId: string | null = null) =>
    container({ isControlled: true, custodianId });

  it("ADMIN is explicitly denied on controlled substances", () => {
    // Admin can otherwise add anywhere; controlled gate must win.
    expect(authorizeContainer(user("ADMIN"), "add", controlled())).toBe("restricted");
    expect(authorizeContainer(user("ADMIN"), "deduct", controlled("u1"))).toBe("restricted");
    expect(authorizeContainer(user("ADMIN"), "dispose", controlled())).toBe("restricted");
  });

  it("EHS officer handles controlled substances anywhere", () => {
    expect(authorizeContainer(user("EHS_OFFICER"), "dispose", controlled())).toBe("editable");
  });

  it("custodian handles controlled only within custody", () => {
    expect(authorizeContainer(user("CUSTODIAN"), "deduct", controlled("u1"))).toBe("editable");
    expect(authorizeContainer(user("CUSTODIAN"), "deduct", controlled("other"))).toBe("restricted");
  });

  it("lab user never handles controlled, even as named custodian", () => {
    expect(authorizeContainer(user("LAB_USER"), "deduct", controlled("u1"))).toBe("restricted");
  });
});

describe("global actions", () => {
  it("only ADMIN manages users", () => {
    expect(can(user("ADMIN"), "manage_users")).toBe(true);
    for (const role of ["VIEWER", "LAB_USER", "CUSTODIAN", "LAB_MANAGER", "EHS_OFFICER"] as const) {
      expect(can(user(role), "manage_users")).toBe(false);
    }
  });

  it("EHS and ADMIN edit GHS; lab manager does not", () => {
    expect(can(user("EHS_OFFICER"), "edit_ghs")).toBe(true);
    expect(can(user("ADMIN"), "edit_ghs")).toBe(true);
    expect(can(user("LAB_MANAGER", { managerOf: [LAB_A] }), "edit_ghs")).toBe(false);
  });

  it("stocktake sign-off is scoped to managed labs for lab managers", () => {
    const u = user("LAB_MANAGER", { managerOf: [LAB_A] });
    expect(can(u, "sign_off_stocktake", LAB_A)).toBe(true);
    expect(can(u, "sign_off_stocktake", LAB_B)).toBe(false);
    expect(can(user("EHS_OFFICER"), "sign_off_stocktake", LAB_B)).toBe(true);
  });
});
