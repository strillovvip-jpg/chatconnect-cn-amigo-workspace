import { describe, expect, it } from "vitest";
import { hashClaimSecret } from "../../convex/claimCredentials";
import { createClaimCredential } from "./claim-credential";

describe("createClaimCredential", () => {
  it("creates a high-entropy browser credential whose digest matches Convex", async () => {
    const activation = await createClaimCredential(" safe1 ");
    const [code, secret] = activation.credential.split(".");

    expect(activation.code).toBe("SAFE1");
    expect(code).toBe("SAFE1");
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(activation.claimSecretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(activation.claimSecretHash).toBe(
      await hashClaimSecret("SAFE1", secret),
    );
    expect(activation.claimSecretHash).not.toContain(secret);
  });

  it("creates a new secret each time", async () => {
    const first = await createClaimCredential("SAFE1");
    const second = await createClaimCredential("SAFE1");

    expect(first.credential).not.toBe(second.credential);
    expect(first.claimSecretHash).not.toBe(second.claimSecretHash);
  });
});
