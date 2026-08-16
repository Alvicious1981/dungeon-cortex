import {
  PDFDocument,
  PDFTextField,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import {
  characterChangeSchema,
  type CharacterChange,
  type CharacterEditableSnapshot,
} from "@/lib/character-sheet/contracts";
import type { CharacterSheetProps } from "@/components/character/CharacterSheetVTT";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const IMPORT_FIELD_MAP: Record<string, CharacterChange["field"]> = {
  DC_Name: "name",
  DC_Appearance: "appearance",
  DC_Backstory: "backstory",
  DC_PersonalityTraits: "personalityTraits",
  DC_Ideals: "ideals",
  DC_Bonds: "bonds",
  DC_Flaws: "flaws",
  CharacterName: "name",
  "PersonalityTraits ": "personalityTraits",
  PersonalityTraits: "personalityTraits",
  Ideals: "ideals",
  Bonds: "bonds",
  Flaws: "flaws",
  Backstory: "backstory",
};

const APPEARANCE_FIELDS = ["Age", "Height", "Weight", "Eyes", "Skin", "Hair"] as const;

function safePdfText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function drawHeader(page: PDFPage, font: PDFFont, bold: PDFFont, title: string, subtitle: string) {
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 96, width: PAGE_WIDTH, height: 96, color: rgb(0.055, 0.06, 0.09) });
  page.drawText("DUNGEON CORTEX", { x: MARGIN, y: PAGE_HEIGHT - 48, size: 11, font: bold, color: rgb(0.83, 0.65, 0.22) });
  page.drawText(title, { x: MARGIN, y: PAGE_HEIGHT - 72, size: 20, font: bold, color: rgb(0.96, 0.94, 0.86) });
  page.drawText(subtitle, { x: MARGIN, y: PAGE_HEIGHT - 88, size: 8, font, color: rgb(0.68, 0.7, 0.75) });
}

function drawMetric(page: PDFPage, font: PDFFont, bold: PDFFont, x: number, y: number, label: string, value: string) {
  page.drawRectangle({ x, y, width: 78, height: 48, borderWidth: 1, borderColor: rgb(0.35, 0.37, 0.42), color: rgb(0.96, 0.96, 0.95) });
  page.drawText(label, { x: x + 8, y: y + 32, size: 7, font: bold, color: rgb(0.34, 0.35, 0.38) });
  page.drawText(value, { x: x + 8, y: y + 11, size: 15, font: bold, color: rgb(0.08, 0.09, 0.12) });
}

function addEditableField(input: {
  document: PDFDocument;
  page: PDFPage;
  bold: PDFFont;
  name: string;
  label: string;
  value: string;
  y: number;
  height: number;
}) {
  const { document, page, bold, name, label, value, y, height } = input;
  page.drawText(label, { x: MARGIN, y: y + height + 6, size: 8, font: bold, color: rgb(0.2, 0.22, 0.27) });
  const field = document.getForm().createTextField(name);
  field.enableMultiline();
  field.setText(safePdfText(value));
  field.addToPage(page, {
    x: MARGIN,
    y,
    width: CONTENT_WIDTH,
    height,
    borderWidth: 1,
    borderColor: rgb(0.48, 0.49, 0.53),
    backgroundColor: rgb(0.985, 0.985, 0.98),
    textColor: rgb(0.08, 0.09, 0.12),
  });
  field.setFontSize(9);
}

export async function exportCharacterPdf(
  sheet: CharacterSheetProps,
  profile: CharacterEditableSnapshot
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  document.setTitle(`${profile.name} - Dungeon Cortex`);
  document.setSubject("Exportacion de hoja de personaje desde datos canonicos de Dungeon Cortex");
  document.setCreator("Dungeon Cortex");

  const summary = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(summary, font, bold, profile.name, "Resumen generado desde el estado canonico del servidor");
  summary.drawText(`${sheet.identity.race} | ${sheet.identity.className} | Nivel ${sheet.identity.level}`, {
    x: MARGIN,
    y: PAGE_HEIGHT - 126,
    size: 12,
    font: bold,
    color: rgb(0.12, 0.13, 0.16),
  });

  const speed = sheet.core.speedFeet === null ? "N/D" : `${sheet.core.speedFeet} ft`;
  const metrics = [
    ["CA", `${sheet.core.armorClass}`],
    ["PG", `${sheet.core.hitPoints.current}/${sheet.core.hitPoints.max}`],
    ["INICIATIVA", `${sheet.core.initiative >= 0 ? "+" : ""}${sheet.core.initiative}`],
    ["VELOCIDAD", speed],
    ["COMPETENCIA", `+${sheet.core.proficiencyBonus}`],
    ["PERCEPCION", `${sheet.core.passivePerception}`],
  ] as const;
  metrics.forEach(([label, value], index) =>
    drawMetric(summary, font, bold, MARGIN + (index % 3) * 92, PAGE_HEIGHT - 206 - Math.floor(index / 3) * 60, label, value)
  );

  summary.drawText("ATRIBUTOS", { x: MARGIN, y: PAGE_HEIGHT - 294, size: 9, font: bold, color: rgb(0.2, 0.22, 0.27) });
  Object.entries(sheet.abilities).forEach(([key, ability], index) => {
    const x = MARGIN + index * 84;
    summary.drawText(key.toUpperCase(), { x, y: PAGE_HEIGHT - 322, size: 8, font: bold, color: rgb(0.35, 0.36, 0.4) });
    summary.drawText(`${ability.score} (${ability.modifier >= 0 ? "+" : ""}${ability.modifier})`, { x, y: PAGE_HEIGHT - 341, size: 12, font: bold, color: rgb(0.08, 0.09, 0.12) });
  });

  summary.drawText("ATAQUES", { x: MARGIN, y: PAGE_HEIGHT - 382, size: 9, font: bold, color: rgb(0.2, 0.22, 0.27) });
  const attackLines = sheet.attacks.slice(0, 8).map((attack) => `${attack.name}: ${attack.bonus >= 0 ? "+" : ""}${attack.bonus} | ${attack.damage}`);
  (attackLines.length ? attackLines : ["Sin ataques registrados"]).forEach((line, index) => {
    summary.drawText(safePdfText(line).slice(0, 86), { x: MARGIN, y: PAGE_HEIGHT - 404 - index * 17, size: 9, font, color: rgb(0.16, 0.17, 0.2) });
  });

  summary.drawText("INVENTARIO", { x: MARGIN, y: PAGE_HEIGHT - 558, size: 9, font: bold, color: rgb(0.2, 0.22, 0.27) });
  const inventoryLines = sheet.inventory.slice(0, 12).map((item) => `${item.name} x${item.quantity}${item.equipped ? " (equipado)" : ""}`);
  (inventoryLines.length ? inventoryLines : ["Sin objetos registrados"]).forEach((line, index) => {
    summary.drawText(safePdfText(line).slice(0, 90), { x: MARGIN, y: PAGE_HEIGHT - 580 - index * 15, size: 8, font, color: rgb(0.16, 0.17, 0.2) });
  });

  const personality = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(personality, font, bold, "Identidad y personalidad", "Los campos de esta pagina pueden importarse como propuesta revisable");
  addEditableField({ document, page: personality, bold, name: "DC_Name", label: "Nombre", value: profile.name, y: 680, height: 38 });
  addEditableField({ document, page: personality, bold, name: "DC_Appearance", label: "Aspecto", value: profile.appearance, y: 510, height: 130 });
  addEditableField({ document, page: personality, bold, name: "DC_PersonalityTraits", label: "Rasgos de personalidad", value: profile.personalityTraits, y: 350, height: 120 });
  addEditableField({ document, page: personality, bold, name: "DC_Ideals", label: "Ideales", value: profile.ideals, y: 205, height: 105 });
  addEditableField({ document, page: personality, bold, name: "DC_Bonds", label: "Vinculos", value: profile.bonds, y: 60, height: 105 });

  const history = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(history, font, bold, "Historia", "Importar este PDF nunca sobrescribe datos sin validacion y confirmacion");
  addEditableField({ document, page: history, bold, name: "DC_Flaws", label: "Defectos", value: profile.flaws, y: 590, height: 130 });
  addEditableField({ document, page: history, bold, name: "DC_Backstory", label: "Historia", value: profile.backstory, y: 70, height: 470 });

  document.getForm().updateFieldAppearances(font);
  return document.save();
}

export interface ImportedCharacterProfile {
  changes: CharacterChange[];
  warnings: string[];
}

export async function importCharacterProfileFromPdf(bytes: Uint8Array): Promise<ImportedCharacterProfile> {
  if (bytes.length < 5 || new TextDecoder("ascii").decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("El archivo no tiene una cabecera PDF valida.");
  }
  const document = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  if (document.getPageCount() > 20) throw new Error("El PDF contiene demasiadas páginas.");
  const fields = document.getForm().getFields();
  if (fields.length > 400) throw new Error("El PDF contiene demasiados campos.");

  const imported = new Map<CharacterChange["field"], string>();
  const appearanceParts: string[] = [];
  let ignoredPopulatedFields = 0;
  for (const field of fields) {
    if (!(field instanceof PDFTextField)) continue;
    const value = field.getText()?.trim() ?? "";
    if (!value) continue;
    const name = field.getName();
    const mapped = IMPORT_FIELD_MAP[name];
    if (mapped) {
      imported.set(mapped, value);
    } else if ((APPEARANCE_FIELDS as readonly string[]).includes(name)) {
      appearanceParts.push(`${name}: ${value}`);
    } else {
      ignoredPopulatedFields += 1;
    }
  }
  if (!imported.has("appearance") && appearanceParts.length > 0) {
    imported.set("appearance", appearanceParts.join("\n"));
  }

  const changes = [...imported.entries()].map(([field, value]) =>
    characterChangeSchema.parse({ field, value })
  );
  const warnings = [
    "El PDF se trata como entrada no confiable; solo se han leído identidad y campos narrativos permitidos.",
  ];
  if (ignoredPopulatedFields > 0) {
    warnings.push(`Se ignoraron ${ignoredPopulatedFields} campos con contenido por no pertenecer a la lista permitida.`);
  }
  return { changes, warnings };
}
