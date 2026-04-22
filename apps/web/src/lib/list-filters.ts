const GREATER_SEATTLE_TERMS = [
  "seattle",
  "bellevue",
  "redmond",
  "kirkland",
  "renton",
  "bothell",
  "issaquah",
  "shoreline",
  "everett",
  "tacoma",
  "eastside",
  "puget sound",
  "greater seattle",
  "seattle metro",
] as const;

export type LocationPreset = "all" | "greater_seattle" | "seattle" | "remote";

export function readSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

export function matchesSearch(haystacks: Array<string | null | undefined>, query: string) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return true;
  }

  return haystacks.some((value) => normalizeText(value).includes(normalizedQuery));
}

export function matchesStatus(status: string, statusFilter: string) {
  if (!statusFilter || statusFilter === "all") {
    return true;
  }
  return status === statusFilter;
}

export function matchesSource(source: string, sourceFilter: string) {
  if (!sourceFilter || sourceFilter === "all") {
    return true;
  }
  return normalizeText(source).includes(normalizeText(sourceFilter));
}

export function matchesLocation(options: {
  location: string | null | undefined;
  preset: string;
  customLocation: string;
}) {
  const normalizedLocation = normalizeText(options.location);
  const normalizedCustomLocation = normalizeText(options.customLocation);

  if (options.preset === "greater_seattle" && !isGreaterSeattleArea(normalizedLocation)) {
    return false;
  }

  if (options.preset === "seattle" && !normalizedLocation.includes("seattle")) {
    return false;
  }

  if (options.preset === "remote" && !normalizedLocation.includes("remote")) {
    return false;
  }

  if (normalizedCustomLocation && !normalizedLocation.includes(normalizedCustomLocation)) {
    return false;
  }

  return true;
}

export function isGreaterSeattleArea(location: string | null | undefined) {
  const normalizedLocation = normalizeText(location);
  return GREATER_SEATTLE_TERMS.some((term) => normalizedLocation.includes(term));
}

export function formatLocationPreset(preset: string) {
  switch (preset) {
    case "greater_seattle":
      return "Greater Seattle Area";
    case "seattle":
      return "Seattle only";
    case "remote":
      return "Remote";
    default:
      return "All locations";
  }
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}
