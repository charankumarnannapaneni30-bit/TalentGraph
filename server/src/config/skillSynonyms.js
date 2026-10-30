const groups = [
  ["javascript", "js", "ecmascript"],
  ["typescript", "ts"],
  ["react", "reactjs", "react.js"],
  ["node.js", "nodejs", "node"],
  ["postgresql", "postgres", "postgres db"],
  ["amazon web services", "aws"],
  ["google cloud platform", "gcp"],
  ["microsoft azure", "azure"],
  ["machine learning", "ml"],
  ["artificial intelligence", "ai"],
  ["c#", "csharp"],
  ["ci/cd", "continuous integration"],
];

const canonical = new Map();
for (const group of groups) {
  const name = group[0];
  for (const alias of group) canonical.set(normalize(alias), name);
}

export function normalize(value = "") {
  return String(value).normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function canonicalSkill(value = "") {
  const normalized = normalize(value);
  return canonical.get(normalized) || normalized;
}

export function sameSkill(a, b) {
  return canonicalSkill(a) === canonicalSkill(b);
}
