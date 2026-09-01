import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync("client/src/App.tsx", "utf8");
const shellSource = readFileSync("client/src/components/V2Shell.tsx", "utf8");
const homeSource = readFileSync("client/src/pages/V2Home.tsx", "utf8");
const accessSource = readFileSync("client/src/lib/v2StaffAccess.ts", "utf8");
const financeManagementSource = readFileSync(
  "client/src/pages/FinanceManagement.tsx",
  "utf8",
);
const sidebarSource = readFileSync("client/src/components/Sidebar.tsx", "utf8");
const packageSource = readFileSync("package.json", "utf8");
const wranglerSource = readFileSync("wrangler.jsonc", "utf8");
const combinedV2ShellSource = `${appSource}\n${shellSource}\n${homeSource}\n${accessSource}`;

test("build target separates legacy Render and Worker V2 entry behavior", () => {
  assert.match(
    appSource,
    /const isV2Surface = import\.meta\.env\.VITE_AUTHFLOW_SURFACE === "v2";/,
  );
  assert.match(appSource, /if \(isV2Surface && location === "\/"\)/);
  assert.match(appSource, /setLocation\("\/v2"\)/);
  assert.match(
    appSource,
    /if \(!isV2Surface\) {\s*return <LegacyRouter \/>;\s*}/,
  );
  assert.match(appSource, /<V2Shell>/);
  assert.match(appSource, /<V2Home \/>/);

  const legacyGuardIndex = appSource.indexOf("if (!isV2Surface)");
  const v2ShellIndex = appSource.indexOf('if (location === "/" || location === "/v2")');
  const v2RoutingSource = appSource.slice(v2ShellIndex);
  assert.ok(legacyGuardIndex > -1, "legacy surface guard should exist");
  assert.ok(v2ShellIndex > -1, "V2 shell root branch should exist");
  assert.ok(
    legacyGuardIndex < v2ShellIndex,
    "legacy surface must return the legacy router before V2 shell routing",
  );
  assert.doesNotMatch(
    v2RoutingSource,
    /<LegacyRouter \/>/,
    "Worker V2 surface must not fall through to legacy routes",
  );
  assert.match(v2RoutingSource, /<NotFound \/>/);

  assert.match(
    packageSource,
    /"build": "cross-env VITE_AUTHFLOW_SURFACE=legacy vite build &&/,
  );
  assert.match(
    packageSource,
    /"build:worker": "cross-env VITE_AUTHFLOW_SURFACE=v2 vite build"/,
  );
  assert.match(
    wranglerSource,
    /"build": {\s*"command": "npm run build:worker"\s*}/,
  );
});

test("legacy surface preserves existing Finance Payroll and Tax entry points", () => {
  assert.match(
    appSource,
    /<Route path="\/finance-management\/:section">[\s\S]*<FinanceManagement \/>/,
  );
  assert.match(sidebarSource, /href: "\/finance-management\/payroll"/);
  assert.match(sidebarSource, /href: "\/finance-management\/tax"/);
  assert.match(
    financeManagementSource,
    /type FinanceSection = "overview" \| "expenses" \| "subscriptions" \| "vendors" \| "payroll" \| "tax";/,
  );
  assert.match(financeManagementSource, /selectedSection === "payroll"/);
  assert.match(financeManagementSource, /selectedSection === "tax"/);
});

test("V2 navigation exposes only migrated modules from effective permissions", () => {
  assert.match(accessSource, /permission: "admin_operations"/);
  assert.match(accessSource, /permission: "finance_admin"/);
  assert.match(accessSource, /permission: "verifier_admin"/);
  assert.match(accessSource, /permissions\.includes\("super_admin"\)/);
  assert.doesNotMatch(accessSource, /role\s*===|allowedRoles|ROLE_PERMISSIONS/);

  for (const path of ["/v2/staff", "/v2/finance", "/v2/verifier"]) {
    assert.match(combinedV2ShellSource, new RegExp(path.replace(/\//g, "\\/")));
  }

  assert.doesNotMatch(
    `${shellSource}\n${homeSource}\n${accessSource}`,
    /\/admin-management|\/finance-management|\/verifier-management|payroll|tax|support|documents|lifecycle/i,
  );
});
