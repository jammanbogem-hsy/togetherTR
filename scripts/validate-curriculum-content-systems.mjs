import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const defaultDir = path.join(repoRoot, "data", "curriculum-content-systems");
const requiredCategories = ["지식⋅이해", "과정⋅기능", "가치⋅태도"];

const inputFiles = process.argv.slice(2);
const files =
  inputFiles.length > 0
    ? inputFiles.map((file) => path.resolve(repoRoot, file))
    : (await readdir(defaultDir))
        .filter((file) => file.endsWith(".json"))
        .map((file) => path.join(defaultDir, file));

let hasError = false;

for (const file of files) {
  const errors = await validateFile(file);
  if (errors.length > 0) {
    hasError = true;
    console.error(`[FAIL] ${path.relative(repoRoot, file)}`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    continue;
  }

  console.log(`[OK] ${path.relative(repoRoot, file)}`);
}

if (hasError) {
  process.exitCode = 1;
}

async function validateFile(file) {
  const errors = [];
  let data;

  try {
    data = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    return [`JSON parse failed: ${error.message}`];
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return ["top-level value must be an object"];
  }

  if (!data.메타 || typeof data.메타 !== "object") {
    errors.push("메타 object is required");
  } else if (data.메타.스키마 !== "curriculum-content-system.v1") {
    errors.push("메타.스키마 must be curriculum-content-system.v1");
  }

  if (!Array.isArray(data.내용체계) || data.내용체계.length === 0) {
    errors.push("내용체계 must be a non-empty array");
    return errors;
  }

  data.내용체계.forEach((entry, index) => {
    const label = `내용체계[${index}]`;
    requireString(errors, entry, "교육과정", label);
    requireString(errors, entry, "과목", label);
    requireString(errors, entry, "영역", label);
    requireStringArray(errors, entry, "핵심아이디어", label);

    const hasGradeBands = entry.학년군별 && typeof entry.학년군별 === "object";
    const hasContentElements = entry.내용요소 && typeof entry.내용요소 === "object";

    if (!hasGradeBands && !hasContentElements) {
      errors.push(`${label}: either 학년군별 or 내용요소 is required`);
      return;
    }

    if (hasGradeBands) {
      for (const [gradeBand, categories] of Object.entries(entry.학년군별)) {
        if (!categories || typeof categories !== "object" || Array.isArray(categories)) {
          errors.push(`${label}.학년군별.${gradeBand}: category object is required`);
          continue;
        }
        validateCategoryObject(errors, categories, `${label}.학년군별.${gradeBand}`);
      }
    }

    if (hasContentElements) {
      validateCategoryObject(errors, entry.내용요소, `${label}.내용요소`);
      validateKnowledgeItems(errors, entry.내용요소["지식⋅이해"], `${label}.내용요소.지식⋅이해`);
    }
  });

  return errors;
}

function validateCategoryObject(errors, categories, label) {
  for (const category of requiredCategories) {
    if (!Array.isArray(categories[category]) || categories[category].length === 0) {
      errors.push(`${label}.${category}: non-empty array is required`);
    }
  }
}

function validateKnowledgeItems(errors, items, label) {
  if (!Array.isArray(items)) {
    return;
  }

  items.forEach((item, index) => {
    if (typeof item === "string") {
      return;
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${label}[${index}]: must be a string or object`);
      return;
    }

    requireString(errors, item, "질문", `${label}[${index}]`);
    requireStringArray(errors, item, "요소", `${label}[${index}]`);
  });
}

function requireString(errors, object, key, label) {
  if (typeof object?.[key] !== "string" || object[key].trim() === "") {
    errors.push(`${label}.${key}: non-empty string is required`);
  }
}

function requireStringArray(errors, object, key, label) {
  if (!Array.isArray(object?.[key]) || object[key].length === 0) {
    errors.push(`${label}.${key}: non-empty array is required`);
    return;
  }

  object[key].forEach((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      errors.push(`${label}.${key}[${index}]: non-empty string is required`);
    }
  });
}
