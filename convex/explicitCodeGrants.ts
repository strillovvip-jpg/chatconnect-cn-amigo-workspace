const normalize = (value: string) => value.trim().toUpperCase();

export const COMPANY_1_TENANT_ID = "nersp";
export const COMPANY_2_TENANT_ID = "bjqaf";

export const COMPANY_1_LINE2_CODES = new Set([
  "NINWQ",
  "JKASQ",
  "IFQHT",
  "OYSMH",
  "WCBYQ",
  "TTYQI",
  "OJQML",
  "TQJGR",
  "WMOZP",
  "VMRVM",
]);

export const COMPANY_1_LIMITED_CODES = new Set([
  "QQQLJ",
  "KZUWY",
  "UFZYH",
  "XPHHV",
  "CEOFG",
  "TFTCT",
  "CLNST",
  "NMJIU",
  "EHQLF",
  "SNRYO",
  "YANET",
  "ABSMH",
  "GQDAP",
  "HBCLA",
  "MAGAQ",
  "VJSLX",
  "DYEMV",
  "GLXKN",
  "XZEEA",
  "TFJYW",
  "ROPXC",
  "HDPXT",
  "OLEOB",
  "LLPFW",
  "WJSGI",
  "PXCEX",
  "VNVLP",
  "TQYLU",
  "HASSQ",
  "SXVID",
  "JIBFC",
  "DVNHL",
  "ZKFLU",
  "MCWQJ",
  "LXNXY",
  "JVAKV",
  "AWGLT",
  "YFFGS",
  "MQKWX",
  "OIJNO",
  "ENJIZ",
  "SDIVJ",
  "NIBTH",
  "LWRFA",
  "INJWV",
  "TCWHR",
  "MVQVW",
  "AIEVY",
  "LZWKT",
  "WKIHD",
]);

export const COMPANY_2_LINE2_CODES = new Set([
  "DSSYY",
  "VBXAT",
  "NYTOB",
  "EIXMN",
  "GFOTB",
  "EXPKD",
  "UHYTR",
  "CGCUK",
  "ERGRU",
  "XLJPC",
]);

export const COMPANY_2_LIMITED_CODES = new Set([
  "FRGOD",
  "MJPCW",
  "LXXKA",
  "RNGEC",
  "IXWMG",
  "CJFTZ",
  "NBAWY",
  "PFFOU",
  "ZCDAK",
  "MLTRX",
  "GHBTH",
  "WNIYI",
  "TQGRI",
  "SSUSM",
  "VRKKX",
  "IWDAJ",
  "VPMXQ",
  "CPGML",
  "EDSBZ",
  "OXUSC",
  "USIDB",
  "DBDLS",
  "LAREH",
  "AJFLC",
  "MFVIO",
  "FBROU",
  "XMOLQ",
  "BFZBI",
  "XPMDD",
  "JKMNT",
  "CQXLD",
  "MUWVR",
  "QUZFX",
  "RTYEY",
  "UUJCZ",
  "NGQBQ",
  "NHGTL",
  "LEESE",
  "SPCIF",
  "THJWE",
  "BDDYA",
  "IVYGH",
  "ULRTX",
  "NUZRP",
  "FYIBU",
  "MHRIH",
  "XIYHW",
  "WFWAL",
  "XASJV",
  "JRMHV",
]);

const COMPANY_2_USER_CODES = new Set([
  ...COMPANY_2_LINE2_CODES,
  ...COMPANY_2_LIMITED_CODES,
]);

export function explicitCodeHasExpectedTenantAndRole(
  code: string,
  tenantId: string,
  role: string,
) {
  if (role !== "user") return false;
  const normalizedCode = normalize(code);
  const normalizedTenantId = tenantId.trim().toLowerCase();
  if (
    COMPANY_1_LINE2_CODES.has(normalizedCode) ||
    COMPANY_1_LIMITED_CODES.has(normalizedCode)
  )
    return normalizedTenantId === COMPANY_1_TENANT_ID;
  if (
    COMPANY_2_LINE2_CODES.has(normalizedCode) ||
    COMPANY_2_LIMITED_CODES.has(normalizedCode)
  )
    return normalizedTenantId === COMPANY_2_TENANT_ID;
  return false;
}

/**
 * Explicit communication bridge requested for these fixed cohorts only:
 * old Line2 can communicate with every Company 2 user, while Company 2
 * Line2 can additionally communicate with the old limited customer cohort.
 */
export function isExplicitCommunicationPair(first: string, second: string) {
  const a = normalize(first);
  const b = normalize(second);
  if (a === b) return false;
  return (
    (COMPANY_1_LINE2_CODES.has(a) && COMPANY_2_USER_CODES.has(b)) ||
    (COMPANY_1_LINE2_CODES.has(b) && COMPANY_2_USER_CODES.has(a)) ||
    (COMPANY_2_LINE2_CODES.has(a) && COMPANY_1_LIMITED_CODES.has(b)) ||
    (COMPANY_2_LINE2_CODES.has(b) && COMPANY_1_LIMITED_CODES.has(a))
  );
}
