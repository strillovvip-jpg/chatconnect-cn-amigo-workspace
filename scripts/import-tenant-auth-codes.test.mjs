import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTenantCredentialImport,
  normalizeTenantImportPayload,
} from "./import-tenant-auth-codes.mjs";

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

test("builds a hash-only tenant request and a separate one-time credential artifact", () => {
  const bundle = buildTenantCredentialImport(
    {
      companyId: "aichijp",
      fullCodes: codes("AF", 20),
      limitedCodes: codes("AL", 50),
      administrators: [
        {
          code: "ROOT1",
          role: "super_admin",
          companyId: "aichijp",
          unlimitedDevices: true,
        },
      ],
    },
    () => "A",
  );
  const rawSecret = "A".repeat(32);

  assert.equal(bundle.request.claimSecretHashes.length, 71);
  assert.ok(
    bundle.request.claimSecretHashes.every(({ hash }) =>
      /^[a-f0-9]{64}$/.test(hash),
    ),
  );
  assert.equal(JSON.stringify(bundle.request).includes(rawSecret), false);
  assert.equal(bundle.artifact.credentials.length, 71);
  assert.match(
    bundle.artifact.credentials[0].credential,
    new RegExp(`^[A-Z0-9]{4,20}\\.${rawSecret}$`),
  );
});
