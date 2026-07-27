import * as fs from 'fs';
import * as path from 'path';

// Forbidden phrases list (regular expressions with word boundaries)
const FORBIDDEN_PATTERNS = [
  { name: 'morale check', regex: /\bmorale\s+check\b/i },
  { name: 'chequeo de moral', regex: /\bchequeo\s+de\s+moral\b/i },
  { name: 'tirada de moral', regex: /\btirada\s+de\s+moral\b/i },
  { name: 'OSR morale', regex: /\bosr\s+morale\b/i },
  { name: 'moral OSR', regex: /\bmoral\s+osr\b/i },
  { name: 'THAC0', regex: /\bthac0\b/i },
  { name: 'AC descendente', regex: /\bac\s+descendente\b/i },
  { name: 'descending AC', regex: /\bdescending\s+ac\b/i },
  { name: 'saving throw vs', regex: /\bsaving\s+throw\s+vs\b/i },
  { name: 'save vs death', regex: /\bsave\s+vs\s+death\b/i },
  { name: 'save vs wands', regex: /\bsave\s+vs\s+wands\b/i },
  { name: 'gold for XP', regex: /\bgold\s+for\s+xp\b/i },
  { name: 'XP por oro', regex: /\bxp\s+por\s+oro\b/i },
  { name: 'AD&D', regex: /\bad&d\b/i },
  { name: 'OSR', regex: /\bosr\b/i },
  { name: 'mandatory rest', regex: /\bmandatory\s+rest\b/i },
  { name: 'reaction roll', regex: /\breaction\s+roll\b/i },
  { name: 'gold-to-XP conversion', regex: /\b(?:convert|exchange)\s+gold\s+(?:to|for|into)\s+xp\b/i },
  { name: 'fixed ten-minute dungeon turn', regex: /\b(?:10|ten)[- ]minute\s+(?:dungeon\s+)?turn\b/i },
];

// Scan paths for this specific narrative roadmap
const SCAN_PATHS = [
  '.agents/skills/narrative-canon/SKILL.md',
  'docs/NARRATIVE_SAFETY.md',
  'app',
  'lib/ai',
  'lib/memory',
  'lib/narrative',
  'lib/rules',
  'prisma/schema.prisma',
  'tests/narrative'
];

// Files to ignore to avoid self-flagging of rules definitions
const IGNORE_FILES = [
  'check-retro-jargon.ts',
  'NARRATIVE_SAFETY.md',
  'SKILL.md',
  // EXCLUSIÓN CONTROLADA: 'negative-controls.test.ts' contiene deliberadamente fixtures con términos prohibidos
  // para verificar que el validador narrativo rechace estas palabras de forma correcta en sus aserciones.
  // Esta exclusión NO autoriza el uso de jerga retro en código de producción.
  // Cualquier otro archivo nuevo de pruebas bajo 'tests/narrative' DEBE superar el escaneo obligatoriamente.
  'negative-controls.test.ts',
];

let violationsCount = 0;

function scanFile(filePath: string) {
  const baseName = path.basename(filePath);
  if (IGNORE_FILES.includes(baseName)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    FORBIDDEN_PATTERNS.forEach((pattern) => {
      if (pattern.regex.test(line)) {
        console.error(`Violation found in ${filePath}:${index + 1} - Pattern: "${pattern.name}"`);
        console.error(`> ${line.trim()}`);
        violationsCount++;
      }
    });
  });
}

function scanDirectoryRecursively(dirPath: string) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.next' && entry.name !== '.venv') {
        scanDirectoryRecursively(fullPath);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (['.ts', '.tsx', '.js', '.jsx', '.md'].includes(ext)) {
        scanFile(fullPath);
      }
    }
  }
}

console.log('Running Dungeon Cortex anti-retro jargon scan...');
SCAN_PATHS.forEach((scanPath) => {
  const absolutePath = path.resolve(scanPath);
  if (fs.existsSync(absolutePath)) {
    const stats = fs.statSync(absolutePath);
    if (stats.isDirectory()) {
      console.log(`Scanning directory: ${scanPath}`);
      scanDirectoryRecursively(absolutePath);
    } else if (stats.isFile()) {
      console.log(`Scanning file: ${scanPath}`);
      scanFile(absolutePath);
    }
  } else {
    console.log(`Path skipped (not found): ${scanPath}`);
  }
});

if (violationsCount > 0) {
  console.error(`\nScan failed: ${violationsCount} violations found.`);
  process.exit(1);
} else {
  console.log('\nScan completed successfully: No retro jargon detected.');
  process.exit(0);
}
