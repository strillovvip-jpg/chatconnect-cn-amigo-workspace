import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTenantImportPayload } from "./import-tenant-auth-codes.mjs";

const codes = (prefix, count) =>
  Array.from(
    { length: count },
    (_, index) => `${prefix}${String(index).padStart(3, "0")}`,
  );

test("accepts one aichijp tenant with 20 full and 50 limited codes", () => {
  const payload = normalizeTenantImportPayload({
    companyId: "AICHIJP",
    fullCodes: codes("AF", 20),
    limitedCodes: codes("AL", 50),
    administrators: [
      {
        code: "ROOT1",
        role: "super_admin",
        companyId: "AICHIJP",
        unlimitedDevices: true,
      },
    ],
  });

  assert.equal(payload.companyId, "aichijp");
  assert.equal(payload.fullCodes.length, 20);
  assert.equal(payload.limitedCodes.length, 50);
  assert.deepEqual(payload.administrators[0], {
    code: "ROOT1",
    role: "super_admin",
    companyId: "aichijp",
    unlimitedDevices: true,
  });
});

test("rejects invalid counts and cross-tenant administrators before running Convex", () => {
  assert.throws(
    () =>
      normalizeTenantImportPayload({
        companyId: "aichijp",
        fullCodes: codes("AF", 19),
        limitedCodes: codes("AL", 50),
        administrators: [],
      }),
    /20 full codes/,
  );
  assert.throws(
    () =>
      normalizeTenantImportPayload({
        companyId: "aichijp",
        fullCodes: codes("AF", 20),
        limitedCodes: codes("AL", 50),
        administrators: [
          {
            code: "ROOT1",
            role: "super_admin",
            companyId: "nyfbi",
          },
        ],
      }),
    /same tenant/,
  );
  assert.throws(
    () =>
      normalizeTenantImportPayload({
        companyId: "aichijp",
        fullCodes: codes("AF", 20),
        limitedCodes: codes("AL", 50),
        administrators: [
          {
            code: "ROOT1",
            role: "super_admin",
            companyId: "aichijp",
          },
          {
            code: "ROOT2",
            role: "admin",
            companyId: "aichijp",
          },
        ],
      }),
    /Exactly one tenant administrator/,
  );
});
