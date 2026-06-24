import { existsSync } from "node:fs";
import path from "node:path";

export const YAOTU_COMPANY_BRAND_DEFAULTS = {
  companyName: "Yaotu Technologies, LLC",
  companyEmail: "info@ahhh-yaotu.com",
  companyPhone: "313-310-7902",
  defaultWorkLocation: "Remote",
  defaultSignatoryTitle: "Founder & Manager",
  logo: {
    // TODO: Enable only after a canonical server-readable logo asset is added.
    enabled: false,
    altText: "Yaotu Technologies, LLC",
    assetPath: null as string | null,
    version: "default",
  },
} as const;

export type CompanyBrandDefaults = typeof YAOTU_COMPANY_BRAND_DEFAULTS;

function resolveServerAssetPath(assetPath: string | null) {
  if (!assetPath || /^https?:\/\//i.test(assetPath)) {
    return null;
  }
  return path.isAbsolute(assetPath) ? assetPath : path.resolve(process.cwd(), assetPath);
}

export function companyBrandLogoAsset(options: { warn?: boolean } = {}) {
  const logo = YAOTU_COMPANY_BRAND_DEFAULTS.logo;
  if (!logo.enabled || !logo.assetPath) {
    return null;
  }

  const resolvedPath = resolveServerAssetPath(logo.assetPath);
  if (!resolvedPath || !existsSync(resolvedPath)) {
    if (options.warn) {
      console.warn("[company-brand] Logo asset is enabled but not readable; omitting logo.", {
        version: logo.version,
      });
    }
    return null;
  }

  return {
    assetPath: resolvedPath,
    altText: logo.altText,
    version: logo.version,
    assetId: logo.version,
  };
}

export function publicCompanyBrandDefaults() {
  const { logo, ...textDefaults } = YAOTU_COMPANY_BRAND_DEFAULTS;
  const logoAsset = companyBrandLogoAsset();
  return {
    ...textDefaults,
    logo: {
      enabled: Boolean(logoAsset),
      altText: logo.altText,
      version: logo.version,
      hasAsset: Boolean(logoAsset),
    },
  };
}

export function companyBrandSnapshot() {
  const { logo, ...textDefaults } = YAOTU_COMPANY_BRAND_DEFAULTS;
  const logoAsset = companyBrandLogoAsset();
  return {
    ...textDefaults,
    logo: {
      enabled: Boolean(logoAsset),
      altText: logo.altText,
      version: logo.version,
      assetId: logoAsset?.assetId ?? null,
    },
  };
}
