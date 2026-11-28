import { assertEquals } from "@std/assert";
import { getMemberManagementDenial } from "../_shared/member-management.ts";

Deno.test("owner can promote a member to admin", () => {
  assertEquals(getMemberManagementDenial({
    actorRole: "owner", targetRole: "member", action: "set_role", requestedRole: "admin",
  }), null);
});

Deno.test("owner can demote an admin to member", () => {
  assertEquals(getMemberManagementDenial({
    actorRole: "owner", targetRole: "admin", action: "set_role", requestedRole: "member",
  }), null);
});

Deno.test("owner can remove an ordinary member", () => {
  assertEquals(getMemberManagementDenial({
    actorRole: "owner", targetRole: "member", action: "remove",
  }), null);
});

Deno.test("owner membership cannot be changed by another owner", () => {
  assertEquals(getMemberManagementDenial({
    actorRole: "owner", targetRole: "owner", action: "set_role", requestedRole: "member",
  }), "OWNER_MEMBERSHIP_PROTECTED");
});

Deno.test("owner membership cannot be removed by another owner", () => {
  assertEquals(getMemberManagementDenial({
    actorRole: "owner", targetRole: "owner", action: "remove",
  }), "OWNER_MEMBERSHIP_PROTECTED");
});

Deno.test("admin can remove an ordinary member", () => {
  assertEquals(getMemberManagementDenial({
    actorRole: "admin", targetRole: "member", action: "remove",
  }), null);
});

Deno.test("admin cannot promote a member to admin", () => {
  assertEquals(getMemberManagementDenial({
    actorRole: "admin", targetRole: "member", action: "set_role", requestedRole: "admin",
  }), "OWNER_PERMISSION_REQUIRED");
});

Deno.test("admin cannot modify or remove another admin", () => {
  assertEquals(getMemberManagementDenial({
    actorRole: "admin", targetRole: "admin", action: "remove",
  }), "OWNER_PERMISSION_REQUIRED");
});

Deno.test("admin cannot modify or remove an owner", () => {
  assertEquals(getMemberManagementDenial({
    actorRole: "admin", targetRole: "owner", action: "remove",
  }), "OWNER_MEMBERSHIP_PROTECTED");
});

Deno.test("member cannot manage memberships", () => {
  assertEquals(getMemberManagementDenial({
    actorRole: "member", targetRole: "member", action: "remove",
  }), "TEAM_ADMIN_REQUIRED");
});

Deno.test("owner cannot assign unsupported roles", () => {
  assertEquals(getMemberManagementDenial({
    actorRole: "owner", targetRole: "member", action: "set_role", requestedRole: "superadmin",
  }), "INVALID_ROLE");
});

Deno.test("admin can demote an admin only when target is ordinary member? no", () => {
  assertEquals(getMemberManagementDenial({
    actorRole: "admin", targetRole: "admin", action: "set_role", requestedRole: "member",
  }), "OWNER_PERMISSION_REQUIRED");
});
