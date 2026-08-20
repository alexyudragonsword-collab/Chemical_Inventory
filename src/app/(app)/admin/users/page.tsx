// Users & roles — the matrix that decides which stepper is enabled on every
// row in the product, rendered read-only straight from authz.ts so the admin
// screen can never disagree with the enforcement code.

import { prisma } from "@/lib/prisma";
import {
  ALL_ROLES,
  can,
  CONTAINER_MATRIX,
  CONTROLLED_HANDLING,
  GLOBAL_MATRIX,
  type MatrixCell,
} from "@/server/authz";
import { requireUser } from "@/server/session";
import { Pill } from "@/components/pills";
import { createUserAction, setMembershipAction, updateUserAction } from "./actions";

export const dynamic = "force-dynamic";

const CONTAINER_ROWS: [keyof typeof CONTAINER_MATRIX, string][] = [
  ["view", "View all labs"],
  ["deduct", "Deduct quantity"],
  ["add", "Add / receive stock"],
  ["transfer", "Transfer custody"],
  ["dispose", "Dispose container"],
  ["approve_transfer", "Approve transfer request"],
];
const GLOBAL_ROWS: [keyof typeof GLOBAL_MATRIX, string][] = [
  ["edit_ghs", "Edit GHS classification"],
  ["sign_off_stocktake", "Sign off stocktake"],
  ["view_audit", "View audit trail"],
  ["manage_users", "Manage users & roles"],
];

export default async function UsersPage() {
  const user = await requireUser();
  if (!can(user, "manage_users")) {
    return <p className="text-sm text-muted">Admin only.</p>;
  }

  const [users, labs] = await Promise.all([
    prisma.user.findMany({
      include: {
        labMemberships: { include: { lab: { select: { code: true } } } },
        _count: { select: { custodyContainers: { where: { status: { notIn: ["DISPOSED"] } } } } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.lab.findMany({ select: { id: true, code: true }, orderBy: { code: "asc" } }),
  ]);

  return (
    <div className="max-w-6xl">
      <h1 className="text-xl font-semibold text-teal-deep">Roles &amp; permissions</h1>
      <p className="text-sm text-muted">
        Admin · Access control · {ALL_ROLES.length} roles · {users.length} users
      </p>

      {/* Permission matrix */}
      <section className="mt-5 overflow-x-auto rounded-lg border border-line bg-card p-4">
        <h2 className="text-sm font-semibold text-teal-deep">
          Permission matrix{" "}
          <span className="ml-2 text-xs font-normal text-muted">
            ✓ allowed · ◐ own custody only · ✕ denied — defined in code, shown here read-only
          </span>
        </h2>
        <table className="mt-2 text-sm">
          <thead>
            <tr>
              <th className="pr-4 text-left text-xs font-medium text-muted" />
              {ALL_ROLES.map((role) => (
                <th key={role} className="px-3 py-1 text-xs font-medium text-muted">
                  {roleLabel(role)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CONTAINER_ROWS.map(([action, label]) => (
              <tr key={action} className="border-t border-line">
                <td className="py-1.5 pr-4">{label}</td>
                {ALL_ROLES.map((role) => (
                  <td key={role} className="px-3 py-1.5 text-center">
                    <Cell value={CONTAINER_MATRIX[action][role]} />
                  </td>
                ))}
              </tr>
            ))}
            {GLOBAL_ROWS.map(([action, label]) => (
              <tr key={action} className="border-t border-line">
                <td className="py-1.5 pr-4">{label}</td>
                {ALL_ROLES.map((role) => (
                  <td key={role} className="px-3 py-1.5 text-center">
                    <Cell value={GLOBAL_MATRIX[action][role]} />
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-line bg-restricted-soft/40">
              <td className="py-1.5 pr-4 font-medium">Handle controlled substances</td>
              {ALL_ROLES.map((role) => (
                <td key={role} className="px-3 py-1.5 text-center">
                  <Cell value={CONTROLLED_HANDLING[role]} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">
          Deliberate separation of duties: Admin configures the system but can never dispense
          scheduled material — that permission belongs to the EHS Officer. A user&apos;s editable
          set = containers where they are the named custodian, plus containers in labs where they
          hold the manager flag.
        </p>
      </section>

      {/* Create user */}
      <details className="mt-5 rounded-lg border border-line bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-teal-deep">
          + New user
        </summary>
        <form action={createUserAction} className="flex flex-wrap items-end gap-3 border-t border-line p-4">
          <label className="text-xs font-semibold tracking-wide text-muted uppercase">
            Name
            <input name="name" required className="input mt-1 w-44" />
          </label>
          <label className="text-xs font-semibold tracking-wide text-muted uppercase">
            Email
            <input name="email" type="email" required className="input mt-1 w-56" />
          </label>
          <label className="text-xs font-semibold tracking-wide text-muted uppercase">
            Initial password (min 8)
            <input name="password" type="text" required minLength={8} className="input mt-1 w-40" />
          </label>
          <label className="text-xs font-semibold tracking-wide text-muted uppercase">
            Role
            <select name="role" className="input mt-1 w-36" defaultValue="LAB_USER">
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold tracking-wide text-muted uppercase">
            Lab
            <select name="labId" className="input mt-1 w-32" defaultValue="">
              <option value="">None</option>
              {labs.map((l) => (
                <option key={l.id} value={l.id}>{l.code}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" name="isManager" /> lab manager
          </label>
          <button className="rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep">
            Create
          </button>
        </form>
      </details>

      {/* User list */}
      <div className="mt-5 overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-2 py-2.5">Role</th>
              <th className="px-2 py-2.5">Labs</th>
              <th className="px-2 py-2.5 text-right">Containers</th>
              <th className="px-2 py-2.5">Status</th>
              <th className="px-4 py-2.5">Change</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-line last:border-0 align-top">
                <td className="px-4 py-2">
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-muted">{u.email}</div>
                </td>
                <td className="px-2 py-2">{roleLabel(u.role)}</td>
                <td className="px-2 py-2 text-xs">
                  {u.labMemberships.map((m) => (
                    <form action={setMembershipAction} key={m.id} className="inline-flex items-center gap-0.5">
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="labId" value={m.labId} />
                      <input type="hidden" name="remove" value="1" />
                      <span className="mr-1 rounded bg-paper px-1.5 py-0.5">
                        {m.lab.code}
                        {m.isManager ? " (mgr)" : ""}
                        <button className="ml-1 text-muted hover:text-danger" title="Remove membership">×</button>
                      </span>
                    </form>
                  ))}
                  <form action={setMembershipAction} className="mt-1 flex items-center gap-1">
                    <input type="hidden" name="userId" value={u.id} />
                    <select name="labId" className="rounded border border-line px-1 py-0.5 text-xs" defaultValue="">
                      <option value="">+ lab…</option>
                      {labs.map((l) => (
                        <option key={l.id} value={l.id}>{l.code}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-0.5 text-[10px]"><input type="checkbox" name="isManager" />mgr</label>
                    <button className="rounded border border-line px-1 text-xs text-muted hover:bg-paper">Add</button>
                  </form>
                </td>
                <td className="px-2 py-2 text-right">{u._count.custodyContainers}</td>
                <td className="px-2 py-2">
                  {u.isActive ? <Pill tone="ok">Active</Pill> : <Pill tone="danger">Disabled</Pill>}
                </td>
                <td className="px-4 py-2">
                  <form action={updateUserAction} className="flex items-center gap-1.5">
                    <input type="hidden" name="userId" value={u.id} />
                    <select name="role" defaultValue={u.role} className="rounded border border-line px-1.5 py-0.5 text-xs">
                      {ALL_ROLES.map((r) => (
                        <option key={r} value={r}>{roleLabel(r)}</option>
                      ))}
                    </select>
                    <select name="isActive" defaultValue={String(u.isActive)} className="rounded border border-line px-1.5 py-0.5 text-xs">
                      <option value="true">active</option>
                      <option value="false">disabled</option>
                    </select>
                    <button className="rounded bg-teal px-2 py-0.5 text-xs font-medium text-white hover:bg-teal-deep">
                      Apply
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ value }: { value: MatrixCell }) {
  if (value === "ALLOW") return <span className="text-ok">✓</span>;
  if (value === "OWN") return <span className="text-accent">◐</span>;
  return <span className="text-muted">✕</span>;
}

function roleLabel(role: string): string {
  return role.toLowerCase().split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}
